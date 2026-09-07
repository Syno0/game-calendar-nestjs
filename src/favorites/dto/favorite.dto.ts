import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateFavoriteDto {
	@ApiProperty({ description: "IGDB game id", example: 121395 })
	@Type(() => Number)
	@IsInt()
	igdbGameId: number;

	@ApiProperty({ description: "Game name, kept as a display fallback" })
	@IsNotEmpty()
	@IsString()
	name: string;

	@ApiPropertyOptional({ description: "Cover URL snapshot" })
	@IsOptional()
	@IsString()
	coverUrl?: string;

	@ApiPropertyOptional({ description: "Platform slug snapshot", example: "pc" })
	@IsOptional()
	@IsString()
	platformSlug?: string;
}
