import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseIntPipe,
	Put,
	Query,
	UseGuards,
	UsePipes,
	ValidationPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiQuery,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { bounded } from "./admin-stats.controller";
import {
	AdminDateRow,
	AdminDatesService,
	AdminRawgStatus,
} from "./admin-dates.service";
import { SetDateOverrideDto, SetRawgLinkDto } from "./dto/admin-dates.dto";

/**
 * Les dates de sortie, quand IGDB et RAWG ne sont pas d'accord.
 *
 * Seul endroit de /admin qui écrive : un forçage posé ici déplace le jeu dans
 * le calendrier de tous les visiteurs, et dans les images de partage.
 */
@ApiTags("Admin")
@Controller("admin")
@UseGuards(AuthGuard("admin-jwt"))
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@ApiBearerAuth("JWT-auth")
export class AdminDatesController {
	constructor(private readonly dates: AdminDatesService) {}

	@Get("dates")
	@ApiQuery({ name: "q", required: false })
	@ApiQuery({ name: "limit", required: false, example: 50 })
	@ApiQuery({ name: "offset", required: false, example: 0 })
	@ApiOperation({ summary: "IGDB/RAWG date disagreements, or a name search" })
	@ApiResponse({ status: 200, description: "Rows and total" })
	list(
		@Query("q") q?: string,
		@Query("limit") limit?: string,
		@Query("offset") offset?: string
	): Promise<{ total: number; rows: AdminDateRow[] }> {
		return this.dates.list(
			bounded(limit, 50, 1, 200, "limit"),
			bounded(offset, 0, 0, 1_000_000, "offset"),
			typeof q === "string" ? q.slice(0, 100) : undefined
		);
	}

	@Get("dates/:igdbId")
	@ApiOperation({ summary: "Both dates, the RAWG link and the override of a game" })
	game(@Param("igdbId", ParseIntPipe) igdbId: number): Promise<AdminDateRow> {
		return this.dates.game(igdbId);
	}

	@Put("dates/:igdbId")
	@ApiOperation({ summary: "Force the date source, or a manual date" })
	setOverride(
		@Param("igdbId", ParseIntPipe) igdbId: number,
		@Body() body: SetDateOverrideDto
	): Promise<AdminDateRow> {
		return this.dates.setOverride(igdbId, body);
	}

	@Delete("dates/:igdbId")
	@HttpCode(204)
	@ApiOperation({ summary: "Back to the automatic choice" })
	clearOverride(@Param("igdbId", ParseIntPipe) igdbId: number): Promise<void> {
		return this.dates.clearOverride(igdbId);
	}

	@Put("dates/:igdbId/link")
	@ApiOperation({ summary: "Fix the RAWG game a game is linked to" })
	setLink(
		@Param("igdbId", ParseIntPipe) igdbId: number,
		@Body() body: SetRawgLinkDto
	): Promise<AdminDateRow> {
		return this.dates.setLink(igdbId, body.rawgId ?? null);
	}

	@Get("rawg/status")
	@ApiOperation({ summary: "RAWG quota and sync state" })
	status(): Promise<AdminRawgStatus> {
		return this.dates.status();
	}
}
