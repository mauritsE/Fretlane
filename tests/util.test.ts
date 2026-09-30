import { describe, expect, it } from 'vitest';
import { detectTabFormat, looksLikeAsciiTab, parseYouTubeId, slugify } from '../shared/util.ts';

const ID = 'dQw4w9WgXcQ';
const enc = (s: string) => new TextEncoder().encode(s);

describe('parseYouTubeId', () => {
  it.each([
    [ID, ID],
    ['  ' + ID + '  ', ID],
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://youtu.be/${ID}?t=42`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
    [`https://music.youtube.com/watch?v=${ID}`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
    [`https://www.youtube.com/watch?v=${ID}&t=42s`, ID],
    [`https://www.youtube.com/watch?feature=share&v=${ID}&list=PL123`, ID],
    [`https://www.youtube.com/embed/${ID}?start=10`, ID],
  ])('extracts id from %s', (input, expected) => {
    expect(parseYouTubeId(input)).toBe(expected);
  });

  it('accepts ids containing - and _', () => {
    expect(parseYouTubeId('a-b_c-d_e-f')).toBe('a-b_c-d_e-f');
  });

  it.each([[''], ['   '], ['not a url'], ['https://example.com/watch?v=' + ID], ['https://www.youtube.com/'], ['https://www.youtube.com/watch?v=short'], ['tooshort'], ['this-is-way-too-long-to-be-an-id']])(
    'returns empty string for invalid input %j',
    (input) => {
      expect(parseYouTubeId(input)).toBe('');
    },
  );

  it('handles null and undefined', () => {
    expect(parseYouTubeId(null)).toBe('');
    expect(parseYouTubeId(undefined)).toBe('');
  });
});

const ASCII = ['e|--0--3--|', 'B|--1--0--|', 'G|--0--0--|', 'D|--2--0--|', 'A|--3--2--|', 'E|-----3--|'].join('\n');

describe('detectTabFormat', () => {
  it.each([
    ['a.gp', 'gp'],
    ['a.GP5', 'gp'],
    ['a.gp3', 'gp'],
    ['a.gp4', 'gp'],
    ['a.gpx', 'gp'],
    ['a.gp7', 'gp'],
    ['a.xml', 'musicxml'],
    ['a.musicxml', 'musicxml'],
    ['a.mxl', 'musicxml'],
    ['a.tex', 'alphatex'],
    ['a.alphatex', 'alphatex'],
    ['a.atex', 'alphatex'],
    ['https://x.com/file.gp5?dl=1', 'gp'],
  ])('detects %s by extension as %s', (name, fmt) => {
    // Contents deliberately contradict the extension.
    expect(detectTabFormat(name, enc(ASCII))).toBe(fmt);
  });

  it('detects GP3-5 by FICHIER GUITAR PRO header', () => {
    const bytes = new Uint8Array([24, ...enc('FICHIER GUITAR PRO v5.10'), 0, 0, 0]);
    expect(detectTabFormat('upload', bytes)).toBe('gp');
  });

  it('detects GPX by BCFZ/BCFS header', () => {
    expect(detectTabFormat('upload', enc('BCFZ....'))).toBe('gp');
    expect(detectTabFormat('upload', enc('BCFS....'))).toBe('gp');
  });

  it('detects zip (PK) as gp, or musicxml when named .mxl', () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
    expect(detectTabFormat('upload', zip)).toBe('gp');
    expect(detectTabFormat('upload.zip', zip)).toBe('gp');
    expect(detectTabFormat('upload.mxl', zip)).toBe('musicxml');
  });

  it('detects XML text', () => {
    expect(detectTabFormat('upload', enc('<?xml version="1.0"?><score-partwise/>'))).toBe('musicxml');
    expect(detectTabFormat('upload', enc('  \n<score-partwise version="3.1"></score-partwise>'))).toBe('musicxml');
    expect(detectTabFormat('upload', enc('<score-timewise></score-timewise>'))).toBe('musicxml');
  });

  it('detects ASCII tab text', () => {
    expect(detectTabFormat('pasted.txt', enc(ASCII))).toBe('ascii');
    expect(detectTabFormat('noextension', enc('Song title\n\n' + ASCII))).toBe('ascii');
  });

  it('falls back to alphatex', () => {
    expect(detectTabFormat('upload', enc('\\title "x"\n.\n:4 0.1 1.1'))).toBe('alphatex');
    expect(detectTabFormat('upload', new Uint8Array())).toBe('alphatex');
  });
});

describe('looksLikeAsciiTab', () => {
  it('accepts 6 line staff', () => {
    expect(looksLikeAsciiTab(ASCII)).toBe(true);
  });
  it('accepts CRLF line endings', () => {
    expect(looksLikeAsciiTab(ASCII.replace(/\n/g, '\r\n'))).toBe(true);
  });
  it('accepts 4 string bass', () => {
    expect(looksLikeAsciiTab(['G|-----0-----|', 'D|--0-----2--|', 'A|-3-----0---|', 'E|-------3---|'].join('\n'))).toBe(true);
  });
  it('rejects fewer than 4 consecutive lines', () => {
    expect(looksLikeAsciiTab(ASCII.split('\n').slice(0, 3).join('\n'))).toBe(false);
  });
  it('rejects interrupted runs', () => {
    const lines = ASCII.split('\n');
    lines.splice(3, 0, 'some text between');
    expect(looksLikeAsciiTab(lines.join('\n'))).toBe(false);
  });
  it('rejects plain prose and alphaTex', () => {
    expect(looksLikeAsciiTab('Hello world\nthis is a song\nabout nothing')).toBe(false);
    expect(looksLikeAsciiTab('\\title "x"\n.\n:4 0.1 1.1 2.1 3.1')).toBe(false);
    expect(looksLikeAsciiTab('')).toBe(false);
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('strips diacritics', () => {
    expect(slugify('Café Déjà Vu')).toBe('cafe-deja-vu');
  });
  it('collapses punctuation and trims hyphens', () => {
    expect(slugify('  --Foo!!  &&  Bar??-- ')).toBe('foo-bar');
  });
  it('returns empty for symbols only', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });
  it('truncates to 60 chars', () => {
    expect(slugify('a'.repeat(100))).toHaveLength(60);
  });
  it('keeps digits', () => {
    expect(slugify('Song 2 (1997)')).toBe('song-2-1997');
  });
});
