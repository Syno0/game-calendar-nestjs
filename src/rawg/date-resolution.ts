import { Release_date } from "../common/interfaces/igdb.interface";

/** Ce qui, d'une ligne RAWG, compte pour décider de la date. */
export interface RawgDateInfo {
	released: Date | null;
	tba: boolean;
	releasedSeenAt: Date | null;
}

export type OverrideSource = "igdb" | "rawg" | "manual";
export type OverridePrecision = "day" | "month" | "quarter" | "year" | "tbd";

/** Un forçage posé depuis /admin. */
export interface DateOverrideInfo {
	source: OverrideSource;
	date: Date | null;
	precision: OverridePrecision | null;
}

export type DateSource = "igdb" | "rawg" | "manual";

/**
 * La date retenue, sous la forme d'une ligne IGDB : `calendarDate` et
 * `releaseLabels` savent déjà la placer et l'écrire, ce qui évite d'avoir une
 * seconde manière de formater une date venue d'ailleurs.
 */
export type DateRow = Pick<Release_date, "date" | "date_format">;

export interface ResolvedDate {
	row: DateRow | undefined;
	source: DateSource;
	/** La date RAWG traduite en ligne, même quand elle n'a pas été retenue. */
	rawgRow: DateRow | undefined;
}

/** `/date_formats` d'IGDB : les mêmes identifiants, pour les mêmes libellés. */
const FORMAT = { DAY: 0, MONTH: 1, YEAR: 2, FIRST_QUARTER: 3, TBD: 7 };

const unixOf = (year: number, month: number, day: number): number =>
	Math.floor(Date.UTC(year, month, day) / 1000);

const formatted = (date: number, id: number): DateRow => ({
	date,
	date_format: { id, format: "" },
});

/**
 * Une date RAWG en ligne IGDB.
 *
 * RAWG ne dit pas ce qu'il sait de sa date : il donne un jour, toujours. Le
 * 31 décembre est pourtant ce qu'il écrit pour un jeu annoncé « 2027 » — le
 * même bouche-trou qu'IGDB — et l'afficher au jour près promettrait une sortie
 * la veille du jour de l'an. On le lit donc comme une année : les vraies
 * sorties un 31 décembre sont rarissimes, les annonces à l'année courantes.
 */
export const rawgDateRow = (rawg?: RawgDateInfo | null): DateRow | undefined => {
	if (!rawg?.released || rawg.tba) return undefined;

	const d = rawg.released;
	const date = unixOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
	const isNewYearsEve = d.getUTCMonth() === 11 && d.getUTCDate() === 31;

	return formatted(date, isNewYearsEve ? FORMAT.YEAR : FORMAT.DAY);
};

/**
 * Une date saisie à la main, recalée sur les conventions d'IGDB pour sa
 * précision : le 1er pour un mois, le dernier jour de la période pour un
 * trimestre ou une année. Le reste de la chaîne n'a ainsi rien à savoir de
 * l'origine de la date.
 */
export const manualDateRow = (
	override: DateOverrideInfo
): DateRow | undefined => {
	if (!override.date) return undefined;

	const year = override.date.getUTCFullYear();
	const month = override.date.getUTCMonth();

	switch (override.precision) {
		case "month":
			return formatted(unixOf(year, month, 1), FORMAT.MONTH);
		case "quarter": {
			const quarter = Math.floor(month / 3);
			// Jour 0 du mois suivant le trimestre : son dernier jour.
			return formatted(
				unixOf(year, quarter * 3 + 3, 0),
				FORMAT.FIRST_QUARTER + quarter
			);
		}
		case "year":
			return formatted(unixOf(year, 11, 31), FORMAT.YEAR);
		case "tbd":
			return formatted(unixOf(year, 11, 31), FORMAT.TBD);
		default:
			return formatted(
				unixOf(year, month, override.date.getUTCDate()),
				FORMAT.DAY
			);
	}
};

/**
 * Un jour d'écart n'est pas un désaccord : c'est presque toujours le fuseau
 * de la source (une sortie à minuit en Europe tombe la veille aux États-Unis,
 * et RAWG, nourri par Steam, date volontiers à l'heure américaine). Le
 * prendre au sérieux déplacerait des cartes d'un jour, au gré des mises à
 * jour de RAWG.
 */
const sameDay = (a: number, b: number): boolean =>
	Math.abs(Math.floor(a / 86400) - Math.floor(b / 86400)) <= 1;

/**
 * Choisit la date d'un jeu entre IGDB, RAWG et un éventuel forçage.
 *
 *  1. Le forçage posé depuis /admin l'emporte toujours.
 *  2. Sans date IGDB, une date RAWG vaut mieux que rien.
 *  3. Sinon c'est la date modifiée le plus récemment : `updated_at` de la
 *     ligne IGDB retenue contre `releasedSeenAt` côté RAWG. Ce dernier est nul
 *     tant que la synchro n'a jamais vu la date RAWG changer — on ignore alors
 *     depuis quand elle est là, et IGDB, la source qui a fait ses preuves,
 *     garde la main.
 *
 * Une date RAWG tombant le même jour que celle d'IGDB (à un jour près, voir
 * `sameDay`) ne change rien : la
 * source reste IGDB, qui sait en plus dire la précision de sa date.
 */
export const resolveReleaseDate = (
	igdbRow: Release_date | undefined,
	rawg?: RawgDateInfo | null,
	override?: DateOverrideInfo | null
): ResolvedDate => {
	const rawgRow = rawgDateRow(rawg);
	const igdb: ResolvedDate = { row: igdbRow, source: "igdb", rawgRow };

	if (override?.source === "igdb") return igdb;
	if (override?.source === "manual") {
		const manual = manualDateRow(override);
		if (manual) return { row: manual, source: "manual", rawgRow };
	}
	if (override?.source === "rawg" && rawgRow)
		return { row: rawgRow, source: "rawg", rawgRow };

	if (!rawgRow) return igdb;
	if (!igdbRow) return { row: rawgRow, source: "rawg", rawgRow };
	if (sameDay(rawgRow.date, igdbRow.date)) return igdb;

	const rawgChangedAt = rawg.releasedSeenAt?.getTime();
	const igdbChangedAt = igdbRow.updated_at ? igdbRow.updated_at * 1000 : null;
	if (rawgChangedAt && igdbChangedAt && rawgChangedAt > igdbChangedAt)
		return { row: rawgRow, source: "rawg", rawgRow };

	return igdb;
};
