import { Injectable, Inject, Logger } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { request } from "../utils/request";
import * as dayjs from "dayjs";
import {
	IgdbToken,
	Filters,
	IgdbSearchHit,
	Release_date,
} from "../common/interfaces/igdb.interface";

const cacheTTL = process.env.CACHE_TTL
	? parseInt(process.env.CACHE_TTL)
	: 86400000; // 24h default

export const SEARCH_DEFAULT_LIMIT = 8;
export const SEARCH_MAX_LIMIT = 20;

/**
 * Types de jeux écartés de la recherche : compilation (3), mod (5), fork (12),
 * pack (13), mise à jour (14). Rien de tout cela n'est un jeu qu'on cherche
 * dans un calendrier de sorties.
 *
 * Attention, c'est bien `game_type` et non l'ancien `category` : IGDB a retiré
 * ce dernier de `/games`, et un `where category = ...` n'y renvoie plus rien —
 * silencieusement.
 */
const EXCLUDED_GAME_TYPES = [3, 5, 12, 13, 14];

/**
 * Rend un terme de recherche sûr à interpoler dans une requête APICalypse.
 *
 * Le corps envoyé à IGDB est du texte brut concaténé : un guillemet ou un
 * point-virgule laissé dans la saisie sort de la chaîne `search "..."` et
 * réécrit la requête. Tout ce qui pourrait la refermer est donc retiré, et
 * la longueur est bornée pour ne pas expédier un roman à IGDB.
 */
/**
 * L'ordre des résultats : du plus sûrement voulu au plus improbable.
 *
 *  1. le titre exact, s'il existe — on le cherchait, pas sa suite ;
 *  2. les titres qui *commencent* par ce qui est tapé, le plus attendu d'abord
 *     (c'est ce que fait quelqu'un qui tape un nom du début) ;
 *  3. le classement par ressemblance d'IGDB, qui rattrape noms alternatifs et
 *     fautes de frappe ;
 *  4. le reste des titres contenant le terme, toujours par hype.
 *
 * Les doublons disparaissent au passage : les deux requêtes se recoupent
 * largement dès que la recherche est simple.
 */
export const mergeSearchHits = (
	term: string,
	byRelevance: IgdbSearchHit[],
	byName: IgdbSearchHit[],
	limit: number
): IgdbSearchHit[] => {
	const needle = term.toLowerCase();
	const name = (hit: IgdbSearchHit) => (hit.name ?? "").toLowerCase();

	const exact = byName.filter((hit) => name(hit) === needle);
	const prefixed = byName.filter(
		(hit) => name(hit) !== needle && name(hit).startsWith(needle)
	);
	const rest = byName.filter((hit) => !name(hit).startsWith(needle));

	const seen = new Set<number>();
	const merged: IgdbSearchHit[] = [];

	for (const hit of [...exact, ...prefixed, ...byRelevance, ...rest]) {
		if (!hit || seen.has(hit.id)) continue;
		seen.add(hit.id);
		merged.push({ id: hit.id, name: hit.name });
		if (merged.length === limit) break;
	}

	return merged;
};

