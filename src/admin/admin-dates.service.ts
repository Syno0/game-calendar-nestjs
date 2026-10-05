import {
	BadGatewayException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { releaseLabels } from "../app.service";
import { Release_date } from "../common/interfaces/igdb.interface";
import { PrismaService } from "../prisma/prisma.service";
import {
	DateSource,
	manualDateRow,
	OverridePrecision,
	OverrideSource,
	rawgDateRow,
	resolveReleaseDate,
} from "../rawg/date-resolution";
import { RawgClient, RawgUsage } from "../rawg/rawg.client";
import { RawgSyncService } from "../rawg/rawg-sync.service";
import { SetDateOverrideDto } from "./dto/admin-dates.dto";

/** Une ligne de l'écran « Dates » : ce que dit chaque source, et ce qui gagne. */
export interface AdminDateRow {
	igdbGameId: number;
	name: string | null;
	hypes: number;
	igdbDate: string | null;
	rawgDate: string | null;
	rawgId: number | null;
	rawgName: string | null;
	rawgUrl: string | null;
	/** La date affichée aujourd'hui dans le calendrier, et sa source. */
	effectiveDate: string | null;
	effectiveSource: DateSource;
	override: {
		source: OverrideSource;
		date: string | null;
		precision: OverridePrecision | null;
		note: string | null;
		updatedAt: string;
	} | null;
	linkMethod: string | null;
	/** Faux pour un portage : la date RAWG est celle de la sortie d'origine. */
	rawgDateApplies: boolean;
}

export interface AdminRawgStatus extends RawgUsage {
	rawgGames: number;
	links: number;
	matched: number;
	overrides: number;
	months: { key: string; syncedAt: string; pages: number }[];
}

type RawRow = {
	igdbGameId: number;
	igdbName: string | null;
	igdbHypes: number | null;
	igdbDate: Date | null;
	igdbPrecision: string | null;
	igdbUpdatedAt: Date | null;
	method: string | null;
	rawgDateApplies: boolean | null;
	rawgId: number | null;
	slug: string | null;
	rawgName: string | null;
	released: Date | null;
	tba: boolean | null;
	releasedSeenAt: Date | null;
	overrideSource: string | null;
	overrideDate: Date | null;
	overridePrecision: string | null;
	note: string | null;
	overrideUpdatedAt: Date | null;
	total: number;
};

const labelOf = (row?: Pick<Release_date, "date" | "date_format">) =>
	row ? releaseLabels(row).label : null;

/**
 * Le pilotage des dates depuis /admin.
 *
 * Les dates IGDB lues ici sont celles recopiées sur `GameLink` au dernier
 * affichage du jeu : l'écran ne rappelle pas IGDB, il montre ce que le
 * calendrier a vu en dernier. La date « retenue » est recalculée avec
 * `resolveReleaseDate`, la même fonction que celle du calendrier, pour que
 * les deux ne puissent pas se contredire.
 */
@Injectable()
export class AdminDatesService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly client: RawgClient,
		private readonly sync: RawgSyncService
	) {}

	/**
	 * `conflicts` : les jeux dont IGDB et RAWG ne donnent pas le même jour,
	 * plus ceux qui portent un forçage. Avec `q`, tous les jeux dont le nom
	 * contient le terme, en désaccord ou non.
	 */
	async list(
		limit: number,
		offset: number,
		q?: string
	): Promise<{ total: number; rows: AdminDateRow[] }> {
		const term = q?.trim();
		const where = term
			? Prisma.sql`l."igdbName" ILIKE ${`%${term}%`}`
			: Prisma.sql`(o."igdbGameId" IS NOT NULL OR (
					l."rawgDateApplies"
					AND r."released" IS NOT NULL AND r."tba" = false
					AND l."igdbDate" IS NOT NULL
					-- Un jour d'écart est un effet de fuseau, pas un désaccord
					-- (même règle que \`sameDay\` dans date-resolution.ts).
					AND abs(r."released" - l."igdbDate"::date) > 1
				))`;

		const rows = await this.prisma.$queryRaw<RawRow[]>`
			SELECT
				COALESCE(l."igdbGameId", o."igdbGameId") AS "igdbGameId",
				l."igdbName", l."igdbHypes", l."igdbDate", l."igdbPrecision",
				l."igdbUpdatedAt", l."method", l."rawgDateApplies",
				r."rawgId", r."slug", r."name" AS "rawgName", r."released", r."tba",
				r."releasedSeenAt",
				o."source" AS "overrideSource", o."date" AS "overrideDate",
				o."precision" AS "overridePrecision", o."note",
				o."updatedAt" AS "overrideUpdatedAt",
				COUNT(*) OVER ()::int AS "total"
			FROM "GameLink" l
			FULL JOIN "GameDateOverride" o ON o."igdbGameId" = l."igdbGameId"
			LEFT JOIN "RawgGame" r ON r."rawgId" = l."rawgId"
			WHERE ${where}
			ORDER BY l."igdbHypes" DESC NULLS LAST, 1
			LIMIT ${limit} OFFSET ${offset}
		`;

		return { total: rows[0]?.total ?? 0, rows: rows.map((row) => this.toRow(row)) };
	}

	async game(igdbGameId: number): Promise<AdminDateRow> {
		const [link, override] = await Promise.all([
			this.prisma.gameLink.findUnique({
				where: { igdbGameId },
				include: { rawg: true },
			}),
			this.prisma.gameDateOverride.findUnique({ where: { igdbGameId } }),
		]);
		if (!link && !override) {
			throw new NotFoundException(
				"Jeu jamais affiché : ouvrez-le une fois dans le calendrier ou la recherche."
			);
		}

		return this.toRow({
			igdbGameId,
			igdbName: link?.igdbName ?? null,
			igdbHypes: link?.igdbHypes ?? 0,
			igdbDate: link?.igdbDate ?? null,
			igdbPrecision: link?.igdbPrecision ?? null,
			igdbUpdatedAt: link?.igdbUpdatedAt ?? null,
			method: link?.method ?? null,
			rawgDateApplies: link?.rawgDateApplies ?? true,
			rawgId: link?.rawg?.rawgId ?? null,
			slug: link?.rawg?.slug ?? null,
			rawgName: link?.rawg?.name ?? null,
			released: link?.rawg?.released ?? null,
			tba: link?.rawg?.tba ?? null,
			releasedSeenAt: link?.rawg?.releasedSeenAt ?? null,
			overrideSource: override?.source ?? null,
			overrideDate: override?.date ?? null,
			overridePrecision: override?.precision ?? null,
			note: override?.note ?? null,
			overrideUpdatedAt: override?.updatedAt ?? null,
			total: 1,
		});
	}

	async setOverride(igdbGameId: number, dto: SetDateOverrideDto) {
		const manual = dto.source === "manual";
		const data = {
			source: dto.source,
			date: manual ? new Date(`${dto.date}T00:00:00Z`) : null,
			precision: manual ? dto.precision : null,
			note: dto.note?.trim() || null,
		};
		await this.prisma.gameDateOverride.upsert({
			where: { igdbGameId },
			create: { igdbGameId, ...data },
			update: data,
		});
		return this.game(igdbGameId);
	}

	async clearOverride(igdbGameId: number): Promise<void> {
		await this.prisma.gameDateOverride.deleteMany({ where: { igdbGameId } });
	}

	/**
	 * Corrige à la main la fiche RAWG d'un jeu. Le lien passe en `manual`, ce
	 * qui le soustrait définitivement au rapprochement automatique.
	 */
	async setLink(igdbGameId: number, rawgId: number | null) {
		if (rawgId) {
			const known = await this.prisma.rawgGame.findUnique({ where: { rawgId } });
			if (!known && !(await this.sync.fetchGame(rawgId))) {
				throw new BadGatewayException(
					"Fiche RAWG introuvable (identifiant inconnu, quota atteint ou RAWG indisponible)."
				);
			}
		}

		await this.prisma.gameLink.upsert({
			where: { igdbGameId },
			create: { igdbGameId, rawgId, method: "manual", score: 1 },
			update: { rawgId, method: "manual", score: 1, checkedAt: new Date() },
		});
		return this.game(igdbGameId);
	}

	async status(): Promise<AdminRawgStatus> {
		const [usage, rawgGames, links, matched, overrides, months] = await Promise.all([
			this.client.usage(),
			this.prisma.rawgGame.count(),
			this.prisma.gameLink.count(),
			this.prisma.gameLink.count({ where: { rawgId: { not: null } } }),
			this.prisma.gameDateOverride.count(),
			this.prisma.rawgSyncState.findMany({ orderBy: { key: "asc" } }),
		]);

		return {
			...usage,
			rawgGames,
			links,
			matched,
			overrides,
			months: months.map((month) => ({
				key: month.key.replace(/^month:/, ""),
				syncedAt: month.syncedAt.toISOString(),
				pages: month.pages,
			})),
		};
	}

	private toRow(row: RawRow): AdminDateRow {
		const precision = (row.igdbPrecision ?? "day") as OverridePrecision;
		const igdbBase = row.igdbDate
			? manualDateRow({ source: "manual", date: row.igdbDate, precision })
			: undefined;
		const igdbRow = igdbBase
			? ({
					...igdbBase,
					updated_at: row.igdbUpdatedAt
						? Math.floor(row.igdbUpdatedAt.getTime() / 1000)
						: undefined,
				} as Release_date)
			: undefined;

		const rawg =
			row.rawgId !== null
				? {
						released: row.released,
						tba: !!row.tba,
						releasedSeenAt: row.releasedSeenAt,
					}
				: null;
		const override = row.overrideSource
			? {
					source: row.overrideSource as OverrideSource,
					date: row.overrideDate,
					precision: row.overridePrecision as OverridePrecision,
				}
			: null;

		// Même règle que le calendrier : la date RAWG d'un portage n'entre en
		// jeu que si elle est imposée.
		const applies = row.rawgDateApplies ?? true;
		const resolved = resolveReleaseDate(
			igdbRow,
			applies || override?.source === "rawg" ? rawg : null,
			override
		);

		return {
			igdbGameId: row.igdbGameId,
			name: row.igdbName,
			hypes: row.igdbHypes ?? 0,
			igdbDate: labelOf(igdbRow),
			rawgDate: labelOf(rawgDateRow(rawg)),
			rawgId: row.rawgId,
			rawgName: row.rawgName,
			rawgUrl: row.slug ? `https://rawg.io/games/${row.slug}` : null,
			effectiveDate: labelOf(resolved.row),
			effectiveSource: resolved.source,
			override: override
				? {
						...override,
						date: row.overrideDate?.toISOString().slice(0, 10) ?? null,
						note: row.note,
						updatedAt: row.overrideUpdatedAt.toISOString(),
					}
				: null,
			linkMethod: row.method,
			rawgDateApplies: applies,
		};
	}
}
