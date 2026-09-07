import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AppService } from "../app.service";
import { CreateFavoriteDto } from "./dto/favorite.dto";
import { FavoritesImageService, ImageLayout } from "./favorites-image.service";

/**
 * 16 octets en base64url : assez large pour qu'un lien ne se devine pas et ne
 * s'énumère pas, assez court pour rester collable.
 */
const SHARE_TOKEN_BYTES = 16;

/** La marque affichée en tête de l'image partagée, à côté du logo. */
const SITE_URL = process.env.PUBLIC_SITE_URL || "gamecalendar.app";

@Injectable()
export class FavoritesService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly appService: AppService,
		private readonly imageService: FavoritesImageService
	) {}

	list(userId: string) {
		return this.prisma.favorite.findMany({
			where: { userId },
			orderBy: { createdAt: "desc" },
			select: {
				igdbGameId: true,
				gameName: true,
				coverUrl: true,
				platformSlug: true,
				createdAt: true,
			},
		});
	}

	add(userId: string, dto: CreateFavoriteDto) {
		const snapshot = {
			gameName: dto.name,
			coverUrl: dto.coverUrl ?? null,
			platformSlug: dto.platformSlug ?? null,
		};

		// Idempotent: re-favoriting simply refreshes the snapshot.
		return this.prisma.favorite.upsert({
			where: { userId_igdbGameId: { userId, igdbGameId: dto.igdbGameId } },
			create: { userId, igdbGameId: dto.igdbGameId, ...snapshot },
			update: snapshot,
			select: {
				igdbGameId: true,
				gameName: true,
				coverUrl: true,
				platformSlug: true,
				createdAt: true,
			},
		});
	}

	/**
	 * Combien d'utilisateurs ont ce jeu en favori.
	 *
	 * Agrégat volontairement non nominatif : c'est un compteur public affiché
	 * dans la fiche du jeu, il ne dit jamais *qui* a mis le jeu en favori.
	 */
	countForGame(igdbGameId: number): Promise<number> {
		return this.prisma.favorite.count({ where: { igdbGameId } });
	}

	async remove(userId: string, igdbGameId: number) {
		await this.prisma.favorite.deleteMany({ where: { userId, igdbGameId } });
	}

	/** Favorites as full game objects, same shape as POST /games. */
	async listGames(userId: string) {
		const favorites = await this.prisma.favorite.findMany({
			where: { userId },
			select: { igdbGameId: true, platformSlug: true },
		});
		if (favorites.length === 0) return [];

		// The platform the user favorited it on disambiguates games released
		// more than once — a regional launch followed by a worldwide one.
		const platformByGame = new Map(
			favorites
				.filter((f) => f.platformSlug)
				.map((f) => [f.igdbGameId, f.platformSlug])
		);

		return this.appService.getGamesByIds(
			favorites.map((f) => f.igdbGameId),
			platformByGame
		);
	}

	// ─── Partage public ────────────────────────────────────────────────────────

	/** Le lien actif de l'utilisateur, s'il en a un. */
	async getShareToken(userId: string): Promise<{ token: string | null }> {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { shareToken: true },
		});
		return { token: user?.shareToken ?? null };
	}

	/**
	 * Crée le lien public, ou le fait tourner s'il en existe déjà un.
	 *
	 * Écraser le jeton *est* la révocation : l'ancienne URL cesse aussitôt de
	 * résoudre. C'est ce qui permet de reprendre la main sur un lien parti trop
	 * loin sans avoir à supprimer quoi que ce soit.
	 */
	async createShareToken(userId: string): Promise<{ token: string }> {
		const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
		await this.prisma.user.update({
			where: { id: userId },
			data: { shareToken: token, shareCreatedAt: new Date() },
		});
		return { token };
	}

	async revokeShareToken(userId: string): Promise<void> {
		await this.prisma.user.update({
			where: { id: userId },
			data: { shareToken: null, shareCreatedAt: null },
		});
	}

	/**
	 * La liste derrière un lien public.
	 *
	 * Ne rend que ce que le partage assume : le nom affiché, l'avatar et les
	 * jeux. Ni l'adresse e-mail, ni l'identifiant interne, ni les fournisseurs
	 * d'authentification ne traversent.
	 */
	async publicFavorites(token: string) {
		const user = await this.prisma.user.findUnique({
			where: { shareToken: token },
			select: { id: true, displayName: true, avatarUrl: true },
		});
		if (!user) throw new NotFoundException("Unknown share link");

		return {
			displayName: user.displayName,
			avatarUrl: user.avatarUrl,
			games: await this.listGames(user.id),
		};
	}

	/**
	 * L'image partageable d'une année.
	 *
	 * Le tri par date puis par nom rend l'image stable : deux appels sur la même
	 * liste donnent la même mosaïque, ce qui est ce que le cache suppose.
	 */
	async renderImage(
		userId: string,
		displayName: string,
		year: number,
		layout: ImageLayout
	): Promise<Buffer> {
		const games = await this.listGames(userId);
		const ofYear = games
			.filter((game) => releaseYear(game) === year)
			.sort(
				(a, b) =>
					(a.release_at ?? "").localeCompare(b.release_at ?? "") ||
					a.name.localeCompare(b.name)
			);

		return this.imageService.render(
			ofYear,
			{ displayName, year, layout, siteUrl: SITE_URL },
			userId
		);
	}

	/** L'image derrière un lien public, sans jamais exposer l'id interne. */
	async renderPublicImage(token: string, year: number, layout: ImageLayout) {
		const user = await this.prisma.user.findUnique({
			where: { shareToken: token },
			select: { id: true, displayName: true },
		});
		if (!user) throw new NotFoundException("Unknown share link");

		return this.renderImage(user.id, user.displayName, year, layout);
	}
}

/**
 * L'année de sortie d'un jeu enrichi.
 *
 * `release_at` (ISO) et non `date` (« JJ/MM/AAAA ») : ce dernier est lu comme
 * M/J/A par `Date`, ce qui range un jeu dans la mauvaise année une fois sur
 * deux. Même raisonnement que `releaseDate` côté front.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function releaseYear(game: any): number | null {
	if (!game?.release_at) return null;
	const parsed = new Date(game.release_at);
	return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}
