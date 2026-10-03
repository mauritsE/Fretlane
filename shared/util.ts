import type { TabFormat } from './types.ts';

/** Accepts a bare id or any common YouTube URL shape and returns the 11-char video id. */
export function parseYouTubeId(input: string | undefined | null): string {
  if (!input) return '';
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s);
    const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtu.be') return clean(url.pathname.slice(1));
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v) return clean(v);
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (m) return clean(m[1]);
    }
  } catch {
    /* not a URL */
  }
  return '';
}

/**
 * Accepts a Spotify track link (open.spotify.com/track/…, with or without a locale segment such as
 * /intl-nl/, or the /embed/ form), a `spotify:track:…` URI, or a bare 22-character track id.
 */
export function parseSpotifyTrackId(input: string | undefined | null): string {
  if (!input) return '';
  const s = input.trim();
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s;
  const uri = s.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  try {
    const url = new URL(s);
    if (url.hostname !== 'open.spotify.com' && url.hostname !== 'play.spotify.com') return '';
    const m = url.pathname.match(/^(?:\/intl-[a-z-]+)?(?:\/embed)?\/track\/([A-Za-z0-9]{22})(?:\/|$)/i);
    if (m) return m[1];
  } catch {
    /* not a URL */
  }
  return '';
}

/** The recording a song plays along with. A song has at most one: sync pins belong to one recording. */
export interface MediaLink {
  youtubeId: string;
  spotifyId: string;
}

/** Parses a YouTube or Spotify link. Anything unrecognized (including empty input) gives no recording. */
export function parseMediaLink(input: string | undefined | null): MediaLink {
  const youtubeId = parseYouTubeId(input);
  return { youtubeId, spotifyId: youtubeId ? '' : parseSpotifyTrackId(input) };
}

/** A link the user can paste back into the song dialog. */
export function mediaLinkUrl(song: MediaLink): string {
  if (song.youtubeId) return `https://www.youtube.com/watch?v=${song.youtubeId}`;
  if (song.spotifyId) return `https://open.spotify.com/track/${song.spotifyId}`;
  return '';
}

function clean(id: string): string {
  const m = id.match(/^[A-Za-z0-9_-]{11}/);
  return m ? m[0] : '';
}

const GP_EXT = ['gp', 'gp3', 'gp4', 'gp5', 'gpx', 'gp7'];
const XML_EXT = ['xml', 'musicxml', 'mxl'];
const TEX_EXT = ['tex', 'alphatex', 'atex'];

/** Best-effort detection from file name + contents. */
export function detectTabFormat(name: string, bytes: Uint8Array): TabFormat {
  const ext = (name.split('?')[0].split('.').pop() ?? '').toLowerCase();
  if (GP_EXT.includes(ext)) return 'gp';
  if (XML_EXT.includes(ext)) return 'musicxml';
  if (TEX_EXT.includes(ext)) return 'alphatex';

  // Binary signatures: GP3-5 start with a length-prefixed "FICHIER GUITAR PRO", GPX with "BCFZ"/"BCFS",
  // GP7+ and .mxl are zip files ("PK").
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64));
  if (head.includes('FICHIER GUITAR PRO') || head.startsWith('BCF')) return 'gp';
  if (head.startsWith('PK')) return ext === 'mxl' ? 'musicxml' : 'gp';

  const text = new TextDecoder().decode(bytes.subarray(0, 4096)).trimStart();
  if (text.startsWith('<?xml') || text.includes('<score-partwise') || text.includes('<score-timewise')) return 'musicxml';
  if (looksLikeAsciiTab(text)) return 'ascii';
  return 'alphatex';
}

/** Six (or four/seven) consecutive lines like `e|---0---3--|` mean a plain-text tab. */
export function looksLikeAsciiTab(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let run = 0;
  for (const line of lines) {
    if (/^\s*[A-Ga-g][#b]?\s*[|:]?[-0-9|hpbrx/\\~()<>.^*sv ]{6,}/.test(line) && line.includes('-')) {
      run++;
      if (run >= 4) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
