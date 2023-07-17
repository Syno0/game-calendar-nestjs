import { IsNotEmpty, IsString, isDate } from '@nestjs/class-validator';

export class GetGamesDto {
  // @isDate()
  start_date: string;
}
