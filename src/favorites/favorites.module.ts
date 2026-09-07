import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";
import { AppService } from "../app.service";
import { IgdbModule } from "../clients/igdb.module";
import { UserAuthModule } from "../user-auth/user-auth.module";

@Module({
	imports: [PassportModule, IgdbModule, UserAuthModule],
	providers: [FavoritesService, AppService],
	controllers: [FavoritesController],
})
export class FavoritesModule {}
