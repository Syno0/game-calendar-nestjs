import { Injectable } from "@nestjs/common";
import { IgdbApi, SEARCH_DEFAULT_LIMIT } from "./clients/igdb";
import categoryEnum from "./common/enums/category";
import statusEnum from "./common/enums/status";
import { Release_date } from "./common/interfaces/igdb.interface";
import * as dayjs from "dayjs";

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

		const sorted = [...candidates].sort((a, b) => a.date - b.date);
		if (!preferUpcoming) return sorted[0];

		const now = Math.floor(Date.now() / 1000);
		// Next release still ahead of us, otherwise the most recent one behind.
		return sorted.find((row) => row.date >= now) ?? sorted[sorted.length - 1];
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
			x.date = game ? dayjs.unix(game.date).format("DD/MM/YYYY") : null;
			x.day = game ? dayjs.unix(game.date).format("DD") : null;
			// Unambiguous companion to `date`: "12/03/2026" is parsed as M/D/Y by
			// the browser, which would silently misfile a whole year of favorites.
			x.release_at = game ? dayjs.unix(game.date).toISOString() : null;

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
