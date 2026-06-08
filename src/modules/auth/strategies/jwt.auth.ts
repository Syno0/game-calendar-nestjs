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
