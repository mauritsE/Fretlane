import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NewSongInput, Song, SongPatch, SyncPoint, TabFormat } from '../shared/types.ts';
import { detectTabFormat, parseMediaLink, parseYouTubeId, slugify } from '../shared/util.ts';
import { asciiTabToAlphaTex } from '../shared/asciiTab.ts';
import { normalizeSyncPoints } from '../shared/sync.ts';
import { fetchTab } from './fetchTab.ts';
import { MAX_AUDIO_BYTES, detectAudioFormat } from '../shared/audio.ts';

const MAX_TAB_BYTES = 20 * 1024 * 1024;
/** The demo songs that shipped before the seed was tracked; libraries from then already had them. */
const LEGACY_SEEDS = ['first-steps.atex', 'rotterdam-riff.atex', 'night-trail.txt'];

export class Library {
  private readonly dbFile: string;
  private readonly seededFile: string;
  private readonly tabsDir: string;
  private readonly audioDir: string;
  private songs: Song[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.dbFile = path.join(root, 'songs.json');
    this.seededFile = path.join(root, 'seeded.json');
    this.tabsDir = path.join(root, 'tabs');
    this.audioDir = path.join(root, 'audio');
  }

  /**
   * `seed` is a demo folder on disk, or an in-memory source. Bundled songs are added on first run,
   * and songs added to the bundle in a later version are added to existing libraries too. A song
   * the user deleted is never added again: seeded.json remembers what was seeded.
   */
  async init(seed?: string | SeedSource): Promise<void> {
    await fs.mkdir(this.tabsDir, { recursive: true });
    await fs.mkdir(this.audioDir, { recursive: true });
    let fresh = false;
    try {
      this.songs = (JSON.parse(await fs.readFile(this.dbFile, 'utf8')) as Song[]).map(withDefaults);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.songs = [];
      fresh = true;
    }
    const added = seed ? await this.seed(typeof seed === 'string' ? dirSeedSource(seed) : seed, fresh) : 0;
    if (fresh || added) await this.persist();
  }

  /** Adds bundled songs that were never seeded before. Returns how many were added. */
  private async seed(source: SeedSource, fresh: boolean): Promise<number> {
    let manifest: DemoEntry[];
    try {
      manifest = JSON.parse(new TextDecoder().decode(await source.read('demo-songs.json'))) as DemoEntry[];
    } catch {
      return 0;
    }
    let seeded: Set<string>;
    try {
      seeded = new Set(JSON.parse(await fs.readFile(this.seededFile, 'utf8')) as string[]);
    } catch {
      // No record yet: a new library, or one from before the record existed.
      seeded = new Set(fresh ? [] : [...LEGACY_SEEDS, ...this.songs.map((s) => s.tabSource)]);
    }
    let added = 0;
    for (const entry of manifest) {
      if (seeded.has(entry.file)) continue;
      const bytes = await source.read(entry.file);
      const song = await this.add(
        {
          title: entry.title,
          artist: entry.artist,
          youtube: entry.youtube,
          tags: entry.tags,
          tabFile: { name: entry.file, dataBase64: Buffer.from(bytes).toString('base64') },
        },
        false,
      );
      if (entry.syncPoints) song.syncPoints = entry.syncPoints;
      seeded.add(entry.file);
      added++;
    }
    await fs.writeFile(this.seededFile, JSON.stringify([...seeded], null, 2));
    return added;
  }

