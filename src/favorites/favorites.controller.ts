import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseIntPipe,
	Post,
	Request,
	UseGuards,
	UsePipes,
	ValidationPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FavoritesService } from "./favorites.service";
import { CreateFavoriteDto } from "./dto/favorite.dto";

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
