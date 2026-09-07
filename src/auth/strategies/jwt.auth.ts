import { Injectable, Logger } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
	private readonly logger = new Logger(JwtStrategy.name);
	constructor() {
		super({
			// jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Usefull when token is in Authorization Bearer header
			jwtFromRequest: ExtractJwt.fromExtractors([
				JwtStrategy.extractJWTFromCookie,
			]),
			ignoreExpiration: false,
			secretOrKey: process.env.JWT_KEY,
			// Both token families are signed with JWT_KEY; the audience is what
			// keeps an end-user token from authenticating as the service account.
			audience: "service",
		});
	}

	private static extractJWTFromCookie(req: Request): string | null {
		const hasCookie = Boolean(req.cookies && req.cookies.access_token);
		// Note: avoid logging token value
		if (hasCookie) {
			return req.cookies.access_token;
		}
		return null;
	}

	async validate(payload: any) {
		// Do not log sensitive payload, only minimal info
		this.logger.debug(
			`JWT validate for user: ${payload?.username ?? "unknown"}`
		);
		return { username: payload.username };
	}
}
