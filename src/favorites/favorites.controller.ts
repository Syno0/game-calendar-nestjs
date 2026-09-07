import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	Param,
	ParseIntPipe,
	Post,
	Query,
	Request,
	Res,
	UseGuards,
	UsePipes,
	ValidationPipe,
} from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FavoritesService } from "./favorites.service";
import { CreateFavoriteDto } from "./dto/favorite.dto";
import { parseImageQuery } from "./favorites-image.query";

@ApiTags("Favorites")
@Controller("favorites")
@UseGuards(AuthGuard("user-jwt"))
// Scoped on purpose — see the note in user-auth.controller.ts.
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FavoritesController {
	constructor(private readonly favoritesService: FavoritesService) {}

	@Get()
	@ApiOperation({ summary: "List the current user's favorites (light)" })
	@ApiResponse({ status: 200, description: "Favorite snapshots" })
	list(@Request() req) {
		return this.favoritesService.list(req.user.id);
	}

	@Get("games")
	@ApiOperation({ summary: "Favorites as fully-enriched games" })
	@ApiResponse({ status: 200, description: "Games, date possibly null (TBA)" })
	listGames(@Request() req) {
		return this.favoritesService.listGames(req.user.id);
	}

	@Post()
	@ApiOperation({ summary: "Add a game to the favorites" })
	@ApiResponse({ status: 201, description: "Favorite created or refreshed" })
	add(@Request() req, @Body() body: CreateFavoriteDto) {
		return this.favoritesService.add(req.user.id, body);
	}

	@Get("share")
	@ApiOperation({ summary: "The current public share link, if any" })
	@ApiResponse({ status: 200, description: "{ token: string | null }" })
	getShare(@Request() req) {
		return this.favoritesService.getShareToken(req.user.id);
	}

	@Post("share")
	@ApiOperation({ summary: "Create the public share link, or rotate it" })
	@ApiResponse({ status: 201, description: "{ token }" })
	createShare(@Request() req) {
		return this.favoritesService.createShareToken(req.user.id);
	}

	@Delete("share")
	@HttpCode(204)
	@ApiOperation({ summary: "Revoke the public share link" })
	@ApiResponse({ status: 204, description: "Link revoked" })
	revokeShare(@Request() req) {
		return this.favoritesService.revokeShareToken(req.user.id);
	}

	@Get("image")
	@ApiOperation({ summary: "Shareable PNG for one year of my favorites" })
	@ApiResponse({ status: 200, description: "image/png" })
	@Header("Content-Type", "image/png")
	async image(
		@Request() req,
		@Query("year") year: string,
		@Query("layout") layout: string,
		@Res() res: Response
	) {
		const parsed = parseImageQuery(year, layout);
		const png = await this.favoritesService.renderImage(
			req.user.id,
			req.user.displayName,
			parsed.year,
			parsed.layout
		);
		res.setHeader("Cache-Control", "private, max-age=300");
		res.end(png);
	}

	@Delete(":igdbGameId")
	@HttpCode(204)
	@ApiOperation({ summary: "Remove a game from the favorites" })
	@ApiResponse({ status: 204, description: "Favorite removed" })
	remove(
		@Request() req,
		@Param("igdbGameId", ParseIntPipe) igdbGameId: number
	) {
		return this.favoritesService.remove(req.user.id, igdbGameId);
	}
}
