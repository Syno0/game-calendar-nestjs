import { request } from '../utils/request';
import * as dayjs from 'dayjs';
import { igdb, filters } from '../common/interfaces/igdb.interface';

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
export async function getGamesBetweenDates(start_date: string, end_date: string, filters: filters) {
  await getToken();

  let body = 'fields date, game, platform.slug, platform.platform_logo.url; limit 500; sort date asc;'; // Max limit 500
  body += ' where';
  body += ' date > ' + dayjs(start_date).subtract(1, 'day').unix();
  body += ' &';
  body += ' date < ' + dayjs(end_date).add(1, 'day').unix();
  if(filters.hypes > 0)
    body += ' & game.hypes >= ' + filters.hypes;
  if(filters.score)
    body += ' & game.total_rating_count > 0';
  if(filters.platform.length > 0)
    body += ` & platform = (${filters.platform.map(x => x.id)})`;
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
  await getToken();

  if(ids.length == 0)
    return [];

  const fields = [
    'id',
    'name',
    'category',
    'status',
    'cover.url',
    'artworks.url',
    'follows',
    'hypes',
    'aggregated_rating',
    'aggregated_rating_count',
    'alternative_names',
    'rating',
    'rating_count',
    'storyline',
    'summary',
    'total_rating',
    'total_rating_count',
    'url',
    'version_title',
    'websites.url',
    'videos.video_id',
    'alternative_names.name',
    'collection.name',
    'collection.url',
    'dlcs.name',
    'dlcs.url',
    'game_engines.name',
    'game_engines.url',
    'franchise.name',
    'franchise.url',
    'game_modes.name',
    'game_modes.url',
    'genres.name',
    'involved_companies.*',
    'involved_companies.company.*',
  ]

  const body = `fields ${fields.join(',')}; where id = (${ids.join(',')}); limit 500;`;

  return await request(igdb_url + '/games', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Client-ID': process.env.TWITCH_CLIENT,
      Authorization: `Bearer ${igdb.access_token}`,
    },
    body
  });
}

export async function getAllPlatforms() {
  await getToken();

  const fields = [
    'id',
    'name',
    'slug',
    // 'generation',
    // 'created_at',
    // 'versions.platform_version_release_dates.y',
  ]

  const body = `fields ${fields.join(',')}; where versions.platform_version_release_dates.y > 2010; limit 500;`;

  return await request(igdb_url + '/platforms', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Client-ID': process.env.TWITCH_CLIENT,
      Authorization: `Bearer ${igdb.access_token}`,
    },
    body
  });
}