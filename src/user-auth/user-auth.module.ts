import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { UserAuthController } from "./user-auth.controller";
import { UserAuthService } from "./user-auth.service";
import { UserJwtStrategy } from "./strategies/user-jwt.strategy";

// Same workaround as AuthModule: JwtModule.register reads process.env at module
// definition time, before ConfigModule has loaded the .env file.
import * as dotenv from "dotenv";
dotenv.config();

@Module({
	imports: [
		PassportModule,
		JwtModule.register({
			secret: process.env.JWT_KEY,
			signOptions: {
				expiresIn: process.env.USER_JWT_TTL || "7d",
				audience: "user",
			},
		}),
	],
	providers: [UserAuthService, UserJwtStrategy],
	controllers: [UserAuthController],
	exports: [UserAuthService],
})
export class UserAuthModule {}
