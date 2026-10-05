import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RawgApiGame, RawgClient, RawgPage } from "./rawg.client";
import {
	FUZZY_DAYS,
	IgdbMatchInput,
	matchKeys,
	matchRawg,
	nameKey,
	RawgCandidate,
} from "./rawg-match";

/** Pages de 40 par mois, les plus suivies d'abord : les 200 jeux qui comptent. */
const PAGES_PER_MONTH = 5;
const PAGE_SIZE = 40;

/** La fenêtre que la synchro garde fraîche d'elle-même, en mois autour d'aujourd'hui. */
const WINDOW_BEFORE = 1;
const WINDOW_AFTER = 18;

/** Les mois proches bougent tous les jours ; les lointains, beaucoup moins. */
const NEAR_MONTHS = 2;
const NEAR_TTL_MS = 24 * 3600_000;
const FAR_TTL_MS = 7 * 24 * 3600_000;

/** Une recherche RAWG infructueuse n'est pas retentée avant ce délai. */
const SEARCH_RETRY_MS = 14 * 24 * 3600_000;

/** Une correspondance trouvée est revérifiée de loin en loin. */
const LINK_RECHECK_MS = 30 * 24 * 3600_000;

/**
 * Un même jeu n'est pas recherché en base à chaque affichage : il l'a été
 * il y a moins de ce délai, ça suffit.
 */
const ATTEMPT_TTL_MS = 6 * 3600_000;

/** Les fiches des favoris hors fenêtre, rafraîchies une fois par semaine. */
const FAVORITE_REFRESH_MS = 7 * 24 * 3600_000;
const FAVORITE_REFRESH_BATCH = 25;

const TICK_MS = 3600_000;
const FIRST_TICK_MS = 60_000;

/**
 * Jeux qu'on accepte de chercher un par un sur RAWG : une recherche coûte un
 * appel, et sur un mois chargé ce sont les jeux attendus qui comptent.
 */
const SEARCH_MIN_HYPES = 5;

export type MatchOrigin = "calendar" | "favorites" | "search";

export interface MatchRequest extends IgdbMatchInput {
	hypes: number;
	origin: MatchOrigin;
	igdbDate: Date | null;
	igdbPrecision: string | null;
	igdbUpdatedAt: Date | null;
	/** Faux pour un portage : la date RAWG est celle de la sortie d'origine. */
	rawgDateApplies: boolean;
}

type Task =
	| { kind: "month"; key: string; month: string }
	| { kind: "match"; key: string; game: MatchRequest }
	| { kind: "refresh"; key: string; rawgId: number };

/** `"2026-10"` → bornes du mois, au format attendu par `dates=` de RAWG. */
const monthBounds = (month: string): [string, string] => {
	const [year, index] = month.split("-").map(Number);
	const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
	return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
};

