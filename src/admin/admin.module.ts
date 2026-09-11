import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminStatsController } from "./admin-stats.controller";
import { AdminStatsService } from "./admin-stats.service";
import { ADMIN_JWT_SECRET } from "./admin.config";
import { AdminJwtStrategy } from "./strategies/admin-jwt.strategy";

// `JwtModule.register` lit process.env à la construction du module, avant que
// ConfigModule — qui n'est pas global ici — n'ait chargé quoi que ce soit.
// Même raison que dans auth.module.ts.
import * as dotenv from "dotenv";
dotenv.config();

@Module({
	imports: [
		PassportModule,
		JwtModule.register({
			secret: ADMIN_JWT_SECRET,
			signOptions: {
				// Une journée de travail. Pas de liste de révocation : la durée
				// courte en tient lieu, et il n'y a qu'un compte.
				expiresIn: process.env.ADMIN_JWT_TTL || "8h",
				audience: "admin",
			},
		}),
	],
	providers: [AdminAuthService, AdminStatsService, AdminJwtStrategy],
	controllers: [AdminAuthController, AdminStatsController],
})
export class AdminModule {}
