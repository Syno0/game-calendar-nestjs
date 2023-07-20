import { request } from '../utils/request';
import * as dayjs from 'dayjs';
interface igdb {
  access_token: string;
  created_at: dayjs.Dayjs;
  expires_in: number;
  expires_at: dayjs.Dayjs;
  token_type: string;
}
let igdb: igdb = null;
const igdb_url = 'https://api.igdb.com/v4';

export async function getToken(): Promise<igdb> {
  if (igdb && dayjs().isBefore(igdb.expires_at)) {
    return igdb;
  }

  console.log('RESET TOKEN:', dayjs().format());

  const twitch_url = `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT}&client_secret=${process.env.TWITCH_SECRET}&grant_type=client_credentials`;

  igdb = await request(twitch_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  igdb.created_at = dayjs();
  igdb.expires_at = dayjs().add(igdb.expires_in, 'second');

  return igdb;
}

// Return list of game ID between dates
export async function getGamesBetweenDates(start_date: string, end_date: string) {
  await getToken();

  let body = 'fields date, game, platform.slug, platform.platform_logo.url; limit 500;sort date asc;'; // Max limit 500
  body += ' where';
  body += ' date > ' + dayjs(start_date).unix();
  body += ' &';
  body += ' date < ' + dayjs(end_date).unix();
  body += ';';

  return await request(igdb_url + '/release_dates', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Client-ID': process.env.TWITCH_CLIENT,
      Authorization: `Bearer ${igdb.access_token}`,
    },
    body,
  });
}

export async function getGamesByIds(ids: number[]) {
  return await request(igdb_url + '/games', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Client-ID': process.env.TWITCH_CLIENT,
      Authorization: `Bearer ${igdb.access_token}`,
    },
    body: 'fields id, name, cover.url, artworks, follows, hypes; where id = (' + ids.join(',') + ') & hypes > 1; limit 500;',
  });
}
