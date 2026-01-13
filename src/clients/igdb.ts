import { Injectable, Inject } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { request } from "../utils/request";
import * as dayjs from "dayjs";
import {
	IgdbToken,
	Filters,
	Release_date,
} from "../common/interfaces/igdb.interface";

const cacheTTL = process.env.CACHE_TTL
	? parseInt(process.env.CACHE_TTL)
	: 86400000; // 24h default

@Injectable()
export class IgdbApi {
	private token: IgdbToken = null;
	private readonly igdb_url = "https://api.igdb.com/v4";

	constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

	public async getToken(): Promise<IgdbToken> {
		if (this.token && dayjs().isBefore(this.token.expires_at)) {
			return this.token;
		}

		console.debug("RESET TOKEN:", dayjs().format());

		const twitch_url = `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT}&client_secret=${process.env.TWITCH_SECRET}&grant_type=client_credentials`;

		console.debug("GET IGDB TOKEN:", twitch_url);

		try {
			this.token = await request(twitch_url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			console.error("ERROR GET IGDB TOKEN:", error);
			throw error;
		}

		this.token.created_at = dayjs();
		this.token.expires_at = dayjs().add(this.token.expires_in, "second");

		return this.token;
	}

	public async getGamesBetweenDates(
		start_date: string,
		end_date: string,
		filters: Filters
	): Promise<Release_date[]> {
		const cacheKey = `games_dates_${start_date}_${end_date}_${JSON.stringify(
			filters
		)}`;
		const cached = await this.cacheManager.get<Release_date[]>(cacheKey);
		if (cached) {
			console.debug(
				`[CACHE HIT] ${cacheKey} - Returned ${cached.length} items`
			);
			return cached;
		}
		console.debug(`[CACHE MISS] ${cacheKey}`);

		await this.getToken();

		let body =
			"fields date, game, platform.slug, platform.platform_logo.url; limit 500; sort date asc;";
		body += " where";
		body += " date > " + dayjs(start_date).subtract(1, "day").unix();
		body += " &";
		body += " date < " + dayjs(end_date).add(1, "day").unix();
		if (filters.hypes > 0) body += " & game.hypes >= " + filters.hypes;
		if (filters.score) body += " & game.total_rating_count > 0";
		if (Array.isArray(filters.platform) && filters.platform?.length > 0)
			body += ` & platform = (${filters.platform.map((x) => x.id)})`;
		body += ";";

		try {
			const result = await request(this.igdb_url + "/release_dates", {
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
					"Client-ID": process.env.TWITCH_CLIENT,
					Authorization: `Bearer ${this.token.access_token}`,
				},
				body,
			});
			await this.cacheManager.set(cacheKey, result, cacheTTL);
			console.debug(
				`[CACHE SET] ${cacheKey} - Cached ${result.length} items (TTL: 1h)`
			);
			return result;
		} catch (err) {
			console.error("CALL FN -> getGamesBetweenDates -> ERROR -> ", err);
			return [];
		}
	}

	public async getGamesByIds(ids: number[]) {
		if (ids.length == 0) return [];

		const cacheKey = `games_ids_${ids.sort().join("_")}`;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cached = await this.cacheManager.get<any[]>(cacheKey);
		if (cached) {
			console.debug(
				`[CACHE HIT] ${cacheKey} - Returned ${cached.length} items`
			);
			return cached;
		}
		console.debug(`[CACHE MISS] ${cacheKey}`);

		await this.getToken();

		const fields = [
			"id",
			"name",
			"category",
			"status",
			"cover.url",
			"artworks.url",
			"follows",
			"hypes",
			"aggregated_rating",
			"aggregated_rating_count",
			"alternative_names",
			"rating",
			"rating_count",
			"storyline",
			"summary",
			"total_rating",
			"total_rating_count",
			"url",
			"version_title",
			"websites.url",
			"videos.video_id",
			"alternative_names.name",
			"collection.name",
			"collection.url",
			"dlcs.name",
			"dlcs.url",
			"game_engines.name",
			"game_engines.url",
			"franchise.name",
			"franchise.url",
			"game_modes.name",
			"game_modes.url",
			"genres.name",
			"involved_companies.*",
			"involved_companies.company.*",
		];

		const body = `fields ${fields.join(",")}; where id = (${ids.join(
			","
		)}); limit 500;`;

		const result = await request(this.igdb_url + "/games", {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				"Client-ID": process.env.TWITCH_CLIENT,
				Authorization: `Bearer ${this.token.access_token}`,
			},
			body,
		});
		await this.cacheManager.set(cacheKey, result, cacheTTL);
		console.debug(
			`[CACHE SET] ${cacheKey} - Cached ${result.length} items (TTL: 1h)`
		);
		return result;
	}

	public async getAllPlatforms(ids?: number[]) {
		const cacheKey =
			ids && ids.length > 0
				? `platforms_${ids.sort().join("_")}`
				: "platforms_all";
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cached = await this.cacheManager.get<any[]>(cacheKey);
		if (cached) {
			console.debug(
				`[CACHE HIT] ${cacheKey} - Returned ${cached.length} items`
			);
			return cached;
		}
		console.debug(`[CACHE MISS] ${cacheKey}`);

		await this.getToken();

		const fields = ["id", "name", "slug"];

		let body = `fields ${fields.join(",")}; limit 500;`;
		if (ids && ids.length > 0) body += ` where id = (${ids.join(",")});`;

		const result = await request(this.igdb_url + "/platforms", {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				"Client-ID": process.env.TWITCH_CLIENT,
				Authorization: `Bearer ${this.token.access_token}`,
			},
			body,
		});
		await this.cacheManager.set(cacheKey, result, cacheTTL);
		console.debug(
			`[CACHE SET] ${cacheKey} - Cached ${result.length} items (TTL: 24h)`
		);
		return result;
	}
}