const monthKeyOf = (date: Date): string =>
	`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/** Les mois (`"2026-10"`) que couvre un intervalle `YYYY-MM-DD`. */
export const monthsBetween = (start: string, end: string): string[] => {
	const months: string[] = [];
	const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
	const last = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
	while (cursor <= last && months.length < 24) {
		months.push(monthKeyOf(cursor));
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}
	return months;
};

/** Une fiche de l'API, prête pour la base. */
const toRow = (game: RawgApiGame) => ({
	slug: game.slug,
	name: game.name,
	nameKey: nameKey(game.name),
	released: game.released ? new Date(`${game.released}T00:00:00Z`) : null,
	tba: !!game.tba,
	// RAWG écrit `updated` sans fuseau (« 2026-07-15T01:27:11 ») : c'est de
	// l'UTC, et `new Date` le lirait en heure locale.
	rawgUpdatedAt: game.updated
		? new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(game.updated) ? game.updated : `${game.updated}Z`)
		: null,
	metacritic: game.metacritic ?? null,
	rating: game.rating ?? null,
	ratingsCount: game.ratings_count ?? null,
	added: game.added ?? null,
	addedByStatus: (game.added_by_status ?? Prisma.DbNull) as Prisma.InputJsonValue,
	esrb: game.esrb_rating?.name ?? null,
	playtime: game.playtime ?? null,
	platformSlugs: (game.platforms ?? [])
		.map((entry) => entry.platform?.slug)
		.filter((slug): slug is string => !!slug),
	fetchedAt: new Date(),
});

const sameDate = (a: Date | null, b: Date | null): boolean =>
	(a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Le travail de fond : une seule file, traitée un élément à la fois.
 *
 * Rien ici n'est jamais attendu par une requête HTTP. Le calendrier dépose
 * ses demandes (un mois à rafraîchir, des jeux à rapprocher) et repart ; la
 * file les traite à son rythme, dans la limite du quota. Une demande déjà en
 * file est ignorée : dix visiteurs sur le même mois ne coûtent qu'une synchro.
 */
@Injectable()
export class RawgSyncService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(RawgSyncService.name);
	private readonly queue: Task[] = [];
	private readonly queued = new Set<string>();
	private readonly attempted = new Map<number, number>();
	private draining = false;
	private timers: NodeJS.Timeout[] = [];

	constructor(
		private readonly prisma: PrismaService,
		private readonly client: RawgClient
	) {}

	onModuleInit() {
		if (!this.client.configured) {
			this.logger.log("RAWG_API_KEY absent: RAWG sync disabled");
			return;
		}
		// Hors des tests et des scripts : un minuteur actif empêcherait node de
		// s'arrêter. `unref` laisse le processus libre de sortir.
		const first = setTimeout(() => this.tick(), FIRST_TICK_MS);
		const every = setInterval(() => this.tick(), TICK_MS);
		first.unref();
		every.unref();
		this.timers = [first, every];
	}

	onModuleDestroy() {
		this.timers.forEach((timer) => clearTimeout(timer));
	}

	/** Rafraîchit ce qui est périmé dans la fenêtre, puis les favoris lointains. */
	async tick(): Promise<void> {
		if (!this.client.available) return;

		const now = new Date();
		const months: string[] = [];
		for (let offset = -WINDOW_BEFORE; offset <= WINDOW_AFTER; offset++) {
			months.push(
				monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)))
			);
		}
		await this.requestMonths(months);

		try {
			const stale = await this.prisma.rawgGame.findMany({
				where: {
					fetchedAt: { lt: new Date(Date.now() - FAVORITE_REFRESH_MS) },
					links: {
						some: {
							igdbGameId: {
								in: (
									await this.prisma.favorite.findMany({
										select: { igdbGameId: true },
										distinct: ["igdbGameId"],
									})
								).map((favorite) => favorite.igdbGameId),
							},
						},
					},
				},
				select: { rawgId: true },
				take: FAVORITE_REFRESH_BATCH,
			});
			stale.forEach(({ rawgId }) =>
				this.enqueue({ kind: "refresh", key: `refresh:${rawgId}`, rawgId })
			);
		} catch (error) {
			this.logger.warn(`RAWG favorites refresh skipped: ${(error as Error).message}`);
		}
	}

	/** Met en file les mois périmés parmi ceux demandés. */
	async requestMonths(months: string[]): Promise<void> {
		if (!this.client.available || months.length === 0) return;

		try {
			const states = await this.prisma.rawgSyncState.findMany({
				where: { key: { in: months.map((month) => `month:${month}`) } },
			});
			const syncedAt = new Map(states.map((state) => [state.key, state.syncedAt]));
			const current = monthKeyOf(new Date());

			for (const month of months) {
				const key = `month:${month}`;
				const distance = Math.abs(
					(Number(month.slice(0, 4)) - Number(current.slice(0, 4))) * 12 +
						Number(month.slice(5)) -
						Number(current.slice(5))
				);
				const ttl = distance <= NEAR_MONTHS ? NEAR_TTL_MS : FAR_TTL_MS;
				const last = syncedAt.get(key);
				if (!last || Date.now() - last.getTime() > ttl) {
					this.enqueue({ kind: "month", key, month });
				}
			}
		} catch (error) {
			this.logger.warn(`RAWG month check skipped: ${(error as Error).message}`);
		}
	}

	/** Met en file le rapprochement d'un jeu, sauf s'il vient d'être tenté. */
	requestMatch(game: MatchRequest): void {
		const last = this.attempted.get(game.id);
		if (last && Date.now() - last < ATTEMPT_TTL_MS) return;
		this.attempted.set(game.id, Date.now());

		// La carte des tentatives ne doit pas grossir sans fin sur un serveur qui
		// tourne des semaines : au-delà d'une taille raisonnable on la vide, au
		// pire quelques jeux seront retentés plus tôt.
		if (this.attempted.size > 20_000) this.attempted.clear();

		this.enqueue({ kind: "match", key: `match:${game.id}`, game });
	}

	private enqueue(task: Task): void {
		if (this.queued.has(task.key)) return;
		this.queued.add(task.key);
		// Les mois d'abord : un rapprochement fait avant la synchro de son mois
		// chercherait en base des fiches qui n'y sont pas encore, et paierait
		// une recherche RAWG pour rien.
		if (task.kind === "month") {
			const firstOther = this.queue.findIndex((queued) => queued.kind !== "month");
			if (firstOther === -1) this.queue.push(task);
			else this.queue.splice(firstOther, 0, task);
		} else {
			this.queue.push(task);
		}
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.queue.length > 0) {
				const task = this.queue.shift();
				try {
					if (task.kind === "month") await this.syncMonth(task.month);
					else if (task.kind === "match") await this.matchGame(task.game);
					else await this.refreshGame(task.rawgId);
				} catch (error) {
					this.logger.warn(`RAWG ${task.key} failed: ${(error as Error).message}`);
				} finally {
					this.queued.delete(task.key);
				}
			}
		} finally {
			this.draining = false;
		}
	}

	async syncMonth(month: string): Promise<void> {
		const [first, last] = monthBounds(month);
		let pages = 0;

		for (let page = 1; page <= PAGES_PER_MONTH; page++) {
			const result = await this.client.get<RawgPage>("/games", {
				dates: `${first},${last}`,
				ordering: "-added",
				page_size: PAGE_SIZE,
				page,
			});
			// Quota ou panne : le mois reste périmé, il sera repris au prochain
			// passage plutôt que marqué à jour avec une page sur cinq.
			if (!result) return;

			await this.saveGames(result.results ?? []);
			pages = page;
			if (!result.next) break;
		}

		await this.prisma.rawgSyncState.upsert({
			where: { key: `month:${month}` },
			create: { key: `month:${month}`, syncedAt: new Date(), pages },
			update: { syncedAt: new Date(), pages },
		});
		this.logger.log(`RAWG month ${month} synced (${pages} page(s))`);
	}

	private async refreshGame(rawgId: number): Promise<void> {
		const game = await this.client.get<RawgApiGame>(`/games/${rawgId}`);
		if (game) await this.saveGames([game]);
	}

	/** Récupère une fiche par son identifiant RAWG, pour un lien posé à la main. */
	async fetchGame(rawgId: number): Promise<boolean> {
		const game = await this.client.get<RawgApiGame>(`/games/${rawgId}`);
		if (!game) return false;
		await this.saveGames([game]);
		return true;
	}

	/**
	 * Enregistre des fiches RAWG.
	 *
	 * `releasedSeenAt` n'est posé que lorsque la date *change* d'un passage à
	 * l'autre. À la première rencontre, on ne sait pas depuis quand RAWG la
	 * tient : la laisser nulle, c'est laisser IGDB prioritaire tant qu'on n'a
	 * pas vu RAWG bouger.
	 */
	async saveGames(games: RawgApiGame[]): Promise<void> {
		const valid = games.filter((game) => game?.id && game.slug && game.name);
		if (valid.length === 0) return;

		const existing = await this.prisma.rawgGame.findMany({
			where: { rawgId: { in: valid.map((game) => game.id) } },
			select: { rawgId: true, released: true, tba: true },
		});
		const known = new Map(existing.map((row) => [row.rawgId, row]));

		await this.prisma.$transaction(
			valid.map((game) => {
				const row = toRow(game);
				const previous = known.get(game.id);
				const moved =
					previous &&
					(!sameDate(previous.released, row.released) || previous.tba !== row.tba);

				return this.prisma.rawgGame.upsert({
					where: { rawgId: game.id },
					create: { rawgId: game.id, ...row, releasedSeenAt: null },
					update: moved ? { ...row, releasedSeenAt: new Date() } : row,
				});
			})
		);
	}

	/**
	 * Rapproche un jeu IGDB de RAWG.
	 *
	 * D'abord en base, parmi les fiches déjà synchronisées : c'est gratuit. Ce
	 * n'est qu'à défaut, et pour un jeu qui le mérite (attendu ou suivi), qu'on
	 * dépense une recherche RAWG — et un échec est retenu quatorze jours.
	 */
	async matchGame(game: MatchRequest): Promise<void> {
		const link = await this.prisma.gameLink.findUnique({
			where: { igdbGameId: game.id },
		});
		if (link?.method === "manual") return;
		if (link?.rawgId && Date.now() - link.checkedAt.getTime() < LINK_RECHECK_MS) return;

		const keys = matchKeys(game);
		const window = FUZZY_DAYS * 86_400_000;
		const candidates: RawgCandidate[] = await this.prisma.rawgGame.findMany({
			where: {
				OR: [
					{ nameKey: { in: keys } },
					...(game.slug ? [{ slug: game.slug }] : []),
					// Les sorties des mêmes jours : c'est parmi elles que
					// `matchRawg` cherche un nom seulement approché.
					...(game.releaseDay
						? [
								{
									released: {
										gte: new Date(game.releaseDay.getTime() - window),
										lte: new Date(game.releaseDay.getTime() + window),
									},
								},
							]
						: []),
				],
			},
			select: {
				rawgId: true,
				slug: true,
				name: true,
				nameKey: true,
				released: true,
				platformSlugs: true,
			},
		});

		let match = matchRawg(game, candidates);
		let method = "name";

		const searchedRecently =
			link &&
			!link.rawgId &&
			link.method !== "pending" &&
			Date.now() - link.checkedAt.getTime() < SEARCH_RETRY_MS;
		const worthASearch =
			game.origin === "favorites" ||
			(game.origin === "calendar" && game.hypes >= SEARCH_MIN_HYPES);

		if (!match && worthASearch && !searchedRecently) {
			const result = await this.client.get<RawgPage>("/games", {
				search: game.name,
				search_precise: true,
				page_size: 5,
			});
			// Quota, panne ou clé absente : le jeu n'est pas « introuvable », il
			// n'a pas pu être cherché. Le lien passe en `pending`, qui garde
			// l'état IGDB pour /admin sans compter comme une recherche ratée.
			if (!result) {
				if (!link || link.method === "pending") {
					await this.saveLink(game, null, "pending");
				}
				return;
			}

			await this.saveGames(result.results ?? []);
			match = matchRawg(
				game,
				(result.results ?? []).map((found) => ({
					rawgId: found.id,
					...toRow(found),
				}))
			);
			method = "search";
		} else if (!match && link) {
			// Rien de neuf : on n'efface pas la date de la dernière recherche,
			// sans quoi le délai de quatorze jours ne serait jamais atteint.
			return;
		}

		await this.saveLink(game, match, method);
	}

	private async saveLink(
		game: MatchRequest,
		match: { rawgId: number; score: number } | null,
		method: string
	): Promise<void> {
		const snapshot = {
			igdbName: game.name,
			igdbHypes: game.hypes,
			igdbDate: game.igdbDate,
			igdbPrecision: game.igdbPrecision,
			igdbUpdatedAt: game.igdbUpdatedAt,
			rawgDateApplies: game.rawgDateApplies,
		};
		await this.prisma.gameLink.upsert({
			where: { igdbGameId: game.id },
			create: {
				igdbGameId: game.id,
				rawgId: match?.rawgId ?? null,
				method,
				score: match?.score ?? 0,
				...snapshot,
			},
			update: {
				rawgId: match?.rawgId ?? null,
				method,
				score: match?.score ?? 0,
				checkedAt: new Date(),
				...snapshot,
			},
		});
	}
}
