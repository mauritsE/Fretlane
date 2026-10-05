/**
 * Finding a recording for a song: parsing YouTube and Spotify search responses and ranking the
 * results so the studio recording comes first. Covers, lessons and live versions drift from the
 * album timing, which makes sync pins harder, so they sink unless the user asked for them.
 */

export type MediaSource = 'youtube' | 'spotify';

export interface MediaSearchResult {
  source: MediaSource;
  /** YouTube video id or Spotify track id. */
  id: string;
  /** The link that goes into the song's Recording field. */
  url: string;
  title: string;
  /** Channel name (YouTube) or the track's artists (Spotify). */
  artist: string;
  /** Album name (Spotify only). */
  album?: string;
  /** Length in seconds, 0 when unknown. */
  duration: number;
  thumbnail: string;
  /** For YouTube "<Artist> - Topic" channels and Spotify: the artist name worth copying into the song. */
  cleanArtist?: string;
}

export interface MediaSearchResponse {
  results: MediaSearchResult[];
  /** Set when in-app search isn't available; the UI then offers `openUrl` instead. */
  error?: string;
  /** The same search on the service's own website. */
  openUrl: string;
}

/** What the UI may know about the search settings. The Spotify secret never leaves the server. */
export interface PublicSettings {
  spotifySearch: boolean;
  /** Credentials come from environment variables and can't be changed from the UI. */
  spotifyFromEnv: boolean;
}

/** The search the dialog starts with: artist and title, or the tab's file name when both are empty. */
export function buildSearchQuery(title: string, artist: string, fileName = ''): string {
  const parts = [artist.trim(), title.trim()].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s*\((?:\d+|v\d+|ver \d+)\)\s*$/i, '')
    .trim();
}

export function searchPageUrl(source: MediaSource, query: string): string {
  return source === 'youtube'
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    : `https://open.spotify.com/search/${encodeURIComponent(query)}`;
}

/** "3:45" or "1:02:03" to seconds; 0 for anything else. */
export function parseDuration(text: string | undefined): number {
  if (!text || !/^\d+(?::\d{1,2}){1,2}$/.test(text.trim())) return 0;
  return text
    .trim()
    .split(':')
    .reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const hms = s >= 3600 ? [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60] : [Math.floor(s / 60), s % 60];
  return hms.map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, '0'))).join(':');
}

// ── YouTube ──────────────────────────────────────────────────────────────────────────────────────

interface YtText {
  simpleText?: string;
  runs?: { text?: string }[];
}

interface YtVideoRenderer {
  videoId?: string;
  title?: YtText;
  ownerText?: YtText;
  longBylineText?: YtText;
  lengthText?: YtText;
}

function ytText(t: YtText | undefined): string {
  if (!t) return '';
  return t.simpleText ?? (t.runs ?? []).map((r) => r.text ?? '').join('');
}

/**
 * Pulls the videos out of a YouTube search response (the JSON from youtubei/v1/search, or the
 * `ytInitialData` of a results page). The layout around the results changes often, so this looks
 * for `videoRenderer` objects anywhere in the tree instead of following one fixed path. Ads,
 * channels, playlists and shelves of shorts have other renderer names and are skipped.
 */
export function parseYouTubeSearch(data: unknown): MediaSearchResult[] {
  const out: MediaSearchResult[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [data];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]); // keep document order
      continue;
    }
    const obj = node as Record<string, unknown>;
    const v = obj.videoRenderer as YtVideoRenderer | undefined;
    if (v && typeof v === 'object' && typeof v.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.videoId)) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        const channel = ytText(v.ownerText) || ytText(v.longBylineText);
        const topic = channel.match(/^(.+) - Topic$/);
        out.push({
          source: 'youtube',
          id: v.videoId,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          title: ytText(v.title),
          artist: channel,
          duration: parseDuration(ytText(v.lengthText)),
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          cleanArtist: topic ? topic[1] : undefined,
        });
      }
      continue;
    }
    const values = Object.values(obj);
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
  }
  return out;
}

// ── Spotify ──────────────────────────────────────────────────────────────────────────────────────

