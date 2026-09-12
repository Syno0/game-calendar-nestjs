import { Injectable } from "@nestjs/common";
import { IgdbApi, SEARCH_DEFAULT_LIMIT } from "./clients/igdb";
import categoryEnum from "./common/enums/category";
import statusEnum from "./common/enums/status";
import { Release_date } from "./common/interfaces/igdb.interface";
import * as dayjs from "dayjs";

/** `/release_date_statuses` : la sortie complète, celle que le calendrier date. */
const FULL_RELEASE_STATUS = 6;

/**
 * Les statuts qui décrivent une mise à disposition *avant* la sortie complète :
 * alpha (1), bêta (2), early access (3) et l'accès anticipé des éditions
 * deluxe (34), qu'IGDB nomme « Advanced Access ».
 */
const EARLY_ACCESS_STATUS = [1, 2, 3, 34];

/** Une ligne qui met le jeu entre les mains du joueur avant sa version 1.0. */
const isEarlyAccess = (row: Release_date): boolean =>
	row.status !== undefined && EARLY_ACCESS_STATUS.includes(row.status.id);

/**
 * Une ligne sans statut est une sortie ordinaire : IGDB ne renseigne le champ
 * que pour les cas particuliers.
 */
const isFullRelease = (row: Release_date): boolean =>
	!row.status || row.status.id === FULL_RELEASE_STATUS;

/** `/date_formats` : ce qu'IGDB sait réellement de la date. */
const DATE_FORMAT = {
	MONTH: 1,
	YEAR: 2,
	FIRST_QUARTER: 3,
	LAST_QUARTER: 6,
	TBD: 7,
};

export type DatePrecision = "day" | "month" | "quarter" | "year" | "tbd";

/**
 * Du plus précis au plus vague.
 *
 * Une date connue au jour près passe devant celles qui ne le sont pas : ces
 * dernières sont posées d'office en fin de période et ne disent rien d'un jour.
 * Même ordre que `PRECISION_RANK` côté front, qui range les jeux d'une case du
 * calendrier — les deux doivent bouger ensemble.
 */
const PRECISION_RANK: Record<DatePrecision, number> = {
	day: 0,
	month: 1,
	quarter: 2,
	year: 3,
	tbd: 4,
};

/** Une précision absente vient d'un enrichissement antérieur : date exacte. */
export const datePrecisionRank = (precision?: DatePrecision | null): number =>
	PRECISION_RANK[precision ?? "day"] ?? 0;

const datePrecision = (row: Release_date): DatePrecision => {
	const format = row.date_format?.id;

	if (format === DATE_FORMAT.MONTH) return "month";
	if (format === DATE_FORMAT.YEAR) return "year";
	if (format === DATE_FORMAT.TBD) return "tbd";
	if (
		format >= DATE_FORMAT.FIRST_QUARTER &&
		format <= DATE_FORMAT.LAST_QUARTER
	)
		return "quarter";

	// Champ absent (le cas courant) ou format inconnu : la date est prise au
	// jour près, c'est-à-dire telle qu'IGDB l'a écrite.
	return "day";
};

/**
 * Le jour où la carte se pose dans le calendrier.
 *
 * IGDB date un mois seul au 1er, alors qu'un trimestre et une année tombent au
 * dernier jour de leur période. On aligne le mois sur cette convention : une
 * sortie annoncée « September 2026 » n'a pas de jour, et ouvrir le mois avec
 * elle la ferait passer devant tous les jeux qui, eux, sortent un jour connu.
 * Le mois affiché, lui, ne change pas — c'est le même.
 */
const calendarDate = (row: Release_date): dayjs.Dayjs => {
	if (datePrecision(row) !== "month") return dayjs.unix(row.date);

	// Décalage compté en UTC, comme la date d'origine. `endOf("month")` le
	// calerait sur minuit *local* : `release_at` repartirait alors la veille
	// pour tout fuseau à l'est de Greenwich, et un favori se rangerait un mois
	// trop tôt.
	const lastDay = new Date(row.date * 1000);
	lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);

	return dayjs(lastDay.getTime());
};

/**
 * Ce qu'il faut écrire à la place de la date quand IGDB n'en connaît que le
 * mois, le trimestre ou l'année.
 *
 * IGDB leur donne quand même un timestamp : le premier jour du mois pour
 * « April 2027 », le dernier jour de la période pour « Q1 2027 » (31/03) et
 * pour « 2027 » (31/12). La position dans le calendrier reste celle-là, mais
 * l'écrire en toutes lettres annoncerait un jour de sortie que personne n'a
 * jamais donné.
 *
 * `short` est la version qui tient dans la pastille du calendrier, où le mois
 * de la grille est déjà écrit au-dessus.
 */
