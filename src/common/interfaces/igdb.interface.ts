import * as dayjs from 'dayjs';

export interface igdb {
	access_token: string;
	created_at: dayjs.Dayjs;
	expires_in: number;
	expires_at: dayjs.Dayjs;
	token_type: string;
}

interface platform {
	id: number;
	name: string;
	slug: string;
}

export interface filters {
	hypes ?: number,
	score ?: boolean,
	platform ?: platform[]
}