import * as dayjs from "dayjs";

export interface IgdbToken {
	access_token: string;
	created_at: dayjs.Dayjs;
	expires_in: number;
	expires_at: dayjs.Dayjs;
	token_type: string;
}

interface Platform {
	id: number;
	name: string;
	slug: string;
	platform_logo: {
		url: string;
	};
}

export interface Filters {
	hypes?: number;
	score?: boolean;
	platform?: Platform[];
	genres?: number[];
}

/**
 * Le statut d'une ligne de sortie IGDB (`/release_date_statuses`).
 *
 * Absent de la plupart des lignes : une sortie ordinaire n'en porte pas, et
 * doit donc être lue comme une sortie complète.
 */
export interface Release_date_status {
	id: number;
	name: string;
}

/**
 * La précision de la date (`/date_formats`) : IGDB range un jeu annoncé pour
 * « 2027 » au 31/12/2027, et seul ce champ dit que le jour n'a jamais été
 * donné. Absent des lignes datées au jour près.
 */
export interface Release_date_format {
	id: number;
	format: string;
}

export interface Release_date {
	id: number;
	date: number;
	game: number;
	platform: Platform;
	status?: Release_date_status;
	date_format?: Release_date_format;
}

/** Une ligne de résultat de `IgdbApi.searchGames` : juste de quoi enchaîner. */
export interface IgdbSearchHit {
	id: number;
	name: string;
}