const releaseLabels = (
	row: Release_date
): { precision: DatePrecision; label: string; short: string } => {
	const day = dayjs.unix(row.date);
	const precision = datePrecision(row);

	switch (precision) {
		case "month":
			return {
				precision,
				label: day.format("MMMM YYYY"),
				short: day.format("MMMM"),
			};
		case "quarter": {
			const quarter = `Q${row.date_format.id - DATE_FORMAT.YEAR}`;
			return {
				precision,
				label: `${quarter} ${day.format("YYYY")}`,
				short: quarter,
			};
		}
		case "year":
			return {
				precision,
				label: day.format("YYYY"),
				short: day.format("YYYY"),
			};
		case "tbd":
			return { precision, label: "TBD", short: "TBD" };
		default:
			return {
				precision,
				label: day.format("DD/MM/YYYY"),
				short: day.format("DD"),
			};
	}
};

@Injectable()
export class AppService {
	constructor(private readonly igdbApi: IgdbApi) {}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async getGames({ start_date, end_date, ...filters }): Promise<any[]> {
		const release_game = await this.igdbApi.getGamesBetweenDates(
			start_date,
			end_date,
			filters
		);

		const all_games_id = release_game.map((x) => x.game);
		const game_list = await this.igdbApi.getGamesByIds(all_games_id);

		return this.enrichGames(game_list, release_game);
	}

	/**
	 * Fully-enriched games for an explicit set of ids, dates included.
	 *
	 * getGamesByIds() carries no release date, so the rows are fetched
	 * separately; a game with no announced date comes back with `date: null`.
	 *
	 * `platformByGame` is the platform each game was favorited on: a game can
	 * ship twice on the same platform (a Korean launch then a Western one), and
	 * that is the only signal we have to tell those launches apart.
	 */
	async getGamesByIds(ids: number[], platformByGame?: Map<number, string>) {
		if (!ids?.length) return [];

		const [game_list, release_rows] = await Promise.all([
			this.igdbApi.getGamesByIds(ids),
			this.igdbApi.getReleaseDatesByGameIds(ids),
		]);

		return this.enrichGames(game_list, release_rows, {
			platformByGame,
			preferUpcoming: true,
		});
	}

	/**
	 * Picks the release a user actually means among a game's rows.
	 *
	 * Restricted first to the platform they favorited it on, then to the next
	 * announced release — a game already out in one region and awaiting a wider
	 * launch belongs on the date still to come, not on the one behind us.
	 */
	private pickRelease(
		rows: Release_date[],
		preferredPlatform?: string,
		preferUpcoming = false
	): Release_date | undefined {
		if (!rows.length) return undefined;

		let candidates = rows;
		if (preferredPlatform) {
			const onPlatform = rows.filter(
				(row) => row.platform?.slug === preferredPlatform
			);
			if (onPlatform.length > 0) candidates = onPlatform;
		}

		// La sortie officielle prime sur tout le reste : l'accès anticipé d'une
		// édition deluxe est une ligne à part, datée quelques jours plus tôt, et
		// la retenir afficherait une date qui n'est celle de personne. On n'y
		// retombe que pour un jeu qui n'a rien d'autre — un early access sans
		// date de sortie complète annoncée.
		const fullReleases = candidates.filter(isFullRelease);
		if (fullReleases.length > 0) candidates = fullReleases;

		const sorted = [...candidates].sort((a, b) => a.date - b.date);
		if (!preferUpcoming) return sorted[0];

		const now = Math.floor(Date.now() / 1000);
		// Next release still ahead of us, otherwise the most recent one behind.
		return sorted.find((row) => row.date >= now) ?? sorted[sorted.length - 1];
	}

	/**
	 * L'accès anticipé qui précède la sortie retenue, s'il y en a un.
	 *
	 * Même plateforme et date antérieure : sur une console donnée, l'accès
	 * anticipé d'une autre machine n'apprend rien. La plus ancienne des lignes
	 * l'emporte — c'est la date à partir de laquelle on peut jouer.
	 */
	private pickEarlyAccess(
		rows: Release_date[],
		release?: Release_date
	): Release_date | undefined {
		if (!release) return undefined;

		const earlier = rows
			.filter(
				(row) =>
					isEarlyAccess(row) &&
					row.date < release.date &&
					(!release.platform?.slug ||
						row.platform?.slug === release.platform.slug)
			)
			.sort((a, b) => a.date - b.date);

		return earlier[0];
	}