  /** Favorites first, then by artist and title. */
  list(): Song[] {
    return [...this.songs].sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    );
  }

  get(id: string): Song | undefined {
    return this.songs.find((s) => s.id === id);
  }

  findByCloudId(cloudId: string): Song | undefined {
    return this.songs.find((s) => s.cloudId === cloudId);
  }

  tabPath(song: Song): string {
    return path.join(this.tabsDir, song.tabFile);
  }

  /** The song's own audio file on disk, or null when it has none. */
  audioPath(song: Song): string | null {
    return song.audioFile ? path.join(this.audioDir, song.audioFile) : null;
  }

  /**
   * Stores an audio file (streamed, since a WAV can be hundreds of MB) as the song's recording.
   * It replaces a YouTube video, Spotify track or earlier audio file. Sync pins are kept.
   */
  async setAudio(id: string, name: string, data: AsyncIterable<Uint8Array>): Promise<Song> {
    const song = this.get(id);
    if (!song) throw new HttpError(404, 'Song not found');
    const tmp = path.join(this.audioDir, `.upload-${randomUUID()}`);
    try {
      let size = 0;
      const head: Uint8Array[] = [];
      const out = createWriteStream(tmp);
      const done = new Promise<void>((resolve, reject) => {
        out.on('finish', resolve);
        out.on('error', reject);
      });
      try {
        for await (const chunk of data) {
          size += chunk.byteLength;
          if (size > MAX_AUDIO_BYTES) throw new HttpError(413, `Audio file is larger than ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`);
          if (head.length < 4) head.push(chunk);
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        }
      } finally {
        out.end();
        await done;
      }
      if (size === 0) throw new HttpError(400, 'Audio file is empty.');
      const format = detectAudioFormat(Buffer.concat(head).subarray(0, 16));
      if (!format) throw new HttpError(415, 'Not a supported audio file. Use MP3, WAV, OGG/Opus, FLAC, M4A/AAC or WebM.');

      const file = `${song.id}.${format}`;
      await fs.rename(tmp, path.join(this.audioDir, file));
      if (song.audioFile && song.audioFile !== file) await fs.rm(path.join(this.audioDir, song.audioFile), { force: true });
      Object.assign(song, { audioFile: file, audioName: name.split(/[\\/]/).pop()?.trim() || file, youtubeId: '', spotifyId: '' });
      song.updatedAt = new Date().toISOString();
      await this.persist();
      return song;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  private async dropAudio(song: Song): Promise<void> {
    const file = this.audioPath(song);
    song.audioFile = '';
    song.audioName = '';
    if (file) await fs.rm(file, { force: true });
  }

  async add(input: NewSongInput, persist = true): Promise<Song> {
    let bytes: Uint8Array;
    let sourceName: string;
    if (input.tabFile) {
      bytes = Buffer.from(input.tabFile.dataBase64, 'base64');
      sourceName = input.tabFile.name;
    } else if (input.tabUrl) {
      const fetched = await fetchTab(input.tabUrl, MAX_TAB_BYTES);
      bytes = fetched.bytes;
      sourceName = fetched.name;
    } else if (input.tabText?.trim()) {
      bytes = new TextEncoder().encode(input.tabText);
      sourceName = 'pasted.txt';
    } else {
      throw new HttpError(400, 'Provide a tab: upload a file, give a URL, or paste text.');
    }
    if (bytes.byteLength > MAX_TAB_BYTES) throw new HttpError(413, 'Tab file is larger than 20 MB.');
    if (bytes.byteLength === 0) throw new HttpError(400, 'Tab is empty.');

    let format: TabFormat = input.written ? 'alphatex' : detectTabFormat(sourceName, bytes);
    const title = input.title?.trim() || stripExt(path.basename(sourceName.split('?')[0])) || 'Untitled';
    const artist = input.artist?.trim() || 'Unknown artist';

    // Plain-text tabs are converted once on import so the stored file is always playable.
    if (format === 'ascii') {
      const tex = asciiTabToAlphaTex(new TextDecoder().decode(bytes), { title, artist });
      bytes = new TextEncoder().encode(tex);
      format = 'alphatex';
    }

    const id = `${slugify(`${artist}-${title}`) || 'song'}-${randomUUID().slice(0, 6)}`;
    const tabFile = `${id}.${extFor(format, sourceName)}`;
    await fs.writeFile(path.join(this.tabsDir, tabFile), bytes);

    const now = new Date().toISOString();
    const song: Song = {
      id,
      title,
      artist,
      ...(input.media !== undefined ? parseMediaLink(input.media) : { youtubeId: parseYouTubeId(input.youtube), spotifyId: '' }),
      audioFile: '',
      audioName: '',
      tabFile,
      tabFormat: format,
      tabSource: input.written ? 'written in Fretlane' : input.tabUrl ?? input.tabFile?.name ?? 'pasted text',
      syncPoints: normalizeSyncPoints(cleanSyncPoints(input.syncPoints ?? [])),
      defaultTrack: 0,
      tags: input.tags ?? [],
      favorite: false,
      archivedAt: null,
      ...(input.cloudId ? { cloudId: String(input.cloudId) } : {}),
      ...(input.written ? { written: true } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.songs.push(song);
    if (persist) await this.persist();
    return song;
  }

  async update(id: string, patch: SongPatch): Promise<Song> {
    const song = this.get(id);
    if (!song) throw new HttpError(404, 'Song not found');
    if (patch.title !== undefined) song.title = String(patch.title).trim() || song.title;
    if (patch.artist !== undefined) song.artist = String(patch.artist).trim() || song.artist;
    const youtube = patch.youtube ?? patch.youtubeId;
    if (patch.media !== undefined) {
      Object.assign(song, parseMediaLink(patch.media));
      await this.dropAudio(song);
    } else if (youtube !== undefined) {
      song.youtubeId = parseYouTubeId(youtube);
      if (song.youtubeId) {
        song.spotifyId = '';
        await this.dropAudio(song);
      }
    }
    if (patch.defaultTrack !== undefined) song.defaultTrack = Math.max(0, Math.floor(Number(patch.defaultTrack)) || 0);
    if (patch.tags !== undefined) song.tags = patch.tags.map(String);
    if (patch.favorite !== undefined) song.favorite = patch.favorite === true;
    if (patch.archived !== undefined) {
      if (patch.archived !== true) song.archivedAt = null;
      else if (!song.archivedAt) song.archivedAt = new Date().toISOString();
    }
    if (patch.syncPoints !== undefined) {
      song.syncPoints = normalizeSyncPoints(cleanSyncPoints(patch.syncPoints));
    }
    song.updatedAt = new Date().toISOString();
    await this.persist();
    return song;
  }

  /**
   * Replaces the tab of a song written in the editor (the editor's autosave). Written atomically, so
   * a crash mid-save leaves the previous version rather than half a file.
   */
  async setTab(id: string, data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<Song> {
    const song = this.get(id);
    if (!song) throw new HttpError(404, 'Song not found');
    if (!song.written) throw new HttpError(409, 'Only songs written in Fretlane can be saved from the editor. Make an editable copy first.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of data) {
      size += chunk.byteLength;
      if (size > MAX_TAB_BYTES) throw new HttpError(413, 'Tab file is larger than 20 MB.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.byteLength) throw new HttpError(400, 'Tab is empty.');
    // The editor's alphaTex starts with a tag such as \title; anything else (a binary file, HTML) is not from it.
    if (!new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().startsWith('\\')) throw new HttpError(415, 'The editor saves alphaTex.');
    const file = this.tabPath(song);
    const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
    try {
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, file);
    } finally {
      await fs.rm(tmp, { force: true });
    }
    song.updatedAt = new Date().toISOString();
    await this.persist();
    return song;
  }

  async remove(id: string): Promise<void> {
    const song = this.get(id);
    if (!song) throw new HttpError(404, 'Song not found');
    this.songs = this.songs.filter((s) => s.id !== id);
    await fs.rm(this.tabPath(song), { force: true });
    await this.dropAudio(song);
    await this.persist();
  }

  private persist(): Promise<void> {
    // Serialize writes and write atomically so a crash never leaves a half-written songs.json.
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.dbFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.songs, null, 2));
      await fs.rename(tmp, this.dbFile);
    });
    return this.writeQueue;
  }
}

/** Songs saved by older versions lack the newer fields. */
function withDefaults(song: Song): Song {
  return {
    ...song,
    spotifyId: song.spotifyId ?? '',
    audioFile: song.audioFile ?? '',
    audioName: song.audioName ?? '',
    favorite: song.favorite === true,
    archivedAt: song.archivedAt ?? null,
  };
}

type DemoEntry = Omit<NewSongInput, 'tabFile'> & { file: string; syncPoints?: Song['syncPoints'] };

/** Where first-run demo songs come from: `demo-songs.json` plus the tab files it lists. */
export interface SeedSource {
  read(file: string): Promise<Uint8Array>;
}

export function dirSeedSource(dir: string): SeedSource {
  return { read: async (file) => new Uint8Array(await fs.readFile(path.join(dir, path.basename(file)))) };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function cleanSyncPoints(points: SyncPoint[]): SyncPoint[] {
  return points.map((p) => ({ bar: Math.max(0, Math.floor(Number(p.bar))), time: Math.max(0, Number(p.time)) }));
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

function extFor(format: TabFormat, sourceName: string): string {
  const ext = (sourceName.split('?')[0].split('.').pop() ?? '').toLowerCase();
  if (format === 'gp') return ['gp3', 'gp4', 'gp5', 'gpx', 'gp'].includes(ext) ? ext : 'gp';
  if (format === 'musicxml') return ext === 'mxl' ? 'mxl' : 'musicxml';
  return 'atex';
}
