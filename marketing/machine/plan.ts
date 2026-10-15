/**
 * The marketing machine's pure logic: when posts go out, which songbook song and format each post
 * gets, the text per platform, and the queue file format. No I/O here, so vitest covers all of it
 * (tests/marketing-plan.test.ts). The scripts next to this file do the recording, rendering and
 * posting.
 */
import { APP_NAME } from '../../shared/brand.ts';
import type { SongSpec } from '../../shared/songbook.ts';

export const DOWNLOAD_URL = 'https://github.com/mauritsE/Fretlane/releases/latest';
export const SOURCE_URL = 'https://github.com/mauritsE/Fretlane';
/** Posting slots: weekday (0 = Sunday) and local time in TIME_ZONE. */
export const SLOTS: { weekday: number; hour: number; minute: number }[] = [
  { weekday: 2, hour: 18, minute: 30 }, // Tuesday evening
  { weekday: 5, hour: 18, minute: 30 }, // Friday evening
];
export const TIME_ZONE = 'Europe/Amsterdam';
/** A post that is this late (say, its PR was merged days after its slot) is skipped, not posted. */
export const MAX_LATE_HOURS = 72;

export type Platform = 'youtube' | 'instagram' | 'facebook';
export const PLATFORMS: Platform[] = ['youtube', 'instagram', 'facebook'];

/**
 * What a Short shows. Every format is a real recording of the app playing the song:
 * - play-along: the whole band at full speed.
 * - half-speed: the opening at 50 %, then the same bars at 100 %.
 * - track-tour: the same music while the view switches lead → bass → drums.
 */
export type ShortFormat = 'play-along' | 'half-speed' | 'track-tour';
export const FORMATS: ShortFormat[] = ['play-along', 'half-speed', 'track-tour'];

export interface MediaFile {
  /** File name; the media lives outside git (see README). */
  file: string;
  /** Public URL once uploaded. Instagram and Facebook fetch media from a URL. */
  url?: string;
  sha256: string;
  bytes: number;
  durationSec?: number;
  width: number;
  height: number;
}

export interface QueuedPost {
  id: string;
  kind: 'short' | 'release';
  /** ISO 8601, UTC. */
  scheduledAt: string;
  song?: { id: string; title: string; format: ShortFormat };
  release?: { tag: string; url: string };
  media: { video?: MediaFile; image?: MediaFile; cover?: MediaFile };
  youtube?: { title: string; description: string; tags: string[]; categoryId: string; privacyStatus: 'public' | 'private' | 'unlisted' };
  instagram?: { caption: string };
  facebook?: { message: string };
}

/** What a posted (or attempted) post left behind, per platform. */
export interface PostedRecord {
  post: QueuedPost;
  results: Partial<Record<Platform, { ok: boolean; id?: string; url?: string; error?: string; at: string }>>;
}

// ---------- time ----------

/** Minutes the zone is ahead of UTC at a given instant (e.g. 120 for Amsterdam in summer). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant of a wall-clock time in a zone. Handles the daylight-saving switch. */
export function zonedToUtc(y: number, month: number, d: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(y, month - 1, d, hour, minute);
  let t = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  // Second pass: the offset at the guess can differ from the offset at the answer near a switch.
  t = guess - zoneOffsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}

