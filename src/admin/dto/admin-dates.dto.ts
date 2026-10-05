import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	Min,
	ValidateIf,
} from "class-validator";

export const OVERRIDE_SOURCES = ["igdb", "rawg", "manual"] as const;
export const OVERRIDE_PRECISIONS = ["day", "month", "quarter", "year", "tbd"] as const;

export class SetDateOverrideDto {
	@ApiProperty({ enum: OVERRIDE_SOURCES })
	@IsIn(OVERRIDE_SOURCES)
	source: (typeof OVERRIDE_SOURCES)[number];

	/** Obligatoire pour une date manuelle, ignorée sinon. */
	@ApiPropertyOptional({ example: "2027-04-08" })
	@ValidateIf((dto) => dto.source === "manual")
	@Matches(/^\d{4}-\d{2}-\d{2}$/)
	date?: string;

	@ApiPropertyOptional({ enum: OVERRIDE_PRECISIONS })
	@ValidateIf((dto) => dto.source === "manual")
	@IsIn(OVERRIDE_PRECISIONS)
	precision?: (typeof OVERRIDE_PRECISIONS)[number];

	@ApiPropertyOptional({ description: "Pourquoi ce forçage, pour s'en souvenir" })
	@IsOptional()
	@IsString()
	@MaxLength(300)
	note?: string;
}

export class SetRawgLinkDto {
	/** Null : « ce jeu n'a pas d'équivalent RAWG », et la synchro n'y touche plus. */
	@ApiPropertyOptional({ nullable: true, example: 58175 })
	@IsOptional()
	@IsInt()
	@Min(1)
	rawgId: number | null;
}
