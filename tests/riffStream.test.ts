import { describe, expect, it } from 'vitest';
import { isRiffStream, parsePartialJson, progressLines, readRiffEvents, riffEventLine, riffProgress, type RiffEvent } from '../shared/editor/riffStream.ts';

const riff = {
  explanation: 'A chugging riff with a "gallop" and a bass line under it.',
  parts: [
    { track: 1, instrument: 'guitar', name: 'Guitar', bars: [{ beats: [{ duration: 8, dotted: false, triplet: false, notes: [{ string: 6, fret: 0, drum: 'none', techniques: ['palmMute'] }] }] }, { beats: [] }] },
    { track: 0, instrument: 'bass', name: 'Bass', bars: [{ beats: [{ duration: 4, dotted: true, triplet: false, notes: [] }] }] },
  ],
};

describe('parsePartialJson', () => {
  it('parses every prefix of an answer without throwing, and the whole answer exactly', () => {
    const text = JSON.stringify(riff, null, 1);
    for (let i = 0; i <= text.length; i++) expect(() => parsePartialJson(text.slice(0, i))).not.toThrow();
    expect(parsePartialJson(text)).toEqual(riff);
  });

  it('keeps a string that is still being written, escapes included', () => {
    expect(parsePartialJson('{"explanation":"A chugging riff with a \\"gal')).toEqual({ explanation: 'A chugging riff with a "gal' });
    expect(parsePartialJson('{"explanation":"Tab\\')).toEqual({ explanation: 'Tab' });
    expect(parsePartialJson('{"explanation":"caf\\u00')).toEqual({ explanation: 'caf' });
  });

  it('leaves out a key or value that has only just begun', () => {
    expect(parsePartialJson('{"explanation":"x","par')).toEqual({ explanation: 'x' });
    expect(parsePartialJson('{"explanation":"x","parts":')).toEqual({ explanation: 'x' });
    expect(parsePartialJson('{"explanation":"x","parts":[{"track":1,"dotted":tru')).toEqual({ explanation: 'x', parts: [{ track: 1 }] });
    expect(parsePartialJson('{"a":[1,2,')).toEqual({ a: [1, 2] });
    expect(parsePartialJson('')).toBeUndefined();
    expect(parsePartialJson('{"expl')).toEqual({});
  });
});

describe('riffProgress', () => {
  it('counts the bars each part has so far', () => {
    const text = JSON.stringify(riff);
    const cut = text.indexOf('"name":"Bass"') + 20;
    const p = riffProgress(text.slice(0, cut));
    expect(p.explanation).toBe(riff.explanation);
    expect(p.parts).toEqual([
      { name: 'Guitar', instrument: 'guitar', bars: 2 },
      { name: 'Bass', instrument: 'bass', bars: 0 },
    ]);
    expect(progressLines(p, 4)).toEqual(['Guitar: bar 2 of 4', 'Bass: starting']);
    expect(riffProgress(text).parts.map((x) => x.bars)).toEqual([2, 1]);
  });

  it('names a part by its instrument until its name arrives, and never counts past the bars asked for', () => {
    expect(progressLines({ explanation: '', parts: [{ name: '', instrument: 'drums', bars: 9 }] }, 8)).toEqual(['Drums: bar 8 of 8']);
    expect(riffProgress('not json').parts).toEqual([]);
  });
});

describe('readRiffEvents', () => {
  it('reads NDJSON events split anywhere across chunks, skipping lines that are not events', async () => {
    const events: RiffEvent[] = [
      { type: 'text', text: '{"explanation":"é\n' },
      { type: 'restart', problems: 1 },
      { type: 'done', riff: { parts: [] } },
    ];
    const bytes = new TextEncoder().encode(events.map(riffEventLine).join('') + 'garbage\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // Three bytes at a time, so lines and the two-byte é are split.
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const got: RiffEvent[] = [];
    for await (const e of readRiffEvents(body)) got.push(e);
    expect(got).toEqual(events);
  });

  it('recognises the stream by its media type', () => {
    expect(isRiffStream('application/x-ndjson; charset=utf-8')).toBe(true);
    expect(isRiffStream('application/x-ndjson, application/json')).toBe(true);
    expect(isRiffStream('application/json')).toBe(false);
    expect(isRiffStream(undefined)).toBe(false);
  });
});
