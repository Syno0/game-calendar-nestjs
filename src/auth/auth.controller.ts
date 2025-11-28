import {
	Controller,
	Request,
	Response,
	Post,
	UseGuards,
	Logger,
	Body,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { LoginDto } from "./dto/login.dto";

@ApiTags("Authentication")
@Controller()
export class AuthController {
	private readonly logger = new Logger(AuthController.name);
	constructor(private authService: AuthService) {}

	@UseGuards(AuthGuard("local"))
	@Post("auth/login")
	@ApiOperation({ summary: "Login and get JWT token" })
	@ApiBody({ type: LoginDto })
	@ApiResponse({ status: 200, description: "Login successful, JWT token set in cookie", type: Boolean })
	@ApiResponse({ status: 401, description: "Invalid credentials" })
	async login(@Request() req, @Response() res, @Body() loginDto: LoginDto) {
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
