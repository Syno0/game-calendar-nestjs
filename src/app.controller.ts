import { Controller, Get, Post, Body, Render, UseGuards, Request } from '@nestjs/common';
import { AppService } from './app.service';
import { index_render } from './common/interfaces/render.interface';
import { AuthGuard } from '@nestjs/passport';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Render('index')
  root(@Request() req) : index_render {
    return this.appService.root();
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('games')
  getGames(
    @Body('start_date') start_date: string,
    @Body('end_date') end_date: string,
  ): Promise<string> {
    return this.appService.getGames(start_date, end_date);
  }
}
