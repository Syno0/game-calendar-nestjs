import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { AppService } from "./app.service";
import { AuthGuard } from "@nestjs/passport";

@Controller()
export class AppController {
	constructor(private readonly appService: AppService) {}

	@UseGuards(AuthGuard("jwt"))
	@Post("games")
	getGames(@Body() body: any): Promise<string> {
		return this.appService.getGames(body);
	}

	@UseGuards(AuthGuard("jwt"))
	@Post("platforms")
	getPlatform(): Promise<string> {
		return this.appService.getAllPlatforms();
	}
}
