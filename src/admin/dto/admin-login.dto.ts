import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class AdminLoginDto {
	@ApiProperty({ description: "Administrator username" })
	@IsNotEmpty()
	@IsString()
	@MaxLength(120)
	username: string;

	/**
	 * Borné lui aussi : bcrypt ignore silencieusement tout ce qui dépasse 72
	 * octets, et rien n'oblige un appelant à envoyer un mot de passe court —
	 * une chaîne d'un mégaoctet ferait travailler le hachage pour rien.
	 */
	@ApiProperty({ description: "Administrator password" })
	@IsNotEmpty()
	@IsString()
	@MaxLength(200)
	password: string;
}
