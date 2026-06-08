import { Strategy } from "passport-local";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth.service";

// https://blog.logrocket.com/how-to-implement-jwt-authentication-nestjs/#creating-the-auth-module

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
	constructor(private authService: AuthService) {
		super();
	}

	async validate(
		username: string,
		password: string
	): Promise<{ username: string }> {
		const user = await this.authService.validateUser(username, password);
		if (!user) throw new UnauthorizedException();
		return user;
	}
}
