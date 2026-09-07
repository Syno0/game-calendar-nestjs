import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Param,
	Post,
	Query,
	Request,
	UseGuards,
	UsePipes,
	ValidationPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { UserAuthService } from "./user-auth.service";
import { parseProvider } from "./oauth.providers";
import { AuthorizeUrlDto, ExchangeDto } from "./dto/oauth.dto";

/**
 * The browser never reaches these routes directly: the BFF owns the redirects
 * and the session cookie, and calls this controller with its service token.
 * Provider secrets therefore stay in this service only.
 */
@ApiTags("User authentication")
@Controller("auth")
// Scoped rather than global: the legacy DTOs are decorated with
// @nestjs/class-validator, whose metadata a global pipe would not see —
// with whitelist:true it would strip every field off /games and /platforms.
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class UserAuthController {
	constructor(private readonly userAuthService: UserAuthService) {}

	@UseGuards(AuthGuard("jwt"))
	@Get("oauth/:provider/url")
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Build the provider authorization URL" })
	@ApiResponse({ status: 200, description: "Authorization URL" })
	getAuthorizeUrl(
		@Param("provider") providerParam: string,
		@Query() query: AuthorizeUrlDto
	) {
		const provider = parseProvider(providerParam);
		if (!provider) throw new BadRequestException("Unknown provider");
		return {
			url: this.userAuthService.buildAuthorizeUrl(
				provider,
				query.redirect_uri,
				query.state
			),
		};
	}

	@UseGuards(AuthGuard("jwt"))
	@Post("oauth/:provider/exchange")
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Exchange an authorization code for a user token" })
	@ApiResponse({ status: 201, description: "User token and profile" })
	@ApiResponse({ status: 401, description: "OAuth exchange failed" })
	exchange(@Param("provider") providerParam: string, @Body() body: ExchangeDto) {
		const provider = parseProvider(providerParam);
		if (!provider) throw new BadRequestException("Unknown provider");
		return this.userAuthService.exchange(
			provider,
			body.code,
			body.redirect_uri
		);
	}

	@UseGuards(AuthGuard("user-jwt"))
	@Get("me")
	@ApiOperation({ summary: "Current user profile" })
	me(@Request() req) {
		return this.userAuthService.toPublicUser(req.user);
	}
}
