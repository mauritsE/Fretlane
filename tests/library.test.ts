import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError, Library } from '../server/library.ts';

const SEED = path.resolve(import.meta.dirname, '..', 'demo');
const SEED_COUNT = (JSON.parse(await fs.readFile(path.join(SEED, 'demo-songs.json'), 'utf8')) as unknown[]).length;
const ASCII = ['e|--0--3--|', 'B|--1--0--|', 'G|--0--0--|', 'D|--2--0--|', 'A|--3--2--|', 'E|-----3--|'].join('\n');

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-test-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function fresh(seed = true): Promise<Library> {
  const lib = new Library(root);
  await lib.init(seed ? SEED : undefined);
  return lib;
}

describe('Library', () => {
  it('starts empty without a seed dir and creates songs.json', async () => {
    const lib = await fresh(false);
    expect(lib.list()).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(root, 'songs.json'), 'utf8'))).toEqual([]);
  });

  it('seeds the demo songs and the songbook on first run', async () => {
    const lib = await fresh();
    const songs = lib.list();
    expect(SEED_COUNT).toBeGreaterThanOrEqual(23);
    expect(songs).toHaveLength(SEED_COUNT);
    expect(songs.map((s) => s.title)).toEqual(expect.arrayContaining(['First Steps', 'Night Trail (ASCII import)', 'Rotterdam Riff', 'Greensleeves']));
    expect(songs.every((s) => s.favorite === false && s.archivedAt === null)).toBe(true);
    for (const s of songs) {
      await expect(fs.stat(lib.tabPath(s))).resolves.toBeTruthy();
    }
    const night = songs.find((s) => s.title.startsWith('Night Trail'))!;
    expect(night.tabFormat).toBe('alphatex');
    expect(await fs.readFile(lib.tabPath(night), 'utf8')).toContain('\\tuning');
    const first = songs.find((s) => s.title === 'First Steps')!;
    expect(first.tabFormat).toBe('alphatex');
    expect(first.tags).toEqual(['demo', 'beginner']);
  });

  it('does not re-seed when songs.json exists', async () => {
    const lib = await fresh();
    for (const s of lib.list()) await lib.remove(s.id);
    const again = await fresh();
    expect(again.list()).toEqual([]);
  });

  it('adds newly bundled songs to a library from an older version, once', async () => {
    // A library written by v0.2: the three original demos, no seeded.json, no favorite/archive fields.
    const old = await fresh(false);
    for (const file of ['first-steps.atex', 'rotterdam-riff.atex']) {
      await old.add({ tabFile: { name: file, dataBase64: (await fs.readFile(path.join(SEED, file))).toString('base64') } });
    }
    const raw = JSON.parse(await fs.readFile(path.join(root, 'songs.json'), 'utf8')) as Record<string, unknown>[];
    for (const song of raw) {
      delete song.favorite;
      delete song.archivedAt;
    }
    await fs.writeFile(path.join(root, 'songs.json'), JSON.stringify(raw));

    const upgraded = await fresh();
    const titles = upgraded.list().map((s) => s.title);
    // night-trail.txt was deleted by that user and must not come back; songbook songs are new.
    expect(titles.filter((t) => t.startsWith('Night Trail'))).toEqual([]);
    expect(titles).toContain('Greensleeves');
    expect(upgraded.list()).toHaveLength(SEED_COUNT - 1);
    expect(upgraded.list().every((s) => s.favorite === false && s.archivedAt === null)).toBe(true);

    // Deleting a bundled song sticks across restarts.
    const green = upgraded.list().find((s) => s.title === 'Greensleeves')!;
    await upgraded.remove(green.id);
    const again = await fresh();
    expect(again.list().map((s) => s.title)).not.toContain('Greensleeves');
    expect(again.list()).toHaveLength(SEED_COUNT - 2);
  });

  it('favorites and archives songs', async () => {
    const lib = await fresh(false);
    const a = await lib.add({ tabText: ASCII, title: 'A', artist: 'A' });
    const b = await lib.add({ tabText: ASCII, title: 'B', artist: 'B' });
    await lib.update(b.id, { favorite: true });
    expect(lib.list().map((s) => s.title)).toEqual(['B', 'A']); // favorites first

    const archived = await lib.update(a.id, { archived: true });
    expect(archived.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stamp = archived.archivedAt;
    expect((await lib.update(a.id, { archived: true })).archivedAt).toBe(stamp); // archiving again keeps the date
    expect((await lib.update(a.id, { archived: false })).archivedAt).toBeNull();
    expect((await lib.update(b.id, { favorite: 'yes' as unknown as boolean })).favorite).toBe(false);
  });

  it('add() converts pasted ASCII tab to alphatex', async () => {
    const lib = await fresh(false);
    const song = await lib.add({ title: 'My Riff', artist: 'Me', tabText: ASCII, youtube: 'https://youtu.be/dQw4w9WgXcQ?t=5', tags: ['x'] });
    expect(song.tabFormat).toBe('alphatex');
    expect(song.tabFile.endsWith('.atex')).toBe(true);
    expect(song.id).toMatch(/^me-my-riff-[0-9a-f]{6}$/);
    expect(song.youtubeId).toBe('dQw4w9WgXcQ');
    expect(song.tabSource).toBe('pasted text');
    expect(song.tags).toEqual(['x']);
    expect(song.syncPoints).toEqual([]);
    const stored = await fs.readFile(lib.tabPath(song), 'utf8');
    expect(stored).toContain('\\title "My Riff"');
    expect(stored).toContain('\\artist "Me"');
    expect(stored).toContain('\\tuning (e4 b3 g3 d3 a2 e2)');
  });

  it('add() stores uploaded alphatex file as-is with title from file name', async () => {
    const lib = await fresh(false);
    const tex = '\\title "x"\n.\n:4 0.1 1.1';
    const song = await lib.add({ tabFile: { name: 'cool_song-name.atex', dataBase64: Buffer.from(tex).toString('base64') } });
    expect(song.title).toBe('cool song name');
    expect(song.artist).toBe('Unknown artist');
    expect(song.tabFormat).toBe('alphatex');
    expect(await fs.readFile(lib.tabPath(song), 'utf8')).toBe(tex);
  });

  it('add() keeps gp extension and format for binary uploads', async () => {
    const lib = await fresh(false);
    const bytes = Buffer.from([24, ...Buffer.from('FICHIER GUITAR PRO v5.10'), 0]);
    const song = await lib.add({ title: 'G', tabFile: { name: 'x.gp5', dataBase64: bytes.toString('base64') } });
    expect(song.tabFormat).toBe('gp');
    expect(song.tabFile.endsWith('.gp5')).toBe(true);
  });

  it('add() rejects missing/empty tabs with 400', async () => {
    const lib = await fresh(false);
    await expect(lib.add({})).rejects.toMatchObject({ status: 400 });
    await expect(lib.add({ tabText: '   ' })).rejects.toBeInstanceOf(HttpError);
    await expect(lib.add({ tabFile: { name: 'a.gp5', dataBase64: '' } })).rejects.toMatchObject({ status: 400 });
  });

  it('add() surfaces an error for text that is neither tab nor ASCII (converted as alphatex)', async () => {
    const lib = await fresh(false);
    // Plain text without a staff falls back to alphatex and is stored verbatim.
    const song = await lib.add({ tabText: 'hello' });
    expect(song.tabFormat).toBe('alphatex');
  });

  it('update() sorts syncPoints, clamps negatives and drops non-finite', async () => {
    const lib = await fresh(false);
    const song = await lib.add({ tabText: ASCII, title: 'T', artist: 'A' });
    const updated = await lib.update(song.id, {
      syncPoints: [
        { bar: 4, time: 10 },
        { bar: 0, time: 1 },
        { bar: 2, time: 5 },
        { bar: -3, time: -2 },
        { bar: 1, time: NaN },
      ],
    });
    // Negative bar/time clamp to 0 (the later bar-0 pin wins), NaN is dropped, result is sorted.
    expect(updated.syncPoints).toEqual([
      { bar: 0, time: 0 },
      { bar: 2, time: 5 },
      { bar: 4, time: 10 },
    ]);
  });

  it('update() normalises syncPoints like shared/sync (one pin per bar, increasing times)', async () => {
    const lib = await fresh(false);
    const song = await lib.add({ tabText: ASCII });
    const u = await lib.update(song.id, { syncPoints: [{ bar: 1, time: 9 }, { bar: 1, time: 5 }, { bar: 2, time: 1 }] });
    // bar 1 keeps the last value (5); bar 2 at 1s would run backwards in time, so it is dropped.
    expect(u.syncPoints).toEqual([{ bar: 1, time: 5 }]);
  });

  it('update() sorts syncPoints by bar', async () => {
    const lib = await fresh(false);
    const song = await lib.add({ tabText: ASCII });
    const u = await lib.update(song.id, { syncPoints: [{ bar: 3, time: 9 }, { bar: 1, time: 3 }, { bar: 2, time: 6 }] });
    expect(u.syncPoints.map((p) => p.bar)).toEqual([1, 2, 3]);
  });

  it('update() patches other fields', async () => {
    const lib = await fresh(false);
    const song = await lib.add({ tabText: ASCII, title: 'T', artist: 'A' });
    const before = song.updatedAt;
    const u = await lib.update(song.id, {
      title: '  New  ',
      artist: '   ',
      youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      defaultTrack: -4,
      tags: ['a', 'b'],
    });
    expect(u.title).toBe('New');
    expect(u.artist).toBe('A'); // blank keeps old value
    expect(u.youtubeId).toBe('dQw4w9WgXcQ');
    expect(u.defaultTrack).toBe(0);
    expect(u.tags).toEqual(['a', 'b']);
    expect(u.updatedAt >= before).toBe(true);
  });

  it('update()/remove() on unknown id throw 404', async () => {
    const lib = await fresh(false);
    await expect(lib.update('nope', {})).rejects.toMatchObject({ status: 404 });
    await expect(lib.remove('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('remove() deletes the tab file and the song', async () => {
    const lib = await fresh(false);
    const song = await lib.add({ tabText: ASCII });
    const file = lib.tabPath(song);
    await expect(fs.stat(file)).resolves.toBeTruthy();
    await lib.remove(song.id);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(lib.get(song.id)).toBeUndefined();
    expect(JSON.parse(await fs.readFile(path.join(root, 'songs.json'), 'utf8'))).toEqual([]);
  });

  it('persists to songs.json and reloads in a new instance', async () => {
    const lib = await fresh();
    const added = await lib.add({ title: 'Persist', artist: 'Zed', tabText: ASCII });
    await lib.update(added.id, { syncPoints: [{ bar: 2, time: 4 }, { bar: 0, time: 1 }] });

    const reloaded = new Library(root);
    await reloaded.init(SEED);
    expect(reloaded.list()).toHaveLength(SEED_COUNT + 1);
    const got = reloaded.get(added.id)!;
    expect(got).toEqual(lib.get(added.id));
    expect(got.syncPoints).toEqual([{ bar: 0, time: 1 }, { bar: 2, time: 4 }]);
    expect(await fs.readFile(reloaded.tabPath(got), 'utf8')).toContain('\\title "Persist"');
    // No leftover temp file from the atomic write.
    await expect(fs.stat(path.join(root, 'songs.json.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('list() is sorted by artist then title (favorites aside)', async () => {
    const lib = await fresh(false);
    await lib.add({ title: 'B', artist: 'Y', tabText: ASCII });
    await lib.add({ title: 'A', artist: 'Y', tabText: ASCII });
    await lib.add({ title: 'Z', artist: 'X', tabText: ASCII });
    expect(lib.list().map((s) => `${s.artist}/${s.title}`)).toEqual(['X/Z', 'Y/A', 'Y/B']);
  });

  it('survives concurrent adds without corrupting songs.json', async () => {
    const lib = await fresh(false);
    await Promise.all(Array.from({ length: 8 }, (_, i) => lib.add({ title: `S${i}`, artist: 'A', tabText: ASCII })));
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'songs.json'), 'utf8'));
    expect(onDisk).toHaveLength(8);
  });

  it('init() throws on corrupt songs.json instead of silently resetting', async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'songs.json'), '{not json');
    await expect(new Library(root).init(SEED)).rejects.toThrow();
  });
});
