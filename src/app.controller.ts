import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { AppService } from "./app.service";
import { AuthGuard } from "@nestjs/passport";
import {
	ApiTags,
	ApiOperation,
	ApiResponse,
	ApiBearerAuth,
	ApiBody,
} from "@nestjs/swagger";
import { GetGamesDto, GetPlatformsDto } from "./common/dto/get_games.dto";

@ApiTags("Games")
@Controller()
export class AppController {
	constructor(private readonly appService: AppService) {}

	@UseGuards(AuthGuard("jwt"))
	@Post("games")
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Get games by date range and filters" })
	@ApiBody({ type: GetGamesDto })
	@ApiResponse({
		status: 200,
		description: "List of games matching the criteria",
	})
	@ApiResponse({ status: 401, description: "Unauthorized" })
	getGames(@Body() body: GetGamesDto): Promise<string> {
		return this.appService.getGames(body);
	}

	@UseGuards(AuthGuard("jwt"))
	@Post("platforms")
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Get all available platforms" })
	@ApiBody({ type: GetPlatformsDto })
	@ApiResponse({ status: 200, description: "List of all platforms" })
	@ApiResponse({ status: 401, description: "Unauthorized" })
	getPlatform(@Body() body: GetPlatformsDto): Promise<string> {
		return this.appService.getAllPlatforms(body);
	}
}
