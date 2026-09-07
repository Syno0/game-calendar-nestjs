import {
	Controller,
	Get,
	Header,
	Param,
	Query,
	Res,
	UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Response } from "express";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { FavoritesService } from "./favorites.service";
import { parseImageQuery } from "./favorites-image.query";

/**
 * Le versant public du partage : ce que voit quelqu'un qui a reçu un lien.
 *
 * Contrôleur séparé parce que la garde diffère, comme pour
 * `FavoriteStatsController`. Ici c'est le compte de service qui interroge —
 * le visiteur n'a pas de session, et c'est bien le but.
 *
 * Le jeton est la seule clé : sans lui rien n'est accessible, et le
 * régénérer côté propriétaire suffit à fermer la porte.
 */
@ApiTags("Favorites")
@Controller("favorites/public")
@UseGuards(AuthGuard("jwt"))
export class FavoritesShareController {
	constructor(private readonly favoritesService: FavoritesService) {}

	@Get(":token")
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Favorites behind a public share link" })
	@ApiResponse({ status: 200, description: "{ displayName, avatarUrl, games }" })
	@ApiResponse({ status: 404, description: "Unknown or revoked link" })
	list(@Param("token") token: string) {
		return this.favoritesService.publicFavorites(token);
	}

	@Get(":token/image")
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Shareable PNG for one year of a public list" })
	@ApiResponse({ status: 200, description: "image/png" })
	@ApiResponse({ status: 404, description: "Unknown or revoked link" })
	@Header("Content-Type", "image/png")
	async image(
		@Param("token") token: string,
		@Query("year") year: string,
		@Query("layout") layout: string,
		@Res() res: Response
	) {
		const parsed = parseImageQuery(year, layout);
		const png = await this.favoritesService.renderPublicImage(
			token,
			parsed.year,
			parsed.layout
		);
		// Le jeton fait partie de l'URL : le cache doit rester privé au client,
		// pas s'installer dans un intermédiaire partagé.
		res.setHeader("Cache-Control", "private, max-age=300");
		res.end(png);
	}
}
