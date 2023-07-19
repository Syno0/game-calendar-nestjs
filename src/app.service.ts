import { Injectable } from '@nestjs/common';
import { getGamesBetweenDates, getGamesByIds } from './helpers/igdb_api';
import { index_render } from './common/interfaces/render.interface';
import * as dayjs from 'dayjs';

@Injectable()
export class AppService {
  root(): index_render {
    return {
      message: 'Hello world'
    };
  }

  async getGames(start_date, end_date): Promise<string> {
    const release_game = await getGamesBetweenDates(start_date, end_date);
    const all_games_id = release_game.map(x => x.game);
    const game_list = await getGamesByIds(all_games_id);

    // Inject human formatted release date into game list
    game_list.map(x => {
      const game = release_game.find(y => y.game === x.id);
      x.platform = game.platform.name;
      x.date = dayjs.unix(game.date).format('DD/MM/YYYY');
      x.day = dayjs.unix(game.date).format('DD');
      // Replace t_thumb cover with t_cover_big for better resolution
      if(x.cover && x.cover.url)
        x.cover.url = x.cover.url.replace('t_thumb', 't_cover_big');
    });

    console.log(game_list);

    // console.log(game_list);
    return game_list;
  }
}
