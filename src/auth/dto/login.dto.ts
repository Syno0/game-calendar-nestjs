import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from '@nestjs/class-validator';

export class LoginDto {
	@ApiProperty({ description: 'Username', example: 'game_calendar_user' })
	@IsNotEmpty()
	@IsString()
	username: string;

	@ApiProperty({ description: 'Password', example: 'your_password' })
	@IsNotEmpty()
	@IsString()
	password: string;
}

