import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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
		if (req.cookies && req.cookies.access_token) {
			return req.cookies.access_token;
		}
		return null;
	}

	async validate(payload: any) {
		console.log(payload);
		return { username: payload.username };
	}
}
