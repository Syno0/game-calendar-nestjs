import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthService {
	constructor(private jwtService: JwtService) {}

	async validateUser(
		username: string,
		password: string
	): Promise<{ username: string }> {
		if (
			username === "game_calendar_user" &&
			password == process.env.JWT_KEY
		)
			return {
				username,
			};

		return null;
	}

	async login(user: { username: string }) {
		const payload = { username: user.username, sub: user.username };
		return {
			access_token: this.jwtService.sign(payload),
		};
	}
}