export const sanitizeSearchTerm = (query: string): string => {
	if (typeof query !== "string") return "";
	return query
		.replace(/[\\";\r\n]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 100);
};

@Injectable()
export class IgdbApi {
	private readonly logger = new Logger(IgdbApi.name);
	private token: IgdbToken = null;
	private readonly igdb_url = "https://api.igdb.com/v4";

	constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

	public async getToken(): Promise<IgdbToken> {
		if (this.token && dayjs().isBefore(this.token.expires_at)) {
			return this.token;
		}

		this.logger.debug(`RESET TOKEN: ${dayjs().format()}`);

		const twitch_url = `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT}&client_secret=${process.env.TWITCH_SECRET}&grant_type=client_credentials`;

		this.logger.debug(`GET IGDB TOKEN: ${twitch_url}`);

		try {
			this.token = await request(twitch_url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			this.logger.error(`ERROR GET IGDB TOKEN: ${JSON.stringify(error)}`);
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
		const cacheKey = `games_dates_v3_${start_date}_${end_date}_${JSON.stringify(
			filters
		)}`;
		const cached = await this.cacheManager.get<Release_date[]>(cacheKey);
		if (cached) {
			return cached;
		}
		await this.getToken();

		let body =
			"fields date, game, status.id, status.name, date_format.id," +
			" platform.name, platform.slug, platform.platform_logo.url;" +
			" limit 500; sort date asc;";
		body += " where";
		body += " date > " + dayjs(start_date).subtract(1, "day").unix();
		body += " &";
		body += " date < " + dayjs(end_date).add(1, "day").unix();
		if (filters.hypes > 0) body += " & game.hypes >= " + filters.hypes;
		if (filters.score) body += " & game.total_rating_count > 0";
		if (Array.isArray(filters.platform) && filters.platform?.length > 0)
			body += ` & platform = (${filters.platform.map((x) => x.id)})`;
		// `= (...)` on an array field is IGDB's "contains at least one of", so a
		// game matches as soon as one of its genres was asked for.
		if (Array.isArray(filters.genres) && filters.genres.length > 0)
			body += ` & game.genres = (${filters.genres.join(",")})`;
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
			return result;
		} catch (err) {
			this.logger.error(
				`CALL FN -> getGamesBetweenDates -> ERROR -> ${JSON.stringify(err)}`
			);
			return [];
		}
	}

	/**
	 * Release rows for an arbitrary set of games — the favorites view needs
	 * dates, and getGamesByIds() does not return any.
	 *
	 * A game has one row per platform (and per region), so the ids are queried
	 * in small batches and each batch is paged until IGDB stops filling its
	 * 500-row ceiling.
	 */
	public async getReleaseDatesByGameIds(
		ids: number[]
	): Promise<Release_date[]> {
		if (ids.length == 0) return [];

		const sorted = [...ids].sort((a, b) => a - b);
		const cacheKey = `release_dates_games_v3_${sorted.join("_")}`;
		const cached = await this.cacheManager.get<Release_date[]>(cacheKey);
		if (cached) {
			return cached;
		}
		await this.getToken();

		const BATCH_SIZE = 50;
		const PAGE_SIZE = 500;
		const rows: Release_date[] = [];

		try {
			for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
				const batch = sorted.slice(i, i + BATCH_SIZE);
				let offset = 0;
				let page: Release_date[];

				do {
					const body =
						"fields date, game, status.id, status.name, date_format.id," +
						" platform.name, platform.slug, platform.platform_logo.url;" +
						` where game = (${batch.join(",")});` +
						` sort date asc; limit ${PAGE_SIZE}; offset ${offset};`;

					page = await request(this.igdb_url + "/release_dates", {
						method: "POST",
						headers: {
							"Content-Type": "text/plain",
							"Client-ID": process.env.TWITCH_CLIENT,
							Authorization: `Bearer ${this.token.access_token}`,
						},
						body,
					});
					rows.push(...page);
					offset += PAGE_SIZE;
				} while (page.length === PAGE_SIZE);
			}
		} catch (err) {
			this.logger.error(
				`CALL FN -> getReleaseDatesByGameIds -> ERROR -> ${JSON.stringify(err)}`
			);
			return [];
		}

		await this.cacheManager.set(cacheKey, rows, cacheTTL);
		return rows;
	}

	public async getGamesByIds(ids: number[]) {
		if (ids.length == 0) return [];

		// Numeric sort on a copy: the default comparator is lexicographic, so
		// [2,9,10] and [10,9,2] used to produce different keys for the same set,
		// and sorting in place silently reordered the caller's array.
		const cacheKey = `games_ids_${[...ids].sort((a, b) => a - b).join("_")}`;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cached = await this.cacheManager.get<any[]>(cacheKey);
		if (cached) {
			return cached;
		}
		await this.getToken();

		const fields = [
			"id",
			"name",
			// `game_type` a remplacé `category`, qu'IGDB ne renvoie plus du tout :
			// un `fields category` ne remonte rien, et sans bruit.
			"game_type",
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
		return result;
	}

	/**
	 * Recherche IGDB par nom, pour la loupe du calendrier.
	 *
	 * Ne renvoie que des identifiants : l'enrichissement (jaquette, genres,
	 * date de sortie) est fait par `AppService.getGamesByIds`, qui sait déjà
	 * choisir la bonne sortie parmi les rééditions et les lancements régionaux.
	 *
	 * `version_parent = null` écarte les éditions dérivées (« GOTY », « Deluxe »),
	 * qui noieraient le jeu de base sous des doublons. Le filtre sur
	 * `game_type` retire compilations, packs, mods, forks et mises à jour :
	 * sans lui, une recherche « resident evil » remonte d'abord six coffrets.
	 * Les DLC et épisodes restent, eux : ils ont une date de sortie et peuvent
	 * donc apparaître dans le calendrier, où l'on doit pouvoir les retrouver.
	 */
	/**
	 * Recherche par nom, en deux requêtes complémentaires.
	 *
	 * L'opérateur `search` d'IGDB classe par ressemblance mais ne connaît que
	 * les mots entiers : « Clockwork Rev » ne renvoie rien du tout, alors qu'on
	 * tape justement un nom lettre par lettre. Il ignore aussi complètement la
	 * notoriété, si bien que « clockwork » remonte huit obscurités et laisse
	 * « Clockwork Revolution » (104 hypes) hors de la liste.
	 *
	 * `where name ~ *"…"*` répond aux deux : c'est une recherche de sous-chaîne,
	 * qui accepte un mot commencé, et elle se trie par hype. On garde malgré
	 * tout `search` à côté : lui seul retrouve un jeu par un nom alternatif
	 * (« ff7 ») ou malgré une faute de frappe.
	 */
	public async searchGames(
		query: string,
		limit = SEARCH_DEFAULT_LIMIT
	): Promise<IgdbSearchHit[]> {
		const term = sanitizeSearchTerm(query);
		if (!term) return [];

		const size = Math.min(Math.max(limit, 1), SEARCH_MAX_LIMIT);
		const cacheKey = `search_v2_${term.toLowerCase()}_${size}`;
		const cached = await this.cacheManager.get<IgdbSearchHit[]>(cacheKey);
		if (cached) {
			return cached;
		}
		await this.getToken();

		const excluded = `version_parent = null & game_type != (${EXCLUDED_GAME_TYPES.join(",")})`;

		try {
			// Les deux ensemble : elles ne se recouvrent pas, et l'une sans
			// l'autre laisse passer des jeux que l'utilisateur cherche.
			const [byRelevance, byName] = await Promise.all([
				this.searchRequest(
					`search "${term}"; fields id,name;` +
						` where ${excluded}; limit ${size};`
				),
				this.searchRequest(
					`fields id,name,hypes;` +
						` where name ~ *"${term}"* & ${excluded};` +
						` sort hypes desc; limit ${size};`
				),
			]);

			const result = mergeSearchHits(term, byRelevance, byName, size);
			await this.cacheManager.set(cacheKey, result, cacheTTL);
			return result;
		} catch (err) {
			this.logger.error(
				`CALL FN -> searchGames -> ERROR -> ${JSON.stringify(err)}`
			);
			return [];
		}
	}

	/** Le corps d'une requête `/games`, les en-têtes étant toujours les mêmes. */
	private searchRequest(body: string): Promise<IgdbSearchHit[]> {
		return request(this.igdb_url + "/games", {
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
		const cacheKey =
			ids && ids.length > 0
				? `platforms_${ids.sort().join("_")}`
				: "platforms_all";
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cached = await this.cacheManager.get<any[]>(cacheKey);
		if (cached) {
			return cached;
		}
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
		return result;
	}
}
