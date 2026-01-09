import { request } from "../utils/request";
import * as dayjs from "dayjs";
import {
	IgdbToken,
	Filters,
	Release_date,
} from "../common/interfaces/igdb.interface";

class IgdbApi {
	private token: IgdbToken = null;
	private readonly igdb_url = "https://api.igdb.com/v4";

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
			return await request(this.igdb_url + "/release_dates", {
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
					"Client-ID": process.env.TWITCH_CLIENT,
					Authorization: `Bearer ${this.token.access_token}`,
				},
				body,
			});
		} catch (err) {
			console.error("CALL FN -> getGamesBetweenDates -> ERROR -> ", err);
			return [];
		}
	}

	public async getGamesByIds(ids: number[]) {
		await this.getToken();

		if (ids.length == 0) return [];

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

		return await request(this.igdb_url + "/games", {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				"Client-ID": process.env.TWITCH_CLIENT,
				Authorization: `Bearer ${this.token.access_token}`,
			},
			body,
		});
	}

	public async getAllPlatforms(ids?: number[]) {
		await this.getToken();

		const fields = ["id", "name", "slug"];

		let body = `fields ${fields.join(",")}; limit 500;`;
		if (ids && ids.length > 0) body += ` where id = (${ids.join(",")});`;

		// const body = `fields ${fields.join(
		// 	","
		// )}; where versions.platform_version_release_dates.y > 2010; limit 500;`;

		return await request(this.igdb_url + "/platforms", {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				"Client-ID": process.env.TWITCH_CLIENT,
				Authorization: `Bearer ${this.token.access_token}`,
			},
			body,
		});
	}
}

export const igdbApi = new IgdbApi();
export default IgdbApi;
