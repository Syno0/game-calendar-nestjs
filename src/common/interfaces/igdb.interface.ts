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
}

export interface Release_date {
	id: number;
	date: number;
	game: number;
	platform: Platform;
}
