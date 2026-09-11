import {
	BadRequestException,
	Controller,
	Get,
	Query,
	UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiQuery,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import {
	AdminGameRow,
	AdminOverview,
	AdminStatsService,
	AdminTimelinePoint,
	AdminUserRow,
} from "./admin-stats.service";

/**
 * Les statistiques : lecture seule, jamais d'écriture.
 *
 * Contrôleur distinct de `AdminAuthController` parce que la garde diffère —
 * la connexion ne peut évidemment pas exiger d'être déjà connecté. C'est le
 * même découpage que `FavoritesController` / `FavoriteStatsController`.
 *
 * Les paramètres de requête sont bornés à la main plutôt que par un DTO,
 * comme `favorites-image.query.ts` le fait déjà : ce sont trois entiers, et
 * un `ValidationPipe` sur des `@Query` demanderait un DTO par route.
 */
@ApiTags("Admin")
@Controller("admin/stats")
@UseGuards(AuthGuard("admin-jwt"))
@ApiBearerAuth("JWT-auth")
export class AdminStatsController {
	constructor(private readonly stats: AdminStatsService) {}

	@Get("overview")
	@ApiOperation({ summary: "Headline counters and breakdowns" })
	@ApiResponse({ status: 200, description: "Aggregated counters" })
	@ApiResponse({ status: 401, description: "Unauthorized" })
	overview(): Promise<AdminOverview> {
		return this.stats.overview();
	}

	@Get("games")
	@ApiQuery({ name: "limit", required: false, example: 50 })
	@ApiOperation({ summary: "Most tracked games" })
	@ApiResponse({ status: 200, description: "Leaderboard rows" })
	games(@Query("limit") limit?: string): Promise<AdminGameRow[]> {
		return this.stats.topGames(bounded(limit, 50, 1, 200, "limit"));
	}

	@Get("users")
	@ApiQuery({ name: "limit", required: false, example: 50 })
	@ApiQuery({ name: "offset", required: false, example: 0 })
	@ApiOperation({ summary: "Registered users and their activity" })
	@ApiResponse({ status: 200, description: "User rows" })
	users(
		@Query("limit") limit?: string,
		@Query("offset") offset?: string
	): Promise<AdminUserRow[]> {
		return this.stats.users(
			bounded(limit, 50, 1, 200, "limit"),
			bounded(offset, 0, 0, 1_000_000, "offset")
		);
	}

	@Get("timeline")
	@ApiQuery({ name: "days", required: false, example: 90 })
	@ApiOperation({ summary: "Daily signups and favorites" })
	@ApiResponse({ status: 200, description: "One point per day" })
	timeline(@Query("days") days?: string): Promise<AdminTimelinePoint[]> {
		return this.stats.timeline(bounded(days, 90, 1, 365, "days"));
	}
}

/**
 * Un entier borné, ou une 400 explicite.
 *
 * Le plafond n'est pas décoratif : `days` alimente un `generate_series`, et
 * une valeur non bornée y ferait fabriquer autant de lignes que demandé.
 */
function bounded(
	raw: string | undefined,
	fallback: number,
	min: number,
	max: number,
	name: string
): number {
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new BadRequestException(
			`${name} must be an integer between ${min} and ${max}`
		);
	}
	return value;
}
