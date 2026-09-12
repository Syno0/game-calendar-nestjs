import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Les agrégats du back-office.
 *
 * Deux propriétés du schéma décident de ce qui est calculable ici :
 *
 *  - `createdAt` existe sur User, Account et Favorite, donc toutes les séries
 *    temporelles sont à portée de SQL ;
 *  - `Favorite` recopie `gameName`, `coverUrl` et `platformSlug` à chaque
 *    ligne, donc le classement des jeux se rend avec noms et jaquettes sans
 *    un seul appel à IGDB.
 *
 * Ce qui n'est pas calculable est tout aussi structurant, et vaut d'être dit
 * plutôt que contourné : les genres et les dates de sortie vivent chez IGDB
 * (seul `igdbGameId` est stocké) ; la seule table d'événements est
 * `ShareImageRender`, donc on sait compter les images de partage mais ni les
 * pages vues ni les connexions ; et `remove` est un
 * `deleteMany` sec, sans pierre tombale, donc le désabonnement est
 * rétroactivement invisible.
 *
 * Pas de mise en cache : la base compte aujourd'hui quelques dizaines de
 * lignes et les index manquants (rien sur `igdbGameId` seul ni sur
 * `createdAt`) ne coûtent rien à cette échelle. À revoir au-delà d'environ
 * 50 000 favoris — un index et un TTL court sur `overview` suffiront.
 */

/** Seaux de l'histogramme. Bornes hautes incluses, `null` = sans plafond. */
const FAVORITE_BUCKETS: { label: string; min: number; max: number | null }[] = [
	{ label: "0", min: 0, max: 0 },
	{ label: "1", min: 1, max: 1 },
	{ label: "2-5", min: 2, max: 5 },
	{ label: "6-10", min: 6, max: 10 },
	{ label: "11-25", min: 11, max: 25 },
	{ label: "26+", min: 26, max: null },
];

export interface AdminOverview {
	totals: {
		users: number;
		favorites: number;
		distinctGames: number;
		shareLinks: number;
		/** Images de partage demandées, cache compris. */
		shareImages: number;
		/** Celles qui ont vraiment été dessinées : les autres sortaient du cache. */
		shareImagesRendered: number;
		/** Celles demandées via un lien public, donc pas par le propriétaire. */
		shareImagesViaLink: number;
	};
	recent: {
		usersLast7d: number;
		usersLast30d: number;
		favoritesLast7d: number;
		favoritesLast30d: number;
		shareImagesLast7d: number;
		shareImagesLast30d: number;
	};
	engagement: {
		usersWithFavorites: number;
		usersWithoutFavorites: number;
		activationRate: number;
		averagePerUser: number;
		medianPerUser: number;
	};
	providers: { provider: string; accounts: number }[];
	multiProviderUsers: number;
	platforms: { platform: string; favorites: number }[];
	distribution: { label: string; users: number }[];
}

export interface AdminGameRow {
	igdbGameId: number;
	name: string;
	coverUrl: string | null;
	favorites: number;
	lastAddedAt: Date;
}

export interface AdminUserRow {
	id: string;
	displayName: string;
	avatarUrl: string | null;
	createdAt: Date;
	lastSeenAt: Date;
	favorites: number;
	providers: string[];
	hasShareLink: boolean;
	/** Images de partage demandées pour la liste de cet utilisateur. */
	shareImages: number;
}

export interface AdminTimelinePoint {
	day: string;
	users: number;
	favorites: number;
}

@Injectable()
export class AdminStatsService {
	constructor(private readonly prisma: PrismaService) {}

