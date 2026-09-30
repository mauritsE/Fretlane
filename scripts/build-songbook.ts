/**
 * Generates the bundled songbook: songbook/songs.ts -> demo/<id>.atex plus entries in
 * demo/demo-songs.json (the first-run seed). Run after editing a song: npm run build-songbook
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SONGBOOK } from '../songbook/songs.ts';
import { songSpecToAlphaTex } from '../shared/songbook.ts';

const DEMO = new URL('../demo/', import.meta.url).pathname;
const MANIFEST = `${DEMO}demo-songs.json`;

interface Entry {
  file: string;
  title: string;
  artist: string;
  tags: string[];
}

const files = new Set(SONGBOOK.map((s) => `${s.id}.atex`));
const own = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Entry[]).filter((e) => !files.has(e.file));

const generated: Entry[] = SONGBOOK.map((spec) => {
  writeFileSync(`${DEMO}${spec.id}.atex`, songSpecToAlphaTex(spec));
  return { file: `${spec.id}.atex`, title: spec.title, artist: spec.artist, tags: ['songbook', spec.difficulty, ...spec.tags] };
});

writeFileSync(MANIFEST, `${JSON.stringify([...own, ...generated], null, 2)}\n`);
console.log(`Wrote ${generated.length} songbook tabs; the seed now has ${own.length + generated.length} songs.`);
