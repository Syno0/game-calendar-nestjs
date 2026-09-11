import {
	Body,
	Controller,
	Get,
	HttpCode,
	Post,
	UseGuards,
	UsePipes,
	ValidationPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
	ApiBearerAuth,
	ApiBody,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginDto } from "./dto/admin-login.dto";

/**
 * La connexion au back-office.
 *
 * Le jeton part dans le corps de la réponse, pas dans un cookie : c'est le BFF
 * qui détient le cookie navigateur et le retransmet ici en Bearer, exactement
 * comme pour la session utilisateur (`/auth/oauth/:provider/exchange`). Le
 * navigateur ne voit donc jamais le jeton.
 *
 * Il n'y a pas de route de déconnexion ici : se déconnecter, c'est effacer le
 * cookie, et le cookie appartient au BFF. Un jeton reste valide jusqu'à son
 * expiration — d'où une durée de vie courte plutôt qu'une liste de révocation
 * que rien ne viendrait consulter.
 *
 * `ValidationPipe` est déclaré ici et non globalement : un pipe global avec
 * `whitelist` ne verrait pas les métadonnées des DTO hérités et viderait
 * `/games` et `/platforms` de leurs champs (cf. user-auth.controller.ts).
 */
@ApiTags("Admin")
@Controller("admin")
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AdminAuthController {
	constructor(private readonly adminAuthService: AdminAuthService) {}

	@Post("login")
	// 200 et non 201 : on n'a rien créé, et le BFF relaie le statut tel quel.
	@HttpCode(200)
	@ApiOperation({ summary: "Sign in to the backoffice" })
	@ApiBody({ type: AdminLoginDto })
	@ApiResponse({ status: 200, description: "{ token }" })
	@ApiResponse({ status: 401, description: "Invalid credentials" })
	async login(@Body() dto: AdminLoginDto): Promise<{ token: string }> {
		return this.adminAuthService.login(dto.username, dto.password);
	}

	@Get("me")
	@UseGuards(AuthGuard("admin-jwt"))
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Current administrator" })
	@ApiResponse({ status: 200, description: "{ username }" })
	@ApiResponse({ status: 401, description: "Unauthorized" })
	me(): { username: string } {
		return { username: process.env.ADMIN_USERNAME };
	}
}
