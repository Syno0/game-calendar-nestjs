import { Controller, Get, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { FavoritesService } from "./favorites.service";

/**
 * Le versant public des favoris : des compteurs, jamais des noms.
 *
 * Contrôleur séparé parce que la garde n'est pas la même. `FavoritesController`
 * exige la session de l'utilisateur — c'est *sa* liste qu'il manipule. Ici on
 * ne rend qu'un agrégat, affiché dans la fiche d'un jeu y compris à un
 * visiteur non connecté : c'est donc le compte de service qui interroge, comme
 * pour `/games`.
 */
@ApiTags("Favorites")
@Controller("favorites")
@UseGuards(AuthGuard("jwt"))
export class FavoriteStatsController {
	constructor(private readonly favoritesService: FavoritesService) {}

	@Get("count/:igdbGameId")
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "How many users favorited a game" })
	@ApiResponse({ status: 200, description: "{ igdbGameId, count }" })
	@ApiResponse({ status: 401, description: "Unauthorized" })
	async count(
		@Param("igdbGameId", ParseIntPipe) igdbGameId: number
	): Promise<{ igdbGameId: number; count: number }> {
		return {
			igdbGameId,
			count: await this.favoritesService.countForGame(igdbGameId),
		};
	}
}