	async overview(): Promise<AdminOverview> {
		const since = (days: number) =>
			new Date(Date.now() - days * 24 * 60 * 60 * 1000);
		const d7 = since(7);
		const d30 = since(30);

		/*
		 * Un seul aller-retour : ces comptes sont indépendants les uns des
		 * autres et les enchaîner ne ferait qu'additionner les latences.
		 */
		const [
			users,
			favorites,
			shareLinks,
			usersLast7d,
			usersLast30d,
			favoritesLast7d,
			favoritesLast30d,
			perUser,
			providerRows,
			platformRows,
			distinctGameRows,
			shareImages,
			shareImagesRendered,
			shareImagesViaLink,
			shareImagesLast7d,
			shareImagesLast30d,
		] = await Promise.all([
			this.prisma.user.count(),
			this.prisma.favorite.count(),
			this.prisma.user.count({ where: { shareToken: { not: null } } }),
			this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
			this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
			this.prisma.favorite.count({ where: { createdAt: { gte: d7 } } }),
			this.prisma.favorite.count({ where: { createdAt: { gte: d30 } } }),
			/*
			 * Le nombre de favoris de chaque utilisateur, y compris ceux qui
			 * n'en ont aucun — d'où le LEFT JOIN plutôt qu'un `groupBy` sur
			 * Favorite, qui ne verrait jamais les comptes vides. Ce sont
			 * pourtant eux le signal le plus parlant à ce stade.
			 */
			this.prisma.$queryRaw<{ count: number }[]>`
				SELECT COUNT(f.id)::int AS count
				FROM "User" u
				LEFT JOIN "Favorite" f ON f."userId" = u.id
				GROUP BY u.id
			`,
			this.prisma.$queryRaw<{ provider: string; accounts: number }[]>`
				SELECT provider::text AS provider, COUNT(*)::int AS accounts
				FROM "Account"
				GROUP BY provider
				ORDER BY accounts DESC
			`,
			this.prisma.$queryRaw<{ platform: string; favorites: number }[]>`
				SELECT COALESCE("platformSlug", 'unknown') AS platform,
				       COUNT(*)::int AS favorites
				FROM "Favorite"
				GROUP BY 1
				ORDER BY favorites DESC
			`,
			this.prisma.$queryRaw<{ count: number }[]>`
				SELECT COUNT(DISTINCT "igdbGameId")::int AS count FROM "Favorite"
			`,
			this.prisma.shareImageRender.count(),
			this.prisma.shareImageRender.count({ where: { cached: false } }),
			this.prisma.shareImageRender.count({ where: { viaShareLink: true } }),
			this.prisma.shareImageRender.count({ where: { createdAt: { gte: d7 } } }),
			this.prisma.shareImageRender.count({ where: { createdAt: { gte: d30 } } }),
		]);

		const counts = perUser.map((row) => Number(row.count)).sort((a, b) => a - b);
		const usersWithFavorites = counts.filter((n) => n > 0).length;

		/*
		 * Un utilisateur peut relier Twitch et Discord au même compte quand
		 * l'adresse est vérifiée (cf. user-auth.service.ts) : la somme des
		 * comptes par fournisseur dépasse donc le nombre d'utilisateurs, et
		 * la répartition ne se lit correctement qu'avec ce chiffre à côté.
		 */
		const multiProvider = await this.prisma.$queryRaw<{ count: number }[]>`
			SELECT COUNT(*)::int AS count FROM (
				SELECT "userId" FROM "Account"
				GROUP BY "userId" HAVING COUNT(DISTINCT provider) > 1
			) AS t
		`;

		return {
			totals: {
				users,
				favorites,
				distinctGames: Number(distinctGameRows[0]?.count ?? 0),
				shareLinks,
				shareImages,
				shareImagesRendered,
				shareImagesViaLink,
			},
			recent: {
				usersLast7d,
				usersLast30d,
				favoritesLast7d,
				favoritesLast30d,
				shareImagesLast7d,
				shareImagesLast30d,
			},
			engagement: {
				usersWithFavorites,
				usersWithoutFavorites: users - usersWithFavorites,
				activationRate: users ? usersWithFavorites / users : 0,
				averagePerUser: users ? favorites / users : 0,
				medianPerUser: median(counts),
			},
			providers: providerRows.map((row) => ({
				provider: row.provider,
				accounts: Number(row.accounts),
			})),
			multiProviderUsers: Number(multiProvider[0]?.count ?? 0),
			platforms: platformRows.map((row) => ({
				platform: row.platform,
				favorites: Number(row.favorites),
			})),
			distribution: FAVORITE_BUCKETS.map((bucket) => ({
				label: bucket.label,
				users: counts.filter(
					(n) => n >= bucket.min && (bucket.max === null || n <= bucket.max)
				).length,
			})),
		};
	}

