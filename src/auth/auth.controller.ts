import {
	Controller,
	Request,
	Response,
	Post,
	UseGuards,
	Logger,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "@nestjs/passport";

@Controller()
export class AuthController {
	private readonly logger = new Logger(AuthController.name);
	constructor(private authService: AuthService) {}

	@UseGuards(AuthGuard("local"))
	@Post("auth/login")
	async login(@Request() req, @Response() res) {
		this.logger.debug("CALL FN -> login");
		console.log("CALL FN -> login");
		console.log(req.user);
		const { access_token } = await this.authService.login(req.user);
		// Set JWT token in client cookie
		// https://expressjs.com/en/5x/api.html#res.cookie
		res.cookie("access_token", access_token, {
			expires: new Date(Date.now() + 360000 + 0.1), // 10min to match JWT token expiration
			httpOnly: true,
			secure: true,
			sameSite: "strict",
		});
		return res.send(true);
	}
}