	/**
	 * Folds the release rows into the game objects. Without options the earliest
	 * row wins, which is what the calendar wants: its rows are already scoped to
	 * the month and platforms on screen.
	 */
	private enrichGames(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		game_list: any[],
		release_rows: Release_date[],
		options: {
			platformByGame?: Map<number, string>;
			preferUpcoming?: boolean;
		} = {}
	) {
		const rowsByGame = new Map<number, Release_date[]>();
		for (const row of release_rows) {
			if (!row?.date) continue;
			const rows = rowsByGame.get(row.game);
			if (rows) rows.push(row);
			else rowsByGame.set(row.game, [row]);
		}

		game_list.map((x) => {
			const game = this.pickRelease(
				rowsByGame.get(x.id) ?? [],
				options.platformByGame?.get(x.id),
				options.preferUpcoming
			);
			const earlyAccess = this.pickEarlyAccess(
				rowsByGame.get(x.id) ?? [],
				game
			);

			// Inject human formatted release date into game list
			x.platform = game
				? {
						// Le nom exact d'IGDB (« Xbox Series X|S », « Nintendo
						// Switch 2 ») : le logo, lui, ne distingue pas les
						// générations d'une même marque.
						name: game.platform?.name,
						slug: game.platform?.slug,
						logo: game.platform?.platform_logo?.url,
					}
				: null;
			const slot = game ? calendarDate(game) : null;
			x.date = slot ? slot.format("DD/MM/YYYY") : null;
			x.day = slot ? slot.format("DD") : null;

			// `date` et `day` continuent de placer la carte dans la grille ;
			// `date_label` et `day_label` sont ce qui s'affiche à leur place, et
			// ne mentent pas sur ce qu'IGDB sait de la date.
			const labels = game ? releaseLabels(game) : null;
			x.date_precision = labels ? labels.precision : null;
			x.date_label = labels ? labels.label : null;
			x.day_label = labels ? labels.short : null;
			// Unambiguous companion to `date`: "12/03/2026" is parsed as M/D/Y by
			// the browser, which would silently misfile a whole year of favorites.
			x.release_at = slot ? slot.toISOString() : null;

			// L'accès anticipé ne remplace jamais la date de sortie : il
			// s'affiche à côté d'elle, sur la fiche du jeu. `label` porte le
			// statut IGDB tel quel — « Advanced Access » et « Early Access » ne
			// promettent pas la même chose.
			x.early_access_date = earlyAccess
				? releaseLabels(earlyAccess).label
				: null;
			x.early_access_at = earlyAccess
				? dayjs.unix(earlyAccess.date).toISOString()
				: null;
			x.early_access_label = earlyAccess?.status?.name ?? null;

			// Le jeu sort lui-même en accès anticipé : sa date est bien la
			// bonne, mais ce n'est pas la 1.0 qui arrive ce jour-là. La carte le
			// dit comme elle dit « DLC », avec le mot d'IGDB — « Early Access »,
			// « Beta » et « Advanced Access » ne racontent pas la même chose.
			x.release_status = game?.status?.name ?? null;
			x.is_early_access = game ? isEarlyAccess(game) : false;

			// L'énumération n'a pas changé d'ordre, seul le nom du champ l'a fait.
			// `category` reste exposé sous ce nom pour les clients existants.
			x.category = categoryEnum[x.game_type];
			x.status = statusEnum[x.status];

			// Replace t_thumb cover with t_cover_big for better resolution
			if (x.cover?.url)
				x.cover.url = x.cover.url.replace("t_thumb", "t_cover_big");

			if (x.artworks)
				x.artworks.map((artwork) => {
					artwork.url = artwork.url.replace("t_thumb", "t_cover_big");
				});

			// Setting null to 0
			x.hypes = x.hypes ? x.hypes : 0;
			x.follow = x.follow ? x.follow : 0;
			x.total_rating = x.total_rating ? x.total_rating : 0;

			x.developer = x.involved_companies
				? x.involved_companies
						.filter((x) => x.developer)
						.map((x) => x.company)
				: "";
			x.publisher = x.involved_companies
				? x.involved_companies
						.filter((x) => x.publisher)
						.map((x) => x.company)
				: "";

			return x;
		});

		return game_list;
	}

	/**
	 * Recherche par nom, telle que la consomme la loupe du calendrier.
	 *
	 * IGDB ne renvoie qu'un classement d'identifiants ; `getGamesByIds` fait le
	 * reste, et son `preferUpcoming` est exactement ce qu'on veut ici : on
	 * cherche un jeu pour savoir quand il sort, donc c'est la prochaine sortie
	 * annoncée qui compte, pas un lancement japonais vieux de deux ans.
	 *
	 * `getGamesByIds` rend les jeux dans l'ordre d'IGDB pour `where id = (...)`,
	 * qui n'a rien à voir avec la pertinence : l'ordre du classement est donc
	 * réappliqué à la fin, sinon le meilleur résultat n'arrive pas en tête.
	 */
	async searchGames(
		query: string,
		limit = SEARCH_DEFAULT_LIMIT
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	): Promise<any[]> {
		const hits = await this.igdbApi.searchGames(query, limit);
		if (!hits.length) return [];

		const games = await this.getGamesByIds(hits.map((hit) => hit.id));
		const rank = new Map(hits.map((hit, index) => [hit.id, index]));

		return games.sort(
			(a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
		);
	}

	async getAllPlatforms({ ids }: { ids?: number[] }): Promise<string> {
		const platforms = await this.igdbApi.getAllPlatforms(ids);
		return platforms;
	}
}