interface SpotifyTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { name?: string; images?: { url?: string; width?: number }[] };
}

/** Tracks from a Spotify Web API `/v1/search?type=track` response. */
export function parseSpotifySearch(data: unknown): MediaSearchResult[] {
  const items = (data as { tracks?: { items?: (SpotifyTrack | null)[] } } | null)?.tracks?.items ?? [];
  const out: MediaSearchResult[] = [];
  for (const t of items) {
    if (!t?.id || !/^[A-Za-z0-9]{22}$/.test(t.id)) continue;
    const artists = (t.artists ?? []).map((a) => a.name ?? '').filter(Boolean);
    // Smallest cover that is still at least 100 px wide (Spotify lists them largest first).
    const images = (t.album?.images ?? []).filter((i) => i.url);
    const image = [...images].reverse().find((i) => (i.width ?? 0) >= 100) ?? images[0];
    out.push({
      source: 'spotify',
      id: t.id,
      url: `https://open.spotify.com/track/${t.id}`,
      title: t.name ?? '',
      artist: artists.join(', '),
      album: t.album?.name,
      duration: Math.round((t.duration_ms ?? 0) / 1000),
      thumbnail: image?.url ?? '',
      cleanArtist: artists[0],
    });
  }
  return out;
}

// ── Ranking ──────────────────────────────────────────────────────────────────────────────────────

/** Versions whose timing differs from the record. Each sinks unless the query asks for it. */
const DETOURS: [RegExp, number][] = [
  [/\b(cover|covered by)\b/, 6],
  [/\b(lesson|tutorial|how to play|guitar lesson|bass lesson|drum lesson)\b/, 8],
  [/\b(karaoke|backing track|instrumental|no vocals|minus one)\b/, 5],
  [/\b(live|concert|unplugged|acoustic session|live at|live from)\b/, 5],
  [/\b(reaction|reacts|review|analysis|explained)\b/, 8],
  [/\b(slowed|sped up|nightcore|8d|reverb|remix|mashup|bass boosted)\b/, 6],
  [/\b(full album|playlist|compilation|1 hour|10 hours)\b/, 8],
  [/\b(drum cover|guitar cover|bass cover|piano cover|playthrough|play through)\b/, 4],
  [/\b(tab|tabs|chords)\b/, 3],
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Higher is better. Rewards results that contain the words of the query and look like the original
 * record (YouTube "Topic" channels carry the album audio, "official audio" uploads come next), and
 * penalises the detours above unless the query mentions them.
 */
export function scoreResult(result: MediaSearchResult, query: string): number {
  const q = normalize(query);
  const qWords = new Set(q.split(' ').filter((w) => w.length > 1));
  const hay = normalize(`${result.title} ${result.artist} ${result.album ?? ''}`);
  const hayWords = new Set(hay.split(' '));
  let score = 0;

  if (qWords.size) {
    let hits = 0;
    for (const w of qWords) if (hayWords.has(w)) hits++;
    score += (10 * hits) / qWords.size;
  }

  const title = normalize(result.title);
  for (const [re, penalty] of DETOURS) {
    if (re.test(title) && !re.test(q)) score -= penalty;
  }

  if (result.source === 'youtube') {
    if (result.cleanArtist) score += 4;
    else if (/\bofficial (audio|lyric video|visualizer)\b/.test(title)) score += 3;
    else if (/\bofficial (music )?video\b/.test(title)) score += 1.5; // often has an intro or outro
    if (/vevo$/i.test(result.artist.replace(/\s/g, ''))) score += 1;
  }

  // Song-length recordings. Over 15 minutes is a mix, an album or a livestream.
  if (result.duration > 15 * 60) score -= 6;
  else if (result.duration > 0 && result.duration < 45) score -= 4;
  return score;
}

/**
 * Sorts by score. The service's own order breaks ties and carries a small weight, since it already
 * knows about popularity, which we don't.
 */
export function rankResults(results: MediaSearchResult[], query: string): MediaSearchResult[] {
  return results
    .map((r, i) => ({ r, s: scoreResult(r, query) - i * 0.25 }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}
