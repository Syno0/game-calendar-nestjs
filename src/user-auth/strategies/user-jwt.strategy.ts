import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { UserAuthService } from "../user-auth.service";

/**
 * End-user session token, sent by the BFF as a Bearer header.
 *
 * Registered under an explicit name so it coexists with the unnamed "jwt"
 * strategy, which authenticates the BFF's own service account from a cookie.
 * Both are signed with JWT_KEY, so the audience claim is what actually keeps
 * a user token from reaching /games and a service token from reaching /me.
 */
@Injectable()
export class UserJwtStrategy extends PassportStrategy(Strategy, "user-jwt") {
	constructor(private readonly userAuthService: UserAuthService) {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: process.env.JWT_KEY,
			audience: "user",
		});
	}

	async validate(payload: { sub?: string }) {
		const user = payload?.sub
			? await this.userAuthService.findById(payload.sub)
			: null;
		if (!user) throw new UnauthorizedException();
		return user;
	}
}
