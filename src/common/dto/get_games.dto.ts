import {
	IsNotEmpty,
	IsString,
	IsOptional,
	IsNumber,
	IsBoolean,
	IsArray,
	ValidateNested,
} from "@nestjs/class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

class PlatformDto {
	@ApiProperty({ description: "Platform ID", example: 6 })
	@IsNumber()
	id: number;

	@ApiPropertyOptional({
		description: "Platform name",
		example: "PC (Microsoft Windows)",
	})
	@IsOptional()
	@IsString()
	name?: string;

	@ApiPropertyOptional({ description: "Platform slug", example: "pc" })
	@IsOptional()
	@IsString()
	slug?: string;
}

export class GetGamesDto {
	@ApiProperty({
		description: "Start date for game releases (YYYY-MM-DD)",
		example: "2024-01-01",
	})
	@IsNotEmpty()
	@IsString()
	start_date: string;

	@ApiProperty({
		description: "End date for game releases (YYYY-MM-DD)",
		example: "2024-12-31",
	})
	@IsNotEmpty()
	@IsString()
	end_date: string;

	@ApiPropertyOptional({ description: "Minimum hype count", example: 10 })
	@IsOptional()
	@IsNumber()
	hypes?: number;

	@ApiPropertyOptional({
		description: "Filter games with ratings",
		example: true,
	})
	@IsOptional()
	@IsBoolean()
	score?: boolean;

	@ApiPropertyOptional({
		description: "Filter by platforms",
		type: [PlatformDto],
	})
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => PlatformDto)
	platform?: PlatformDto[];
}

export class GetPlatformsDto {
	@ApiPropertyOptional({
		description: "Filter by platforms",
		type: [PlatformDto],
	})
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => PlatformDto)
	ids?: number[];
}
