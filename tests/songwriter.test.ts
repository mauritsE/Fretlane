import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { barStatus, newSongDoc, TUNING_PRESETS } from '../shared/editor/doc.ts';
import { docToTex } from '../shared/editor/tex.ts';
import { scoreToDoc } from '../shared/editor/fromScore.ts';
import { buildSong, trackFromSpec, writeBars, type ToolBeat } from '../shared/editor/songwriter.ts';

const q = (string: number, fret: number): ToolBeat => ({ duration: 4, notes: [{ string, fret }] });
const riffBar = { beats: [q(6, 0), q(6, 3), q(6, 5), q(5, 2)] };
const groove = { beats: Array.from({ length: 4 }, (_, i): ToolBeat => ({ duration: 4, notes: [{ drum: i % 2 ? 'snare' : 'kick' }, { drum: 'closedHiHat' }] })) };

function parse(tex: string) {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

describe('trackFromSpec', () => {
  it('reads tunings as notes or preset ids, and defaults to standard', () => {
    expect(trackFromSpec({ instrument: 'guitar' }, 0).tuning).toEqual([64, 59, 55, 50, 45, 40]);
    expect(trackFromSpec({ instrument: 'guitar', tuning: 'D A D G B E' }, 0).tuning).toEqual(TUNING_PRESETS.find((p) => p.id === 'guitar-drop-d')!.tuning);
    expect(trackFromSpec({ instrument: 'bass', tuning: 'bass-5-standard' }, 0).tuning).toHaveLength(5);
    expect(trackFromSpec({ instrument: 'guitar', sound: 'distortionguitar' }, 0).sound).toBe('distortionguitar');
    expect(trackFromSpec({ instrument: 'guitar', sound: 'kazoo' }, 0).sound).toBe('electricguitarclean');
    expect(() => trackFromSpec({ instrument: 'guitar', tuning: 'X Y Z' }, 1)).toThrow(/Track 2: unknown tuning/);
  });
});

describe('buildSong', () => {
  it('builds a multi-track song that round-trips through alphaTab', () => {
    const { doc, problems, fixes } = buildSong({
      title: 'Trail',
      tempo: 132,
      tracks: [{ name: 'Rhythm', instrument: 'guitar', tuning: 'D A D G B E', sound: 'distortionguitar' }, { instrument: 'bass' }, { instrument: 'drums' }],
      sections: [{ bar: 1, name: 'Intro' }, { bar: 2, name: 'Verse' }],
      parts: [
        { track: 1, bars: [riffBar, riffBar] },
        { track: 2, bars: [{ beats: [{ duration: 1, notes: [{ string: 4, fret: 0 }] }] }, { beats: [{ duration: 1, notes: [{ string: 4, fret: 3 }] }] }] },
        { track: 3, bars: [groove, groove] },
      ],
    });
    expect(problems).toEqual([]);
    expect(fixes).toEqual([]);
    expect(doc.bars).toHaveLength(2);
    expect(doc.bars.map((b) => b.section)).toEqual(['Intro', 'Verse']);
    const back = scoreToDoc(parse(docToTex(doc)));
    expect(back.dropped).toEqual([]);
    expect(back.doc.tracks.map((t) => t.kind)).toEqual(['guitar', 'bass', 'drums']);
    expect(back.doc.bars[1].tracks[0]).toEqual(doc.bars[1].tracks[0]);
    expect(back.doc.bars[0].tracks[2][0].notes).toHaveLength(2);
  });

  it('writes more than four tracks (the riff assistant fits four parts at a time)', () => {
    const tracks = Array.from({ length: 6 }, () => ({ instrument: 'guitar' as const }));
    const { doc } = buildSong({ title: 'Wall', tracks, parts: tracks.map((_, i) => ({ track: i + 1, bars: [riffBar] })) });
    expect(doc.tracks).toHaveLength(6);
    for (let t = 0; t < 6; t++) expect(doc.bars[0].tracks[t].filter((b) => b.notes.length)).toHaveLength(4);
  });

  it('reports what a guitarist would hear as wrong, and still fits the bars', () => {
    const { doc, problems, fixes } = buildSong({
      title: 'Oops',
      tracks: [{ instrument: 'guitar' }],
      parts: [{ track: 1, bars: [{ beats: [q(6, 0), q(6, 3), q(7, 5)] }] }],
    });
    expect(problems.join(' ')).toMatch(/adds up to 3 quarter notes/);
    expect(problems.join(' ')).toMatch(/string 7 doesn't exist/);
    expect(fixes.join(' ')).toMatch(/left out/);
    expect(barStatus(doc, 0, 0).diff).toBe(0);
  });

  it('refuses specs that are not a song', () => {
    expect(() => buildSong({ title: '', tracks: [{ instrument: 'guitar' }], parts: [] })).toThrow(/title/);
    expect(() => buildSong({ title: 'x', tracks: [{ instrument: 'guitar' }], parts: [{ track: 2, bars: [riffBar] }] })).toThrow(/tracks 1 to 1/);
    expect(() => buildSong({ title: 'x', tracks: [{ instrument: 'guitar' }], parts: [{ track: 1, bars: [riffBar] }, { track: 1, bars: [riffBar] }] })).toThrow(/two parts/);
    expect(() => buildSong({ title: 'x', tracks: [{ instrument: 'guitar' }], parts: [{ track: 1, bars: [{ beats: [{ duration: 1 }] }] }] })).toThrow(/no notes/);
  });
});

describe('writeBars', () => {
  const base = () => buildSong({ title: 'Base', tracks: [{ instrument: 'guitar' }], parts: [{ track: 1, bars: [riffBar, riffBar] }] }).doc;

  it('improves bars in place', () => {
    const r = writeBars(base(), { mode: 'improve', fromBar: 2, toBar: 2 }, [{ track: 1, bars: [{ beats: [{ duration: 1, notes: [{ string: 1, fret: 12 }] }] }] }]);
    expect(r.doc.bars).toHaveLength(2);
    expect(r.doc.bars[1].tracks[0]).toEqual([{ duration: 1, notes: [{ string: 1, fret: 12 }] }]);
    expect(r.doc.bars[0].tracks[0]).toEqual(base().bars[0].tracks[0]);
    expect([r.fromBar, r.toBar]).toEqual([2, 2]);
  });

  it('adds bars after the end and a new drum track', () => {
    const r = writeBars(base(), { mode: 'generate' }, [
      { track: 1, bars: [riffBar] },
      { track: 0, instrument: 'drums', name: 'Kit', bars: [groove] },
    ]);
    expect(r.doc.bars).toHaveLength(3);
    expect(r.doc.tracks.map((t) => t.name)).toEqual(['Guitar', 'Kit']);
    expect(r.wrote).toBe('Guitar and Kit (new track)');
    expect(r.fromBar).toBe(3);
  });

  it('checks against the song: tuning, bar lengths and key', () => {
    const r = writeBars(base(), { mode: 'generate' }, [{ track: 1, bars: [{ beats: [q(6, 0)] }] }]);
    expect(r.problems.join(' ')).toMatch(/adds up to 1 quarter notes/);
  });

  it('refuses parts that do not fit the song', () => {
    expect(() => writeBars(base(), { mode: 'improve', fromBar: 3, toBar: 3 }, [{ track: 1, bars: [riffBar] }])).toThrow(/bars 1 to 2/);
    expect(() => writeBars(base(), { mode: 'generate' }, [{ track: 1, instrument: 'bass', bars: [riffBar] }])).toThrow(/is a guitar, not a bass/);
    expect(() => writeBars(base(), { mode: 'generate' }, [{ track: 0, bars: [riffBar] }])).toThrow(/needs an instrument/);
    const uke = newSongDoc({ title: 'u', artist: '', tempo: 100, ts: [4, 4], tracks: [{ name: 'Uke', kind: 'ukulele', sound: 'acousticguitarnylon', tuning: [69, 64, 60, 67] }] });
    expect(() => writeBars(uke, { mode: 'generate' }, [{ track: 1, bars: [riffBar] }])).toThrow(/ukulele/);
  });
});
