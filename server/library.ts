import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NewSongInput, Song, SongPatch, TabFormat } from '../shared/types.ts';
import { detectTabFormat, parseYouTubeId, slugify } from '../shared/util.ts';
import { asciiTabToAlphaTex } from '../shared/asciiTab.ts';
import { normalizeSyncPoints } from '../shared/sync.ts';
import { fetchTab } from './fetchTab.ts';

const MAX_TAB_BYTES = 20 * 1024 * 1024;
/** The demo songs that shipped before the seed was tracked; libraries from then already had them. */
const LEGACY_SEEDS = ['first-steps.atex', 'rotterdam-riff.atex', 'night-trail.txt'];

export class Library {
  private readonly dbFile: string;
  private readonly seededFile: string;
  private readonly tabsDir: string;
  private songs: Song[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.dbFile = path.join(root, 'songs.json');
    this.seededFile = path.join(root, 'seeded.json');
    this.tabsDir = path.join(root, 'tabs');
  }

  /**
   * `seed` is a demo folder on disk, or an in-memory source. Bundled songs are added on first run,
   * and songs added to the bundle in a later version are added to existing libraries too. A song
   * the user deleted is never added again: seeded.json remembers what was seeded.
   */
  async init(seed?: string | SeedSource): Promise<void> {
    await fs.mkdir(this.tabsDir, { recursive: true });
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

  tabPath(song: Song): string {
    return path.join(this.tabsDir, song.tabFile);
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

    let format: TabFormat = detectTabFormat(sourceName, bytes);
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
      youtubeId: parseYouTubeId(input.youtube),
      tabFile,
      tabFormat: format,
      tabSource: input.tabUrl ?? input.tabFile?.name ?? 'pasted text',
      syncPoints: [],
      defaultTrack: 0,
      tags: input.tags ?? [],
      favorite: false,
      archivedAt: null,
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
    if (patch.youtube !== undefined) song.youtubeId = parseYouTubeId(patch.youtube);
    if (patch.youtubeId !== undefined) song.youtubeId = parseYouTubeId(patch.youtubeId);
    if (patch.defaultTrack !== undefined) song.defaultTrack = Math.max(0, Math.floor(Number(patch.defaultTrack)) || 0);
    if (patch.tags !== undefined) song.tags = patch.tags.map(String);
    if (patch.favorite !== undefined) song.favorite = patch.favorite === true;
    if (patch.archived !== undefined) {
      if (patch.archived !== true) song.archivedAt = null;
      else if (!song.archivedAt) song.archivedAt = new Date().toISOString();
    }
    if (patch.syncPoints !== undefined) {
      song.syncPoints = normalizeSyncPoints(
        patch.syncPoints.map((p) => ({ bar: Math.max(0, Math.floor(Number(p.bar))), time: Math.max(0, Number(p.time)) })),
      );
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
  return { ...song, favorite: song.favorite === true, archivedAt: song.archivedAt ?? null };
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

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

function extFor(format: TabFormat, sourceName: string): string {
  const ext = (sourceName.split('?')[0].split('.').pop() ?? '').toLowerCase();
  if (format === 'gp') return ['gp3', 'gp4', 'gp5', 'gpx', 'gp'].includes(ext) ? ext : 'gp';
  if (format === 'musicxml') return ext === 'mxl' ? 'mxl' : 'musicxml';
  return 'atex';
}
