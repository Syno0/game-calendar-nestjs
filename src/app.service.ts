import { Injectable } from '@nestjs/common';
import { getGamesBetweenDates, getGamesByIds, getAllPlatforms } from './helpers/igdb_api';
import { index_render } from './common/interfaces/render.interface';
import categoryEnum  from './common/enums/category';
import statusEnum  from './common/enums/status';
import * as dayjs from 'dayjs';

@Injectable()
export class AppService {

  async getGames({start_date, end_date, ...filters}): Promise<string> {
    const release_game = await getGamesBetweenDates(start_date, end_date, filters);
    const all_games_id = release_game.map(x => x.game);
    const game_list = await getGamesByIds(all_games_id);

    // console.log(game_list);
    // console.log(release_game);

    // Inject human formatted release date into game list
    game_list.map(x => {
      const game = release_game.find(y => y.game === x.id);
      x.platform = {
        slug: game.platform.slug,
        logo: game.platform?.platform_logo?.url
      }
      x.date = dayjs.unix(game.date).format('DD/MM/YYYY');
      x.day = dayjs.unix(game.date).format('DD');

      x.category = categoryEnum[x.category];
      x.status = statusEnum[x.status];

      // Replace t_thumb cover with t_cover_big for better resolution
      if(x.cover && x.cover.url)
        x.cover.url = x.cover.url.replace('t_thumb', 't_cover_big');

      if(x.artworks)
        x.artworks.map((artwork) => {
          artwork.url = artwork.url.replace("t_thumb", "t_cover_big");
        });

      // Setting null to 0
      x.hypes = x.hypes ? x.hypes : 0;
      x.follow = x.follow ? x.follow : 0;
      x.total_rating = x.total_rating ? x.total_rating : 0;

      x.developer = x.involved_companies ? x.involved_companies.filter(x => x.developer).map(x => x.company) : '';
      x.publisher = x.involved_companies ? x.involved_companies.filter(x => x.publisher).map(x => x.company) : '';

      return x;
    });

    // console.log(game_list);
    return game_list;
  }

  async getAllPlatforms(): Promise<string> {
    const platforms = await getAllPlatforms();
    return platforms;
  }
}