	/**
	 * Le classement des jeux, en une requête et sans réseau.
	 *
	 * `MAX(gameName)` et `MAX(coverUrl)` ne cherchent pas un maximum : les
	 * lignes d'un même jeu portent la même valeur recopiée, et il faut bien
	 * une fonction d'agrégat pour sortir une colonne non groupée. C'est le
	 * moyen le plus court d'obtenir un représentant.
	 */
	async topGames(limit: number): Promise<AdminGameRow[]> {
		const rows = await this.prisma.$queryRaw<
			{
				igdbGameId: number;
				name: string;
				coverUrl: string | null;
				favorites: number;
				lastAddedAt: Date;
			}[]
		>`
			SELECT "igdbGameId",
			       MAX("gameName")  AS name,
			       MAX("coverUrl")  AS "coverUrl",
			       COUNT(*)::int    AS favorites,
			       MAX("createdAt") AS "lastAddedAt"
			FROM "Favorite"
			GROUP BY "igdbGameId"
			ORDER BY favorites DESC, "lastAddedAt" DESC
			LIMIT ${limit}
		`;
		return rows.map((row) => ({
			...row,
			igdbGameId: Number(row.igdbGameId),
			favorites: Number(row.favorites),
		}));
	}

	/**
	 * `updatedAt` sert de « dernière activité » : il est touché à chaque
	 * connexion OAuth, `upsertUser` rafraîchissant le pseudo et l'avatar à
	 * chaque échange. L'approximation a ses limites — il bouge aussi quand un
	 * lien de partage change — mais c'est le seul signal d'activité que le
	 * schéma porte, faute de table d'événements.
	 */
	async users(limit: number, offset: number): Promise<AdminUserRow[]> {
		const rows = await this.prisma.$queryRaw<
			{
				id: string;
				displayName: string;
				avatarUrl: string | null;
				createdAt: Date;
				lastSeenAt: Date;
				favorites: number;
				providers: string[] | null;
				hasShareLink: boolean;
				shareImages: number;
			}[]
		>`
			SELECT u.id,
			       u."displayName",
			       u."avatarUrl",
			       u."createdAt",
			       u."updatedAt" AS "lastSeenAt",
			       (u."shareToken" IS NOT NULL) AS "hasShareLink",
			       COUNT(DISTINCT f.id)::int AS favorites,
			       COUNT(DISTINCT s.id)::int AS "shareImages",
			       ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.provider::text), NULL) AS providers
			FROM "User" u
			LEFT JOIN "Favorite" f ON f."userId" = u.id
			LEFT JOIN "Account"  a ON a."userId" = u.id
			-- DISTINCT sur les trois comptes, pas seulement sur les deux
			-- premiers : chaque jointure multiplie les lignes des autres.
			LEFT JOIN "ShareImageRender" s ON s."userId" = u.id
			GROUP BY u.id
			ORDER BY favorites DESC, u."createdAt" DESC
			LIMIT ${limit} OFFSET ${offset}
		`;
		return rows.map((row) => ({
			...row,
			favorites: Number(row.favorites),
			shareImages: Number(row.shareImages),
			providers: row.providers ?? [],
		}));
	}

	/**
	 * Deux séries alignées sur le même axe.
	 *
	 * `generate_series` porte l'axe plutôt que les données : sans lui, un jour
	 * sans inscription n'apparaîtrait pas du tout et la courbe relierait deux
	 * points distants comme s'ils étaient voisins. Les trous doivent valoir
	 * zéro, pas disparaître.
	 */
	async timeline(days: number): Promise<AdminTimelinePoint[]> {
		const rows = await this.prisma.$queryRaw<
			{ day: Date; users: number; favorites: number }[]
		>`
			WITH axis AS (
				SELECT generate_series(
					-- Le cast n'est pas décoratif : Prisma transmet les nombres
					-- JavaScript en bigint, et make_interval n'a pas de surcharge
					-- pour ce type — sans lui, Postgres répond 42883.
					date_trunc('day', NOW()) - MAKE_INTERVAL(days => ${days}::int - 1),
					date_trunc('day', NOW()),
					'1 day'
				) AS day
			)
			SELECT axis.day,
			       COALESCE(u.count, 0)::int AS users,
			       COALESCE(f.count, 0)::int AS favorites
			FROM axis
			LEFT JOIN (
				SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
				FROM "User" GROUP BY 1
			) u ON u.day = axis.day
			LEFT JOIN (
				SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
				FROM "Favorite" GROUP BY 1
			) f ON f.day = axis.day
			ORDER BY axis.day
		`;
		return rows.map((row) => ({
			day: row.day.toISOString().slice(0, 10),
			users: Number(row.users),
			favorites: Number(row.favorites),
		}));
	}
}

/** Médiane d'un tableau déjà trié. La moyenne seule ment dès qu'un compte domine. */
function median(sorted: number[]): number {
	if (!sorted.length) return 0;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[mid]
		: (sorted[mid - 1] + sorted[mid]) / 2;
}
