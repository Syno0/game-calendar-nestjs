import { Injectable, Logger } from "@nestjs/common";
import { GameDateOverride, GameLink, RawgGame } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
	DateOverrideInfo,
	OverridePrecision,
	OverrideSource,
	RawgDateInfo,
} from "./date-resolution";
import { MatchRequest, monthsBetween, RawgSyncService } from "./rawg-sync.service";

/** Ce que la base sait d'un jeu IGDB côté RAWG. */
export interface RawgInfo {
	link?: GameLink & { rawg: RawgGame | null };
	override?: GameDateOverride;
}

/** Les champs RAWG exposés dans le payload d'un jeu. */
export interface RawgPayload {
	id: number;
	slug: string;
	url: string;
	rating: number | null;
	ratings_count: number | null;
	added: number | null;
	/** Joueurs qui l'ont mis dans leurs envies (`added_by_status.toplay`). */
	wishlist: number;
	esrb: string | null;
	playtime: number | null;
}

export const rawgDateOf = (info?: RawgInfo): RawgDateInfo | null => {
	const rawg = info?.link?.rawg;
	return rawg
		? { released: rawg.released, tba: rawg.tba, releasedSeenAt: rawg.releasedSeenAt }
		: null;
};

export const overrideOf = (info?: RawgInfo): DateOverrideInfo | null =>
	info?.override
		? {
				source: info.override.source as OverrideSource,
				date: info.override.date,
				precision: (info.override.precision as OverridePrecision) ?? null,
			}
		: null;

export const rawgPayloadOf = (info?: RawgInfo): RawgPayload | null => {
	const rawg = info?.link?.rawg;
	if (!rawg) return null;

	const byStatus = (rawg.addedByStatus ?? {}) as Record<string, number>;
	return {
		id: rawg.rawgId,
		slug: rawg.slug,
		url: `https://rawg.io/games/${rawg.slug}`,
		rating: rawg.rating,
		ratings_count: rawg.ratingsCount,
		added: rawg.added,
		wishlist: byStatus.toplay ?? 0,
		esrb: rawg.esrb,
		playtime: rawg.playtime,
	};
};

const sameTime = (a: Date | null, b: Date | null): boolean =>
	(a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * La face de RAWG que voit le reste de l'application.
 *
 * Tout ce qui est appelé pendant une requête ne lit que PostgreSQL et ne
 * lève jamais : une base indisponible ou une table vide rendent simplement le
 * calendrier tel qu'il était avant RAWG. Les appels à RAWG eux-mêmes sont
 * déposés dans la file de `RawgSyncService`, jamais attendus.
 */
@Injectable()
export class RawgService {
	private readonly logger = new Logger(RawgService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly sync: RawgSyncService
	) {}

	async lookup(ids: number[]): Promise<Map<number, RawgInfo>> {
		const infos = new Map<number, RawgInfo>();
		const unique = [...new Set(ids)];
		if (unique.length === 0) return infos;

		try {
			const [links, overrides] = await Promise.all([
				this.prisma.gameLink.findMany({
					where: { igdbGameId: { in: unique } },
					include: { rawg: true },
				}),
				this.prisma.gameDateOverride.findMany({
					where: { igdbGameId: { in: unique } },
				}),
			]);
			for (const link of links) infos.set(link.igdbGameId, { link });
			for (const override of overrides) {
				infos.set(override.igdbGameId, {
					...infos.get(override.igdbGameId),
					override,
				});
			}
		} catch (error) {
			this.logger.warn(`RAWG lookup skipped: ${(error as Error).message}`);
		}
		return infos;
	}

	/**
	 * Les jeux qu'une date venue d'ailleurs qu'IGDB fait tomber entre `start`
	 * et `end` : un forçage manuel, ou une date RAWG susceptible de l'emporter.
	 *
	 * C'est une présélection : la décision finale revient à
	 * `resolveReleaseDate`, une fois les lignes IGDB chargées. Elle écarte
	 * seulement, sans rien demander à IGDB, les jeux où IGDB garde la main à
	 * coup sûr.
	 */
	async findMovedInto(start: string, end: string, minHypes = 0): Promise<number[]> {
		const from = new Date(`${start}T00:00:00Z`);
		const to = new Date(`${end}T00:00:00Z`);

		try {
			const [manual, links] = await Promise.all([
				this.prisma.gameDateOverride.findMany({
					where: { source: "manual", date: { gte: from, lte: to } },
					select: { igdbGameId: true },
				}),
				this.prisma.gameLink.findMany({
					where: {
						igdbHypes: { gte: minHypes },
						rawg: { released: { gte: from, lte: to }, tba: false },
					},
					select: {
						igdbGameId: true,
						igdbDate: true,
						igdbUpdatedAt: true,
						rawgDateApplies: true,
						rawg: { select: { releasedSeenAt: true } },
					},
				}),
			]);

			const overrides = new Map(
				(
					await this.prisma.gameDateOverride.findMany({
						where: { igdbGameId: { in: links.map((link) => link.igdbGameId) } },
						select: { igdbGameId: true, source: true },
					})
				).map((override) => [override.igdbGameId, override.source])
			);

			const fromRawg = links
				.filter((link) => {
					const forced = overrides.get(link.igdbGameId);
					if (forced) return forced === "rawg";
					if (!link.rawgDateApplies) return false;
					if (!link.igdbDate) return true;
					const seen = link.rawg?.releasedSeenAt;
					return !!seen && !!link.igdbUpdatedAt && seen > link.igdbUpdatedAt;
				})
				.map((link) => link.igdbGameId);

			return [...new Set([...manual.map((row) => row.igdbGameId), ...fromRawg])];
		} catch (error) {
			this.logger.warn(`RAWG moved games skipped: ${(error as Error).message}`);
			return [];
		}
	}

	/** Demande la synchro des mois d'un intervalle, sans l'attendre. */
	ensureMonths(start: string, end: string): void {
		void this.sync.requestMonths(monthsBetween(start, end));
	}

	/**
	 * Ce que l'affichage vient d'apprendre, transmis à la tâche de fond : les
	 * jeux sans correspondance sont mis en file, et l'état IGDB recopié sur
	 * les liens existants quand il a bougé — c'est lui que /admin et
	 * `findMovedInto` consultent.
	 */
	observe(games: MatchRequest[], infos: Map<number, RawgInfo>): void {
		const stale: MatchRequest[] = [];

		for (const game of games) {
			const link = infos.get(game.id)?.link;
			if (!link || (!link.rawgId && link.method !== "manual")) {
				this.sync.requestMatch(game);
				continue;
			}
			if (
				link.igdbHypes !== game.hypes ||
				link.igdbName !== game.name ||
				link.igdbPrecision !== game.igdbPrecision ||
				!sameTime(link.igdbDate, game.igdbDate) ||
				!sameTime(link.igdbUpdatedAt, game.igdbUpdatedAt) ||
				link.rawgDateApplies !== game.rawgDateApplies
			) {
				stale.push(game);
			}
		}

		if (stale.length === 0) return;
		this.prisma
			.$transaction(
				stale.map((game) =>
					this.prisma.gameLink.update({
						where: { igdbGameId: game.id },
						data: {
							igdbName: game.name,
							igdbHypes: game.hypes,
							igdbDate: game.igdbDate,
							igdbPrecision: game.igdbPrecision,
							igdbUpdatedAt: game.igdbUpdatedAt,
							rawgDateApplies: game.rawgDateApplies,
						},
					})
				)
			)
			.catch((error) =>
				this.logger.warn(`RAWG link snapshot skipped: ${(error as Error).message}`)
			);
	}
}
