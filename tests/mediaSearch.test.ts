import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSearchQuery,
  formatDuration,
  parseDuration,
  parseSpotifySearch,
  parseYouTubeSearch,
  rankResults,
  type MediaSearchResult,
} from '../shared/mediaSearch.ts';
import { MediaSearch } from '../server/mediaSearch.ts';

// Hand-written in the shape of youtubei/v1/search responses (trimmed: real ones are ~1 MB and
// carry many more fields). Not captured from YouTube: the sandbox these tests were written in
// can't reach it.
function video(videoId: string, title: string, channel: string, length?: string) {
  return {
    videoRenderer: {
      videoId,
      title: { runs: [{ text: title }] },
      ownerText: { runs: [{ text: channel }] },
      ...(length ? { lengthText: { simpleText: length } } : {}),
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hq720.jpg`, width: 720 }] },
    },
  };
}
const ytResponse = (...items: unknown[]) => ({
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{ itemSectionRenderer: { contents: items } }, { continuationItemRenderer: {} }],
        },
      },
    },
  },
});

const spTrack = (id: string, name: string, artists: string[], ms: number, album = 'Album') => ({
  id,
  name,
  duration_ms: ms,
  artists: artists.map((a) => ({ name: a })),
  album: {
    name: album,
    images: [
      { url: 'https://i.scdn.co/image/640', width: 640 },
      { url: 'https://i.scdn.co/image/300', width: 300 },
      { url: 'https://i.scdn.co/image/64', width: 64 },
    ],
  },
});

describe('buildSearchQuery', () => {
  it('joins artist and title', () => {
    expect(buildSearchQuery(' Wish You Were Here ', 'Pink Floyd')).toBe('Pink Floyd Wish You Were Here');
  });
  it('uses whichever is filled', () => {
    expect(buildSearchQuery('Greensleeves', '')).toBe('Greensleeves');
  });
  it('falls back to a cleaned-up file name', () => {
    expect(buildSearchQuery('', '', 'pink_floyd-wish_you_were_here (2).gp5')).toBe('pink floyd-wish you were here');
    expect(buildSearchQuery('', '', 'Metallica - One.gpx')).toBe('Metallica - One');
  });
  it('is empty when there is nothing to go on', () => {
    expect(buildSearchQuery('', '', '')).toBe('');
  });
});

describe('durations', () => {
  it('parses m:ss and h:mm:ss', () => {
    expect(parseDuration('3:45')).toBe(225);
    expect(parseDuration('1:02:03')).toBe(3723);
  });
  it('gives 0 for missing or odd values', () => {
    expect(parseDuration(undefined)).toBe(0);
    expect(parseDuration('LIVE')).toBe(0);
    expect(parseDuration('3:4:5:6')).toBe(0);
  });
  it('formats back', () => {
    expect(formatDuration(225)).toBe('3:45');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(0)).toBe('');
  });
});

describe('parseYouTubeSearch', () => {
  it('finds videos in order and builds links', () => {
    const r = parseYouTubeSearch(ytResponse(video('AAAAAAAAAAA', 'Song A', 'Band - Topic', '4:01'), video('BBBBBBBBBBB', 'Song B', 'Someone')));
    expect(r.map((x) => x.id)).toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    expect(r[0]).toMatchObject({
      source: 'youtube',
      url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
      title: 'Song A',
      artist: 'Band - Topic',
      cleanArtist: 'Band',
      duration: 241,
    });
    expect(r[1].cleanArtist).toBeUndefined();
    expect(r[1].duration).toBe(0);
  });
  it('finds videos nested in shelves and skips other renderers and duplicates', () => {
    const data = ytResponse(
      { adSlotRenderer: { videoId: 'XXXXXXXXXXX' } },
      { channelRenderer: { channelId: 'UC123' } },
      { shelfRenderer: { content: { verticalListRenderer: { items: [video('CCCCCCCCCCC', 'In a shelf', 'Ch')] } } } },
      video('CCCCCCCCCCC', 'Duplicate', 'Ch'),
      { videoRenderer: { videoId: 'not-an-id', title: { simpleText: 'Broken' } } },
    );
    expect(parseYouTubeSearch(data).map((x) => x.title)).toEqual(['In a shelf']);
  });
  it('reads simpleText titles and longBylineText channels', () => {
    const data = { videoRenderer: { videoId: 'DDDDDDDDDDD', title: { simpleText: 'Plain' }, longBylineText: { runs: [{ text: 'By' }, { text: 'line' }] } } };
    expect(parseYouTubeSearch(data)[0]).toMatchObject({ title: 'Plain', artist: 'Byline' });
  });
  it('copes with junk', () => {
    expect(parseYouTubeSearch(null)).toEqual([]);
    expect(parseYouTubeSearch('html')).toEqual([]);
    expect(parseYouTubeSearch({ contents: [] })).toEqual([]);
  });
});

describe('parseSpotifySearch', () => {
  it('maps tracks and picks a mid-sized cover', () => {
    const r = parseSpotifySearch({ tracks: { items: [spTrack('4uLU6hMCjMI75M1A2tKUQC', 'Song', ['Main', 'Guest'], 213_400, 'LP')] } });
    expect(r).toEqual([
      {
        source: 'spotify',
        id: '4uLU6hMCjMI75M1A2tKUQC',
        url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
        title: 'Song',
        artist: 'Main, Guest',
        album: 'LP',
        duration: 213,
        thumbnail: 'https://i.scdn.co/image/300',
        cleanArtist: 'Main',
      },
    ]);
  });
  it('skips null items (Spotify sends them for unavailable tracks) and bad ids', () => {
    expect(parseSpotifySearch({ tracks: { items: [null, { id: 'short', name: 'x' }] } })).toEqual([]);
    expect(parseSpotifySearch({})).toEqual([]);
  });
});

describe('rankResults', () => {
  const yt = (id: string, title: string, artist: string, duration = 240, cleanArtist?: string): MediaSearchResult => ({
    source: 'youtube',
    id,
    url: '',
    title,
    artist,
    duration,
    thumbnail: '',
    cleanArtist,
  });

  it('puts the album audio above covers, lessons and live versions', () => {
    const results = [
      yt('cover', 'Wish You Were Here - Guitar Cover', 'Some Guy'),
      yt('lesson', 'Wish You Were Here Guitar Lesson Tutorial', 'Teacher'),
      yt('live', 'Pink Floyd - Wish You Were Here (Live at Knebworth)', 'Pink Floyd'),
      yt('mv', 'Pink Floyd - Wish You Were Here (Official Music Video)', 'Pink Floyd'),
      yt('topic', 'Wish You Were Here', 'Pink Floyd - Topic', 334, 'Pink Floyd'),
    ];
    const ids = rankResults(results, 'Pink Floyd Wish You Were Here').map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(['topic', 'mv']);
    expect(ids.slice(2)).toEqual(['live', expect.any(String), expect.any(String)]);
  });
  it('does not penalise what the user asked for', () => {
    const results = [yt('studio', 'Band - Song (Official Audio)', 'Band'), yt('live', 'Band - Song (Live)', 'Band')];
    expect(rankResults(results, 'band song live')[0].id).toBe('live');
    expect(rankResults(results, 'band song')[0].id).toBe('studio');
  });
  it('sinks album-length uploads and snippets', () => {
    const results = [yt('album', 'Band - Song full album', 'Band', 3000), yt('short', 'Band Song', 'Band', 20), yt('song', 'Band Song', 'Band', 200)];
    expect(rankResults(results, 'band song')[0].id).toBe('song');
  });
  it("keeps the service's order when scores tie", () => {
    const results = [yt('a', 'Band Song', 'Band'), yt('b', 'Band Song', 'Band')];
    expect(rankResults(results, 'band song').map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('ignores accents and punctuation when matching words', () => {
    const results = [yt('other', 'Something else', 'X'), yt('match', 'Beyoncé – Halo', 'Y')];
    expect(rankResults(results, 'beyonce halo')[0].id).toBe('match');
  });
});

describe('MediaSearch (server)', () => {
  let dir: string;
  let calls: { url: string; init?: RequestInit }[];
  let replies: (Response | Error)[];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'fretlane-search-'));
    calls = [];
    replies = [];
    delete process.env.FRETLANE_SPOTIFY_CLIENT_ID;
    delete process.env.FRETLANE_SPOTIFY_CLIENT_SECRET;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('searches YouTube and ranks the answer', async () => {
    const s = new MediaSearch(dir, fakeFetch);
    await s.init();
    replies.push(json(ytResponse(video('AAAAAAAAAAA', 'Song (Live)', 'Band', '5:00'), video('BBBBBBBBBBB', 'Song', 'Band - Topic', '4:00'))));
    const res = await s.search('youtube', 'band song');
    expect(res.error).toBeUndefined();
    expect(res.results.map((r) => r.id)).toEqual(['BBBBBBBBBBB', 'AAAAAAAAAAA']);
    expect(res.openUrl).toBe('https://www.youtube.com/results?search_query=band%20song');
    expect(calls[0].url).toContain('youtubei/v1/search');
    expect(JSON.parse(String(calls[0].init?.body)).query).toBe('band song');
  });

  it('turns network trouble and odd answers into a message plus a link to search there', async () => {
    const s = new MediaSearch(dir, fakeFetch);
    replies.push(new TypeError('fetch failed'));
    expect(await s.search('youtube', 'x')).toMatchObject({ results: [], error: 'Could not reach YouTube. Are you online?' });
    replies.push(json({}, 403));
    expect((await s.search('youtube', 'x')).error).toBe('YouTube search failed (403).');
    replies.push(json({ contents: {} }));
    expect((await s.search('youtube', 'x')).error).toMatch(/no videos/);
  });

  it('asks for Spotify credentials before searching Spotify', async () => {
    const s = new MediaSearch(dir, fakeFetch);
    await s.init();
    expect(s.publicSettings()).toEqual({ spotifySearch: false, spotifyFromEnv: false });
    const res = await s.search('spotify', 'band song');
    expect(res.error).toMatch(/Client ID/);
    expect(res.openUrl).toBe('https://open.spotify.com/search/band%20song');
    expect(calls).toHaveLength(0);
  });

  it('checks, stores and uses Spotify credentials; the token is reused', async () => {
    const s = new MediaSearch(dir, fakeFetch);
    await s.init();
    replies.push(json({ error: 'invalid_client' }, 400));
    await expect(s.setSpotifyCredentials('id', 'wrong')).rejects.toThrow(/did not accept/);
    expect(s.publicSettings().spotifySearch).toBe(false);

    replies.push(json({ access_token: 'T1', expires_in: 3600 }));
    expect(await s.setSpotifyCredentials(' id ', ' secret ')).toEqual({ spotifySearch: true, spotifyFromEnv: false });
    expect(calls[1].init?.headers).toMatchObject({ authorization: `Basic ${Buffer.from('id:secret').toString('base64')}` });
    const file = path.join(dir, 'settings.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ spotifyClientId: 'id', spotifyClientSecret: 'secret' });
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o077).toBe(0);

    replies.push(json({ tracks: { items: [spTrack('4uLU6hMCjMI75M1A2tKUQC', 'Song', ['Band'], 200_000)] } }));
    const res = await s.search('spotify', 'band song');
    expect(res.results.map((r) => r.id)).toEqual(['4uLU6hMCjMI75M1A2tKUQC']);
    expect(calls).toHaveLength(3); // no second token request
    expect(calls[2].url).toBe('https://api.spotify.com/v1/search?type=track&limit=20&q=band%20song');
    expect(calls[2].init?.headers).toMatchObject({ authorization: 'Bearer T1' });

    // A fresh server reads them back from disk.
    const again = new MediaSearch(dir, fakeFetch);
    await again.init();
    expect(again.publicSettings().spotifySearch).toBe(true);

    // Empty values disconnect.
    expect((await s.setSpotifyCredentials('', '')).spotifySearch).toBe(false);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({});
  });

  it('logs in again once when Spotify rejects the token', async () => {
    process.env.FRETLANE_SPOTIFY_CLIENT_ID = 'envid';
    process.env.FRETLANE_SPOTIFY_CLIENT_SECRET = 'envsecret';
    const s = new MediaSearch(dir, fakeFetch);
    expect(s.publicSettings()).toEqual({ spotifySearch: true, spotifyFromEnv: true });
    replies.push(
      json({ access_token: 'OLD', expires_in: 3600 }),
      json({ error: { status: 401 } }, 401),
      json({ access_token: 'NEW', expires_in: 3600 }),
      json({ tracks: { items: [spTrack('4uLU6hMCjMI75M1A2tKUQC', 'Song', ['Band'], 200_000)] } }),
    );
    const res = await s.search('spotify', 'song');
    expect(res.results).toHaveLength(1);
    expect(calls[3].init?.headers).toMatchObject({ authorization: 'Bearer NEW' });
  });

  it('requires both Spotify values', async () => {
    const s = new MediaSearch(dir, fakeFetch);
    await expect(s.setSpotifyCredentials('id', '')).rejects.toThrow(/both/);
  });
});
