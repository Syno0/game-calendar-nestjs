import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthService {
	constructor(private jwtService: JwtService) {}

	async validateUser(username: string, password: string): Promise<any> {
		console.log("CALL FN -> validateUser");
		console.log(username, password);

		// Get login information

		// Exemple with DB USER
		// const user = await this.usersService.getUser({ username });
		// if (!user)
		// 	throw new NotAcceptableException('could not find the user');

		// const passwordValid = await bcrypt.compare(password, user.password);

		// if (passwordValid){
		// 	// return user
		// 	return {
		// 		login: 'Hello there'
		// 	}
		// }

		// const passwordValid = await bcrypt.compare(password, process.env.BCRYPT_USER_PWD);

		if (
			username === "game_calendar_user" &&
			password == process.env.JWT_KEY
		)
			return {
				username,
			};

		return null;
	}

	async login(user: any) {
		console.log("CALL FN -> login");
		console.log(user);
		const payload = { username: user.username, sub: user._id };
		return {
			access_token: this.jwtService.sign(payload),
		};
	}
}
