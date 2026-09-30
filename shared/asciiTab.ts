/**
 * Converts plain-text ("ASCII") tabs, as found on most tab websites, into alphaTex so alphaTab can
 * render and play them.
 *
 * Limitation: ASCII tabs have no reliable rhythm information. Every note/chord column becomes an
 * eighth note (configurable), so playback timing is approximate. Use sync points per bar to keep
 * the cursor aligned with the recording.
 */

export interface AsciiConvertOptions {
  title?: string;
  artist?: string;
  tempo?: number;
  /** alphaTex duration for every column event: 4 = quarter, 8 = eighth, 16 = sixteenth. */
  duration?: 4 | 8 | 16;
}

interface TabBlock {
  names: string[];
  lines: string[];
}

const STRING_LINE = /^\s*([A-Ga-g][#b]?)?\s*([|:])(.*)$/;

const DEFAULT_TUNINGS: Record<number, string[]> = {
  4: ['G2', 'D2', 'A1', 'E1'],
  5: ['G2', 'D2', 'A1', 'E1', 'B0'],
  6: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
  7: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2', 'B1'],
};

function isTabLine(line: string): boolean {
  const m = line.match(STRING_LINE);
  if (!m) return false;
  const body = m[3];
  const dashes = (body.match(/-/g) ?? []).length;
  return dashes >= 3 && dashes / Math.max(body.trim().length, 1) > 0.3;
}

export function findTabBlocks(text: string): TabBlock[] {
  const lines = text.replace(/\t/g, '    ').split(/\r?\n/);
  const blocks: TabBlock[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length >= 4 && cur.length <= 7) {
      const names: string[] = [];
      const bodies: string[] = [];
      for (const l of cur) {
        const m = l.match(STRING_LINE)!;
        names.push(m[1] ?? '');
        bodies.push(m[2] + m[3]);
      }
      blocks.push({ names, lines: bodies });
    }
    cur = [];
  };
  for (const l of lines) {
    if (isTabLine(l)) cur.push(l);
    else flush();
  }
  flush();
  return blocks;
}

interface NoteEvent {
  string: number; // 1 = highest
  fret: number | 'x';
  effects: string[];
}

type Token = { kind: 'bar' } | { kind: 'beat'; notes: NoteEvent[] };

/** Scan one block column by column and emit bar lines and beats. */
export function tokenizeBlock(block: TabBlock): Token[] {
  const rows = block.lines;
  const width = Math.max(...rows.map((r) => r.length));
  const tokens: Token[] = [];
  let c = 0;
  while (c < width) {
    const col = rows.map((r) => r[c] ?? '-');
    if (col.every((ch) => ch === '|' || ch === ':' || ch === ' ')) {
      if (col.some((ch) => ch === '|')) tokens.push({ kind: 'bar' });
      c++;
      continue;
    }
    const notes: NoteEvent[] = [];
    let advance = 1;
    rows.forEach((row, i) => {
      const ch = row[c];
      if (ch === undefined) return;
      if (/[0-9]/.test(ch)) {
        let num = ch;
        // Two-digit fret when the next column on this string is also a digit (frets go up to ~24).
        if (/[0-9]/.test(row[c + 1] ?? '') && Number(ch + row[c + 1]) <= 30) {
          num += row[c + 1];
          advance = Math.max(advance, 2);
        }
        const after = row[c + num.length] ?? '';
        notes.push({ string: i + 1, fret: Number(num), effects: effectFor(after) });
      } else if (ch === 'x' || ch === 'X') {
        notes.push({ string: i + 1, fret: 'x', effects: [] });
      }
    });
    if (notes.length) tokens.push({ kind: 'beat', notes });
    c += advance;
  }
  return tokens;
}

function effectFor(ch: string): string[] {
  switch (ch) {
    case 'h':
      return ['h'];
    case 'p':
      return ['h']; // alphaTex uses the same "hammer/pull" legato flag
    case '/':
    case '\\':
      return ['sl'];
    case '~':
    case 'v':
      return ['v'];
    case 'b':
      return ['b (0 4)'];
    default:
      return [];
  }
}

function noteToTex(n: NoteEvent): string {
  const fx = n.effects.length ? `{${n.effects.join(' ')}}` : '';
  return `${n.fret}.${n.string}${fx}`;
}

export function asciiTabToAlphaTex(text: string, opts: AsciiConvertOptions = {}): string {
  const blocks = findTabBlocks(text);
  if (!blocks.length) throw new Error('No ASCII tab staves found (expected 4-7 lines like "e|--0--3--|").');
  const stringCount = blocks[0].lines.length;
  const same = blocks.filter((b) => b.lines.length === stringCount);

  const tuning = resolveTuning(same[0].names, stringCount);
  const duration = opts.duration ?? 8;

  const bars: string[][] = [];
  let bar: string[] = [];
  const closeBar = () => {
    if (bar.length) bars.push(bar);
    bar = [];
  };
  for (const block of same) {
    for (const t of tokenizeBlock(block)) {
      if (t.kind === 'bar') closeBar();
      else if (t.notes.length === 1) bar.push(noteToTex(t.notes[0]));
      else bar.push(`(${t.notes.map(noteToTex).join(' ')})`);
    }
    closeBar();
  }
  if (!bars.length) throw new Error('Tab staves were found but contained no notes.');

  const esc = (s: string) => s.replace(/"/g, "'");
  const head = [
    `\\title "${esc(opts.title || 'Imported ASCII tab')}"`,
    opts.artist ? `\\artist "${esc(opts.artist)}"` : '',
    `\\tempo ${opts.tempo ?? 100}`,
    '.',
    `\\track "${stringCount <= 5 ? 'Bass' : 'Guitar'}"`,
    '\\staff {tabs}',
    `\\tuning (${tuning.join(' ')})`,
    stringCount <= 5 ? '\\instrument electricbassfinger' : '\\instrument distortionguitar',
  ]
    .filter(Boolean)
    .join('\n');
  const body = bars.map((b) => `:${duration} ${b.join(' ')}`).join(' |\n');
  return `${head}\n${body}\n`;
}

const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Use the string names written in the tab (e.g. "D A D G B E") when they are present and valid,
 * assigning octaves by walking downward from the highest string.
 */
export function resolveTuning(names: string[], count: number): string[] {
  const fallback = (DEFAULT_TUNINGS[count] ?? DEFAULT_TUNINGS[6]).map((t) => t.toLowerCase());
  if (names.length !== count || names.some((n) => !n)) return fallback;
  const norm = names.map((n) => {
    const up = n[0].toUpperCase() + n.slice(1);
    if (up.endsWith('b')) {
      const idx = NOTE_ORDER.indexOf(up[0]);
      return NOTE_ORDER[(idx + 11) % 12];
    }
    return up;
  });
  if (norm.some((n) => !NOTE_ORDER.includes(n))) return fallback;

  // Start at the default top string's octave and keep each string below the previous one.
  const topDefault = fallback[0].toUpperCase();
  let octave = Number(topDefault.slice(-1));
  let prevAbs = Infinity;
  const result = norm.map((n, i) => {
    let abs = octave * 12 + NOTE_ORDER.indexOf(n);
    if (i === 0) {
      // Pick the octave closest to the default top string.
      const target = octave * 12 + NOTE_ORDER.indexOf(topDefault.slice(0, -1));
      while (abs - target > 6) abs -= 12;
      while (target - abs > 6) abs += 12;
    } else {
      while (abs >= prevAbs) abs -= 12;
    }
    prevAbs = abs;
    octave = Math.floor(abs / 12);
    return abs < 0 ? '' : `${NOTE_ORDER[abs % 12].toLowerCase()}${Math.floor(abs / 12)}`;
  });
  // Names that cannot descend string by string (e.g. every line labelled "e") are not a real tuning.
  return result.includes('') ? fallback : result;
}
