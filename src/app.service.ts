import { Injectable, Optional } from "@nestjs/common";
import { IgdbApi, SEARCH_DEFAULT_LIMIT } from "./clients/igdb";
import categoryEnum from "./common/enums/category";
import statusEnum from "./common/enums/status";
import { Filters, Release_date } from "./common/interfaces/igdb.interface";
import { DateRow, resolveReleaseDate } from "./rawg/date-resolution";
import {
	overrideOf,
	RawgInfo,
	rawgDateOf,
	rawgPayloadOf,
	RawgService,
} from "./rawg/rawg.service";
import { MatchOrigin, MatchRequest } from "./rawg/rawg-sync.service";
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

const datePrecision = (row: DateRow): DatePrecision => {
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
const calendarDate = (row: DateRow): dayjs.Dayjs => {
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
export const releaseLabels = (
	row: DateRow
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

/** Ce que raconte une étape de la vie du jeu, pour la couleur de la fiche. */
export type MilestoneKind =
	| "release"
	| "alpha"
	| "beta"
	| "early_access"
	| "advanced_access"
	| "cancelled"
	| "offline"
	| "other";

const MILESTONE_KIND: Record<number, MilestoneKind> = {
	1: "alpha",
	2: "beta",
	3: "early_access",
	4: "offline",
	5: "cancelled",
	34: "advanced_access",
};

/** Une date connue du jeu, toutes plateformes et régions qui la partagent. */
export interface ReleaseMilestone {
	kind: MilestoneKind;
	/** Le nom du statut IGDB, « Release » pour une sortie ordinaire. */
	status: string;
	date_label: string;
	date_precision: DatePrecision;
	/** Le jour où la carte se poserait dans le calendrier ; nul pour un TBD sans date. */
	at: string | null;
	platforms: { name: string; slug: string }[];
	/** Vide quand l'étape vaut partout (ou qu'IGDB ne dit pas où). */
	regions: string[];
}

/** `north_america` → « North America ». */
const regionName = (region: string): string =>
	region
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");

/**
 * Toutes les dates connues d'un jeu, de la première alpha à la sortie
 * complète, dans l'ordre où elles arrivent.
 *
 * IGDB écrit une ligne par plateforme, par région *et* par statut : huit lignes
 * pour une seule sortie ne sont pas rares. On les regroupe par étape et par
 * date affichée, avec la liste des plateformes concernées. Une ligne sans
 * statut et une ligne « Full Release » disent la même chose (Atomfall porte
 * les deux pour la même sortie) : elles tombent dans la même étape.
 *
 * Ce sont les dates d'IGDB, telles quelles : la date retenue par le
 * calendrier (RAWG plus récent, forçage admin) reste celle de la carte
 * « Release », qui dit déjà d'où elle vient.
 */
export const releaseTimeline = (rows: Release_date[]): ReleaseMilestone[] => {
	const groups = new Map<
		string,
		ReleaseMilestone & { sortKey: number; everywhere: boolean }
	>();

	for (const row of rows) {
		if (!row) continue;

		const kind: MilestoneKind = isFullRelease(row)
			? "release"
			: (MILESTONE_KIND[row.status.id] ?? "other");
		const status = kind === "release" ? "Release" : row.status.name;
		// Une ligne TBD peut n'avoir aucun timestamp : `releaseLabels` en
		// ferait un 01/01/1970.
		const labels = row.date
			? releaseLabels(row)
			: { precision: "tbd" as DatePrecision, label: "TBD" };
		const slot = row.date ? calendarDate(row) : null;

		const key = `${kind}|${status}|${labels.label}`;
		let group = groups.get(key);
		if (!group) {
			group = {
				kind,
				status,
				date_label: labels.label,
				date_precision: labels.precision,
				at: slot ? slot.toISOString() : null,
				platforms: [],
				regions: [],
				// Rangées comme dans le calendrier : un « mois seul » se range
				// en fin de mois, derrière les dates connues au jour près.
				sortKey: slot ? slot.valueOf() : Infinity,
				everywhere: false,
			};
			groups.set(key, group);
		}

		const platform = row.platform;
		if (platform?.slug && !group.platforms.some((p) => p.slug === platform.slug))
			group.platforms.push({ name: platform.name, slug: platform.slug });

		const region = row.release_region?.region;
		if (!region || region === "worldwide") group.everywhere = true;
		else if (!group.regions.includes(regionName(region)))
			group.regions.push(regionName(region));
	}

	return [...groups.values()]
		.sort(
			(a, b) =>
				a.sortKey - b.sortKey ||
				datePrecisionRank(a.date_precision) - datePrecisionRank(b.date_precision)
		)
		.map((group) => ({
			kind: group.kind,
			status: group.status,
			date_label: group.date_label,
			date_precision: group.date_precision,
			at: group.at,
			platforms: group.platforms,
			// Une sortie mondiale et une ligne nord-américaine le même jour :
			// c'est une sortie mondiale, la région n'apprendrait rien.
			regions: group.everywhere ? [] : group.regions,
		}));
};

/** `"2026-10-31T00:00:00.000Z"` tombe-t-il entre deux jours `YYYY-MM-DD` ? */
const withinDays = (iso: string | null, start: string, end: string): boolean =>
	!!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end;

@Injectable()
export class AppService {
	/**
	 * RAWG est facultatif : sans lui (tests, base indisponible), l'application
	 * se comporte exactement comme avec IGDB seul.
	 */
	constructor(
		private readonly igdbApi: IgdbApi,
		@Optional() private readonly rawg?: RawgService
	) {}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async getGames({ start_date, end_date, ...filters }): Promise<any[]> {
		const release_game = await this.igdbApi.getGamesBetweenDates(
			start_date,
			end_date,
			filters
		);

		const all_games_id = release_game.map((x) => x.game);
		const [game_list, moved] = await Promise.all([
			this.igdbApi.getGamesByIds(all_games_id),
			this.movedInto(start_date, end_date, filters, new Set(all_games_id)),
		]);
		this.rawg?.ensureMonths(start_date, end_date);

		const games = await this.enrichGames(
			[...game_list, ...moved.games],
			[...release_game, ...moved.rows],
			{ origin: "calendar" }
		);

		// Un jeu qu'IGDB range ce mois-ci mais dont la date retenue (RAWG plus
		// récent, forçage admin) tombe ailleurs n'a plus rien à faire ici : il
		// apparaîtra dans le mois où `movedInto` le fera entrer. Un jeu amené
		// par `movedInto`, lui, n'a sa place ici que si sa date y tombe bel et
		// bien : la présélection n'est qu'une présélection.
		const movedIds = new Set(moved.games.map((game) => game.id));
		return games.filter((game) =>
			movedIds.has(game.id) || game.date_source !== "igdb"
				? withinDays(game.release_at, start_date, end_date)
				: true
		);
	}

	/**
	 * Les jeux qu'IGDB range ailleurs mais qu'une autre date fait tomber dans
	 * l'intervalle demandé, avec les mêmes filtres que la requête IGDB —
	 * appliqués ici à la main, puisque ces jeux n'en sont pas sortis.
	 */
	private async movedInto(
		start_date: string,
		end_date: string,
		filters: Filters,
		present: Set<number>
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	): Promise<{ games: any[]; rows: Release_date[] }> {
		const none = { games: [], rows: [] };
		if (!this.rawg) return none;

		const ids = (
			await this.rawg.findMovedInto(start_date, end_date, filters.hypes ?? 0)
		).filter((id) => !present.has(id));
		if (ids.length === 0) return none;

		const [games, rows] = await Promise.all([
			this.igdbApi.getGamesByIds(ids),
			this.igdbApi.getReleaseDatesByGameIds(ids),
		]);

		const platforms = Array.isArray(filters.platform)
			? filters.platform.map((platform) => platform.id)
			: [];
		const kept =
			platforms.length > 0
				? rows.filter((row) => platforms.includes(row.platform?.id))
				: rows;

		return {
			games: games.filter(
				(game) =>
					(platforms.length === 0 || kept.some((row) => row.game === game.id)) &&
					(game.hypes ?? 0) >= (filters.hypes ?? 0) &&
					(!filters.score || game.total_rating_count > 0) &&
					(!filters.genres?.length ||
						game.genres?.some((genre) => filters.genres.includes(genre.id)))
			),
			rows: kept,
		};
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
	async getGamesByIds(
		ids: number[],
		platformByGame?: Map<number, string>,
		origin: MatchOrigin = "favorites"
	) {
		if (!ids?.length) return [];

		const [game_list, release_rows] = await Promise.all([
			this.igdbApi.getGamesByIds(ids),
			this.igdbApi.getReleaseDatesByGameIds(ids),
		]);

		return this.enrichGames(game_list, release_rows, {
			platformByGame,
			preferUpcoming: true,
			origin,
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
	private async enrichGames(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		game_list: any[],
		release_rows: Release_date[],
		options: {
			platformByGame?: Map<number, string>;
			preferUpcoming?: boolean;
			/** D'où vient la demande : décide si un jeu vaut une recherche RAWG. */
			origin?: MatchOrigin;
		} = {}
	) {
		const rowsByGame = new Map<number, Release_date[]>();
		for (const row of release_rows) {
			if (!row?.date) continue;
			const rows = rowsByGame.get(row.game);
			if (rows) rows.push(row);
			else rowsByGame.set(row.game, [row]);
		}

		const rawgInfos: Map<number, RawgInfo> = this.rawg
			? await this.rawg.lookup(game_list.map((x) => x.id))
			: new Map();
		const observed: MatchRequest[] = [];

		game_list.map((x) => {
			const game = this.pickRelease(
				rowsByGame.get(x.id) ?? [],
				options.platformByGame?.get(x.id),
				options.preferUpcoming
			);

			// IGDB choisit la ligne (et donc la plateforme) ; la date, elle, peut
			// venir de RAWG s'il l'a changée plus récemment, ou d'un forçage
			// posé depuis /admin. Tout ce qui suit place et écrit `release`.
			const info = rawgInfos.get(x.id);

			/*
			 * La ligne retenue est-elle la sortie d'origine du jeu ? Pour un
			 * portage ou une réédition (Kingdom Hearts III sur une nouvelle
			 * console en 2026), RAWG ne connaît que la sortie de 2019 : sa date
			 * ne dit rien de celle-ci, et la laisser jouer ferait reculer la
			 * carte de sept ans. Le lien sert alors aux notes, pas à la date —
			 * sauf si /admin impose explicitement RAWG.
			 */
			const firstRelease: number | undefined = x.first_release_date;
			const isOriginal =
				!game || !firstRelease || Math.abs(game.date - firstRelease) <= 30 * 86400;
			const override = overrideOf(info);
			const rawgDate =
				isOriginal || override?.source === "rawg" ? rawgDateOf(info) : null;
			const resolved = resolveReleaseDate(game, rawgDate, override);
			const release = resolved.row;

			// Un accès anticipé postérieur à la date retenue n'en précède plus rien.
			const earlyAccess = this.pickEarlyAccess(
				rowsByGame.get(x.id) ?? [],
				game
			);
			const precedingAccess =
				earlyAccess && release && earlyAccess.date < release.date
					? earlyAccess
					: undefined;

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
			const slot = release ? calendarDate(release) : null;
			x.date = slot ? slot.format("DD/MM/YYYY") : null;
			x.day = slot ? slot.format("DD") : null;

			// `date` et `day` continuent de placer la carte dans la grille ;
			// `date_label` et `day_label` sont ce qui s'affiche à leur place, et
			// ne mentent pas sur ce qu'IGDB sait de la date.
			const labels = release ? releaseLabels(release) : null;
			x.date_precision = labels ? labels.precision : null;
			x.date_label = labels ? labels.label : null;
			x.day_label = labels ? labels.short : null;

			// D'où vient la date, et ce que dit chaque source : la fiche du jeu
			// montre le désaccord plutôt que de le taire.
			x.date_source = resolved.source;
			x.date_sources = {
				igdb: game ? releaseLabels(game).label : null,
				rawg: resolved.rawgRow ? releaseLabels(resolved.rawgRow).label : null,
			};
			x.metacritic = info?.link?.rawg?.metacritic ?? null;
			x.rawg = rawgPayloadOf(info);
			// Unambiguous companion to `date`: "12/03/2026" is parsed as M/D/Y by
			// the browser, which would silently misfile a whole year of favorites.
			x.release_at = slot ? slot.toISOString() : null;

			// L'accès anticipé ne remplace jamais la date de sortie : il
			// s'affiche à côté d'elle, sur la fiche du jeu. `label` porte le
			// statut IGDB tel quel — « Advanced Access » et « Early Access » ne
			// promettent pas la même chose.
			x.early_access_date = precedingAccess
				? releaseLabels(precedingAccess).label
				: null;
			x.early_access_at = precedingAccess
				? dayjs.unix(precedingAccess.date).toISOString()
				: null;
			x.early_access_label = precedingAccess?.status?.name ?? null;

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

			observed.push({
				id: x.id,
				name: x.name,
				slug: x.slug,
				alternativeNames: (x.alternative_names ?? [])
					.map((alt) => alt?.name)
					.filter(Boolean),
				// L'année de la première sortie, pas celle de la ligne affichée :
				// RAWG ne date un portage qu'à sa sortie d'origine.
				year: firstRelease
					? new Date(firstRelease * 1000).getUTCFullYear()
					: game
						? new Date(game.date * 1000).getUTCFullYear()
						: null,
				releaseDay:
					game && isOriginal && datePrecision(game) === "day"
						? new Date(game.date * 1000)
						: null,
				platformSlugs: (rowsByGame.get(x.id) ?? [])
					.map((row) => row.platform?.slug)
					.filter(Boolean),
				hypes: x.hypes,
				origin: options.origin ?? "calendar",
				igdbDate: game ? new Date(game.date * 1000) : null,
				igdbPrecision: game ? datePrecision(game) : null,
				igdbUpdatedAt: game?.updated_at ? new Date(game.updated_at * 1000) : null,
				rawgDateApplies: isOriginal,
			});

			return x;
		});

		this.rawg?.observe(observed, rawgInfos);

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

		const games = await this.getGamesByIds(
			hits.map((hit) => hit.id),
			undefined,
			"search"
		);
		const rank = new Map(hits.map((hit, index) => [hit.id, index]));

		return games.sort(
			(a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
		);
	}

	/**
	 * La chronologie complète d'un jeu, pour sa fiche.
	 *
	 * À part de `/games` : les lignes du calendrier sont bornées au mois et aux
	 * plateformes à l'écran, la bêta d'avril n'y figure donc pas quand on ouvre
	 * le jeu en juin. Les recharger pour chaque jeu du mois coûterait des
	 * dizaines d'appels IGDB pour des fiches que personne n'ouvre.
	 */
	async getReleaseTimeline(id: number): Promise<ReleaseMilestone[]> {
		return releaseTimeline(await this.igdbApi.getReleaseDatesByGameIds([id]));
	}

	async getAllPlatforms({ ids }: { ids?: number[] }): Promise<string> {
		const platforms = await this.igdbApi.getAllPlatforms(ids);
		return platforms;
	}
}
