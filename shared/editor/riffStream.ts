/**
 * Streaming the songwriting assistant's answer, so the editor shows Claude writing instead of a
 * spinner for a minute. Every hop (the website or this app's server calling Claude, the app's
 * server, the editor) passes the same events as NDJSON, one JSON object per line:
 *
 * - `text`: the next piece of Claude's JSON answer.
 * - `restart`: the answer starts over. With `problems`, the riff checks sent that many problems
 *   back for a corrected answer; without, a temporary error was retried.
 * - `done`: the final riff (the one to apply; it can differ from the streamed text, e.g. parts left
 *   out because the month's bars ran out), with the plan's usage and a notice.
 * - `error`: what went wrong once the stream had started, with the HTTP status it would have had.
 *
 * Requests ask for the stream with `accept: application/x-ndjson`; without it, or from an older
 * website, the answer is one JSON body as before. The website (mauritsE/fretlane-sync-magic) sends
 * the same events from src/routes/api/public/app/riff-assistant.ts: keep the two in step.
 */
import type { AssistantUsage } from './assistant.ts';

export const RIFF_STREAM_TYPE = 'application/x-ndjson';

export type RiffEvent =
  | { type: 'text'; text: string }
  | { type: 'restart'; problems?: number }
  | { type: 'done'; riff: unknown; via?: 'own-key' | 'cloud'; usage?: AssistantUsage; notice?: string }
  | { type: 'error'; status: number; error: string };

/** Whether a request (its Accept header) or a response (its Content-Type) is the event stream. */
export function isRiffStream(header: string | null | undefined): boolean {
  return (header ?? '').toLowerCase().includes(RIFF_STREAM_TYPE);
}

export function riffEventLine(e: RiffEvent): string {
  return `${JSON.stringify(e)}\n`;
}

/** The events in an NDJSON body, as they arrive. Lines that aren't events are skipped. */
export async function* readRiffEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RiffEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const event = (line: string): RiffEvent | null => {
    if (!line.trim()) return null;
    try {
      const e = JSON.parse(line) as RiffEvent;
      return e && typeof e === 'object' && typeof e.type === 'string' ? e : null;
    } catch {
      return null;
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let nl: number;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const e = event(buffered.slice(0, nl));
        buffered = buffered.slice(nl + 1);
        if (e) yield e;
      }
      if (done) break;
    }
    const last = event(buffered);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses the start of a JSON text as far as it goes: open strings, arrays and objects are closed,
 * and a member or value that has only just begun is left out. `undefined` when nothing parses yet.
 */
export function parsePartialJson(text: string): unknown {
  // Where the text could be cut and closed: after `{`/`[`, or before a `,` between values. Each
  // keeps the closers needed at that point.
  let safe = { at: -1, closers: '' };
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      safe = { at: i + 1, closers: [...stack].reverse().join('') };
    } else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',') safe = { at: i, closers: [...stack].reverse().join('') };
  }
  const closers = [...stack].reverse().join('');
  if (!stack.length && !inString) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
  // First try closing everything where it stands: this keeps a string that is still being written.
  let whole = text;
  if (inString) whole = whole.replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, '') + '"';
  whole = whole.replace(/[\s,:]+$/, '');
  try {
    return JSON.parse(whole + closers) as unknown;
  } catch {
    // E.g. a key without its value yet, or `tru`: go back to the last point between values.
  }
  if (safe.at < 0) return undefined;
  try {
    return JSON.parse(text.slice(0, safe.at) + safe.closers) as unknown;
  } catch {
    return undefined;
  }
}

/** How far Claude has got with a riff: a question instead of one, the explanation so far, and each part's bars. */
export interface RiffProgress {
  question: string;
  explanation: string;
  parts: { name: string; instrument: string; bars: number }[];
}

export function riffProgress(text: string): RiffProgress {
  const raw = parsePartialJson(text);
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const parts = Array.isArray(o['parts']) ? (o['parts'] as unknown[]) : [];
  return {
    question: typeof o['question'] === 'string' ? o['question'] : '',
    explanation: typeof o['explanation'] === 'string' ? o['explanation'] : '',
    parts: parts.map((p) => {
      const q = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      return {
        name: typeof q['name'] === 'string' ? q['name'] : '',
        instrument: typeof q['instrument'] === 'string' ? q['instrument'] : '',
        bars: Array.isArray(q['bars']) ? q['bars'].length : 0,
      };
    }),
  };
}

/** One line per part for the editor, e.g. "Bass: bar 2 of 4". */
export function progressLines(p: RiffProgress, bars: number): string[] {
  return p.parts.map((part, i) => {
    const name = part.name || (part.instrument ? part.instrument[0].toUpperCase() + part.instrument.slice(1) : `Part ${i + 1}`);
    if (!part.bars) return `${name}: starting`;
    return `${name}: bar ${Math.min(part.bars, bars)} of ${bars}`;
  });
}
