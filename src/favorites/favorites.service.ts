import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AppService } from "../app.service";
import { CreateFavoriteDto } from "./dto/favorite.dto";

@Injectable()
export class FavoritesService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly appService: AppService
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
}