/** Local calendar date (y, m, d, weekday) of an instant in a zone. */
function localDate(instant: Date, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const shifted = new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** All posting slots strictly after `from` and before `from + days`, oldest first. */
export function slotsBetween(from: Date, days: number, slots = SLOTS, timeZone = TIME_ZONE): Date[] {
  const out: Date[] = [];
  const end = from.getTime() + days * 86400000;
  for (let i = 0; i <= days + 1; i++) {
    const day = localDate(new Date(from.getTime() + i * 86400000), timeZone);
    for (const s of slots) {
      if (s.weekday !== day.weekday) continue;
      const t = zonedToUtc(day.y, day.m, day.d, s.hour, s.minute, timeZone);
      if (t.getTime() > from.getTime() && t.getTime() < end) out.push(t);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).filter((t, i, a) => i === 0 || t.getTime() !== a[i - 1].getTime());
}

/** The first slot after `from` (for release posts: the next regular posting moment). */
export function nextSlot(from: Date, slots = SLOTS, timeZone = TIME_ZONE): Date {
  return slotsBetween(from, 8, slots, timeZone)[0];
}

/** Release posts go out the day after the release, at lunchtime, apart from the Shorts. */
export function releaseSlot(from: Date, timeZone = TIME_ZONE): Date {
  const d = localDate(new Date(from.getTime() + 86400000), timeZone);
  return zonedToUtc(d.y, d.m, d.d, 12, 30, timeZone);
}

// ---------- picking songs ----------

export interface HistoryEntry {
  songId: string;
  format: ShortFormat;
  at: string;
}

/** Holiday songs only in their season: December for Christmas songs. */
export function inSeason(song: Pick<SongSpec, 'tags'>, when: Date): boolean {
  if (song.tags.includes('holiday')) return localDate(when, TIME_ZONE).m === 12;
  return true;
}

type PartsOf = Pick<SongSpec, 'solo' | 'drums'>;

/** The tracks shared/songbook.ts writes for a song, in order (checked against demo/*.atex in tests). */
export function songTracks(song: PartsOf): string[] {
  if (song.solo) return ['Melody'];
  return ['Melody', 'Rhythm guitar', 'Bass', ...(song.drums ? ['Drums'] : [])];
}

/** The three tracks the track tour shows: lead, bass, drums; or lead, rhythm, bass without drums. */
export function tourTracks(song: PartsOf): string[] {
  const t = songTracks(song);
  return t.includes('Drums') ? ['Melody', 'Bass', 'Drums'] : t.slice(0, 3);
}

const TRACK_LABEL: Record<string, string> = { Melody: 'Lead guitar', 'Rhythm guitar': 'Rhythm guitar', Bass: 'Bass', Drums: 'Drums' };

/** What plays, in words: "solo guitar", "guitars and bass", "guitars, bass and drums". */
export function partsPhrase(song: PartsOf): string {
  if (song.solo) return 'solo guitar';
  return song.drums ? 'guitars, bass and drums' : 'guitars and bass';
}

/** Solo pieces have one track, so there is nothing to switch between. */
export function supportsFormat(song: PartsOf, format: ShortFormat): boolean {
  return format !== 'track-tour' || songTracks(song).length >= 3;
}

/**
 * Picks the song and format for each slot. Formats rotate in FORMATS order (continuing from the
 * last one in the history); within that, the song posted longest ago (never posted first) wins,
 * a song is never picked twice in a row of 4 posts, and ties go to songbook order so the result is
 * the same every run.
 */
export function pickShorts(songbook: SongSpec[], history: HistoryEntry[], slots: Date[]): { at: Date; song: SongSpec; format: ShortFormat }[] {
  const hist = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const lastUse = new Map<string, string>();
  for (const h of hist) lastUse.set(h.songId, h.at);
  let formatIndex = hist.length ? (FORMATS.indexOf(hist[hist.length - 1].format) + 1) % FORMATS.length : 0;
  const recent = hist.slice(-3).map((h) => h.songId);
  const out: { at: Date; song: SongSpec; format: ShortFormat }[] = [];
  for (const at of slots) {
    let picked: { song: SongSpec; format: ShortFormat } | undefined;
    for (let f = 0; f < FORMATS.length && !picked; f++) {
      const format = FORMATS[(formatIndex + f) % FORMATS.length];
      const candidates = songbook
        .map((song, order) => ({ song, order }))
        .filter(({ song }) => inSeason(song, at) && supportsFormat(song, format) && !recent.includes(song.id));
      candidates.sort((a, b) => (lastUse.get(a.song.id) ?? '').localeCompare(lastUse.get(b.song.id) ?? '') || a.order - b.order);
      if (candidates.length) picked = { song: candidates[0].song, format };
    }
    if (!picked) throw new Error(`no song fits the slot at ${at.toISOString()}`);
    out.push({ at, ...picked });
    lastUse.set(picked.song.id, at.toISOString());
    recent.push(picked.song.id);
    if (recent.length > 3) recent.shift();
    formatIndex = (FORMATS.indexOf(picked.format) + 1) % FORMATS.length;
  }
  return out;
}

// ---------- text ----------

const LEVEL: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

/** The words drawn on the video: the hook at the top and one label per segment. */
export function onScreenText(song: Pick<SongSpec, 'title' | 'artist' | 'difficulty' | 'solo' | 'drums'>, format: ShortFormat): { hook: string; sub: string; labels: string[] } {
  const sub = `${song.artist} · ${LEVEL[song.difficulty] ?? song.difficulty}`;
  switch (format) {
    case 'play-along': {
      const p = partsPhrase(song);
      return { hook: `Play along:\n${song.title}`, sub, labels: [song.solo ? 'Solo guitar, cursor on every note' : `${p.charAt(0).toUpperCase()}${p.slice(1)} play with you`] };
    }
    case 'half-speed':
      return { hook: `${song.title}:\nslow, then full speed`, sub, labels: ['50 % speed', '100 % speed'] };
    case 'track-tour':
      return { hook: `${song.title}:\nevery part of the band`, sub, labels: tourTracks(song).map((t) => TRACK_LABEL[t]) };
  }
}

const HASHTAG_BY_TAG: Record<string, string> = {
  folk: '#folkguitar', classical: '#classicalguitar', fingerstyle: '#fingerstyle', rock: '#rockguitar',
  beginner: '#beginnerguitar', holiday: '#christmasguitar', kids: '#kidssongs', jazz: '#jazzguitar',
  baroque: '#baroque', hymn: '#hymn', country: '#countryguitar', riff: '#guitarriff',
};

export function hashtags(song: Pick<SongSpec, 'tags' | 'difficulty'>, max = 8): string[] {
  const tags = ['#guitar', '#guitartabs', '#guitarpractice'];
  for (const t of [song.difficulty, ...song.tags]) {
    const h = HASHTAG_BY_TAG[t];
    if (h && !tags.includes(h)) tags.push(h);
  }
  tags.push('#opensource');
  return tags.slice(0, max);
}

function formatLine(song: PartsOf, format: ShortFormat): string {
  switch (format) {
    case 'play-along':
      return song.solo ? 'A solo guitar piece with a cursor on every note, so you can play along.' : `Open the song and the ${partsPhrase(song)} play along, with a cursor on every note.`;
    case 'half-speed':
      return 'Too fast? Drop it to half speed, then build back up to full speed.';
    case 'track-tour': {
      const t = tourTracks(song).map((x) => TRACK_LABEL[x].toLowerCase());
      return `${t[0].charAt(0).toUpperCase()}${t[0].slice(1)}, ${t[1]} and ${t[2]}: switch to the part you want to learn while the song keeps playing.`;
    }
  }
}

/** Short titles, captions and descriptions for one Short, per platform. */
export function shortCopy(song: SongSpec, format: ShortFormat): Pick<QueuedPost, 'youtube' | 'instagram' | 'facebook'> {
  const tags = hashtags(song);
  const what = `${song.title}: ${song.origin} (${song.artist === 'Traditional' ? 'traditional' : song.artist}).`;
  const arrangement = `${APP_NAME}'s own arrangement of a public-domain melody, played by the app itself.`;
  const ytTitle = {
    'play-along': song.solo ? `${song.title}: solo guitar tab play-along` : `${song.title}: guitar tab play-along with ${partsPhrase(song)}`,
    'half-speed': `${song.title} on guitar: half speed, then full speed`,
    'track-tour': song.drums ? `${song.title}: guitar, bass and drum tabs in one` : `${song.title}: lead, rhythm and bass tabs in one`,
  }[format];
  return {
    youtube: {
      title: `${ytTitle} #Shorts`,
      description: [
        formatLine(song, format), '', what, arrangement, '',
        `${APP_NAME} is a free, open-source guitar tab player for Mac, Windows and Linux.`,
        `Download: ${DOWNLOAD_URL}`, `Source: ${SOURCE_URL}`, '', tags.join(' '),
      ].join('\n'),
      tags: ['guitar', 'guitar tabs', 'tab player', song.title, APP_NAME, ...song.tags],
      categoryId: '10', // Music
      privacyStatus: 'public',
    },
    instagram: {
      caption: [formatLine(song, format), '', what, arrangement, '', `${APP_NAME} is free and open source. Link in bio.`, '', tags.join(' ')].join('\n'),
    },
    facebook: {
      message: [formatLine(song, format), '', what, arrangement, '', `${APP_NAME} is a free, open-source guitar tab player for Mac, Windows and Linux: ${DOWNLOAD_URL}`].join('\n'),
    },
  };
}

/**
 * The "What's new" bullets of a release, from a "## What's new" (or "## Highlights") section of
 * its notes. Returns [] when there is none: the draft PR then asks you to write them.
 */
export function releaseHighlights(notes: string, max = 4): string[] {
  const m = notes.match(/^#{2,3}\s*(what'?s new|highlights|new in this version)\b.*$/im);
  if (!m) return [];
  const rest = notes.slice(m.index! + m[0].length);
  const section = rest.split(/^#{1,3}\s/m)[0];
  return section
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+(.+)$/)?.[1].trim())
    .filter((l): l is string => !!l)
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1'))
    .slice(0, max);
}

/** Copy for a release post (Instagram and Facebook image post; YouTube has no image posts in its API). */
export function releaseCopy(tag: string, highlights: string[]): Pick<QueuedPost, 'instagram' | 'facebook'> {
  const version = tag.replace(/^v/, '');
  const head = `${APP_NAME} ${version} is out. 🎸`;
  const list = highlights.length ? highlights.map((h) => `• ${h}`).join('\n') : 'TODO: write what is new (no "## What\'s new" section in the release notes).';
  return {
    instagram: { caption: [head, '', list, '', 'Free and open source for Mac, Windows and Linux. Link in bio.', '', '#guitar #guitartabs #opensource'].join('\n') },
    facebook: { message: [head, '', list, '', `Download it free: ${DOWNLOAD_URL}`].join('\n') },
  };
}

export function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function postId(at: Date, what: string): string {
  return `${at.toISOString().slice(0, 10)}-${slug(what)}`;
}

// ---------- validation and due posts ----------

/** Platform limits that would make an upload fail. Returns problems, [] when the post is fine. */
export function validatePost(p: QueuedPost): string[] {
  const errs: string[] = [];
  if (!/^\d{4}-\d\d-\d\d-[a-z0-9-]+$/.test(p.id)) errs.push(`bad id ${p.id}`);
  if (Number.isNaN(Date.parse(p.scheduledAt))) errs.push('scheduledAt is not a date');
  if (p.youtube) {
    if (!p.media.video) errs.push('youtube needs a video');
    if (p.youtube.title.length > 100) errs.push(`youtube title is ${p.youtube.title.length} chars (max 100)`);
    if (/[<>]/.test(p.youtube.title + p.youtube.description)) errs.push('youtube text may not contain < or >');
    if (new TextEncoder().encode(p.youtube.description).length > 5000) errs.push('youtube description over 5000 bytes');
    if (p.youtube.tags.join(',').length > 500) errs.push('youtube tags over 500 chars');
  }
  if (p.instagram) {
    if (!p.media.video && !p.media.image) errs.push('instagram needs a video or an image');
    if (p.instagram.caption.length > 2200) errs.push('instagram caption over 2200 chars');
    if ((p.instagram.caption.match(/#\w+/g) ?? []).length > 30) errs.push('instagram allows at most 30 hashtags');
  }
  if (p.facebook && !p.media.video && !p.media.image) errs.push('facebook needs a video or an image');
  for (const [k, v] of Object.entries({ ...p.instagram, ...p.facebook })) if (/TODO/.test(String(v))) errs.push(`${k} still has a TODO`);
  const v = p.media.video;
  if (v && (v.width !== 1080 || v.height !== 1920)) errs.push('video must be 1080x1920');
  if (v?.durationSec !== undefined && (v.durationSec < 3 || v.durationSec > 90)) errs.push(`video is ${v.durationSec}s (Reels: 3-90s)`);
  return errs;
}

export type DueState = 'not-yet' | 'due' | 'too-late';
export function dueState(p: QueuedPost, now: Date): DueState {
  const late = now.getTime() - Date.parse(p.scheduledAt);
  if (late < 0) return 'not-yet';
  return late > MAX_LATE_HOURS * 3600000 ? 'too-late' : 'due';
}

/** The platforms a post has text for and that are switched on, minus those already done. */
export function pendingPlatforms(p: QueuedPost, enabled: Platform[], done: PostedRecord['results'] = {}): Platform[] {
  return PLATFORMS.filter((pl) => p[pl] && enabled.includes(pl) && !done[pl]?.ok);
}
