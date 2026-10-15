import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SONGBOOK } from '../songbook/songs.ts';
import {
  dueState, hashtags, inSeason, nextSlot, onScreenText, pendingPlatforms, pickShorts, postId, releaseCopy,
  releaseHighlights, releaseSlot, shortCopy, slotsBetween, songTracks, tourTracks, validatePost, zonedToUtc, type QueuedPost,
} from '../marketing/machine/plan.ts';

describe('posting slots', () => {
  it('converts Amsterdam wall-clock time to UTC on both sides of the DST switch', () => {
    expect(zonedToUtc(2026, 10, 20, 18, 30, 'Europe/Amsterdam').toISOString()).toBe('2026-10-20T16:30:00.000Z'); // CEST
    expect(zonedToUtc(2026, 10, 27, 18, 30, 'Europe/Amsterdam').toISOString()).toBe('2026-10-27T17:30:00.000Z'); // CET
  });

  it('lists Tuesday and Friday evenings in a week', () => {
    const slots = slotsBetween(new Date('2026-10-16T09:00:00Z'), 7).map((d) => d.toISOString());
    expect(slots).toEqual(['2026-10-16T16:30:00.000Z', '2026-10-20T16:30:00.000Z']);
    // Two weeks from a Saturday: Tue, Fri, Tue, Fri (the clocks go back on 25 October).
    expect(slotsBetween(new Date('2026-10-17T00:00:00Z'), 14).map((d) => d.toISOString())).toEqual([
      '2026-10-20T16:30:00.000Z', '2026-10-23T16:30:00.000Z', '2026-10-27T17:30:00.000Z', '2026-10-30T17:30:00.000Z',
    ]);
  });

  it('puts release posts on the next day at 12:30 Amsterdam time', () => {
    expect(releaseSlot(new Date('2026-10-24T21:00:00Z')).toISOString()).toBe('2026-10-25T11:30:00.000Z'); // DST ends that night
    expect(releaseSlot(new Date('2026-10-20T23:30:00Z')).toISOString()).toBe('2026-10-22T10:30:00.000Z'); // already the 21st locally
  });

  it('nextSlot skips a slot that has just passed', () => {
    expect(nextSlot(new Date('2026-10-20T16:31:00Z')).toISOString()).toBe('2026-10-23T16:30:00.000Z');
  });
});

describe('picking songs', () => {
  const slots = slotsBetween(new Date('2026-10-17T00:00:00Z'), 44); // 13 slots, all before December

  it('rotates formats and does not repeat a song until the songbook is used up', () => {
    const picks = pickShorts(SONGBOOK, [], slots);
    expect(picks.map((p) => p.format).slice(0, 6)).toEqual(['play-along', 'half-speed', 'track-tour', 'play-along', 'half-speed', 'track-tour']);
    const ids = picks.map((p) => p.song.id);
    const eligible = SONGBOOK.filter((s) => !s.tags.includes('holiday')).length;
    expect(new Set(ids.slice(0, eligible)).size).toBe(Math.min(eligible, ids.length));
  });

  it('never gives a solo piece the track tour, and keeps Christmas songs for December', () => {
    for (const p of pickShorts(SONGBOOK, [], slots)) {
      if (p.format === 'track-tour') expect(p.song.solo).toBeFalsy();
      expect(p.song.tags).not.toContain('holiday');
    }
    expect(inSeason({ tags: ['holiday'] }, new Date('2026-12-04T17:00:00Z'))).toBe(true);
  });

  it('continues from the history: least recently posted song first, next format', () => {
    const history = SONGBOOK.filter((s) => s.id !== 'drunken-sailor' && !s.tags.includes('holiday'))
      .map((s, i) => ({ songId: s.id, format: 'play-along' as const, at: `2026-0${1 + (i % 9)}-01T00:00:00Z` }));
    history.push({ songId: 'ode-to-joy', format: 'play-along', at: '2026-10-01T00:00:00Z' });
    const [first] = pickShorts(SONGBOOK, history, slots.slice(0, 1));
    expect(first.song.id).toBe('drunken-sailor');
    expect(first.format).toBe('half-speed');
  });

  it('is deterministic', () => {
    expect(pickShorts(SONGBOOK, [], slots).map((p) => p.song.id)).toEqual(pickShorts(SONGBOOK, [], slots).map((p) => p.song.id));
  });
});

describe('copy', () => {
  const song = SONGBOOK.find((s) => s.id === 'greensleeves')!;
  const byId = (id: string) => SONGBOOK.find((s) => s.id === id)!;

  it('knows which tracks each songbook tab really has', () => {
    for (const s of SONGBOOK) {
      const tex = readFileSync(new URL(`../demo/${s.id}.atex`, import.meta.url), 'utf8');
      expect(songTracks(s), s.id).toEqual([...tex.matchAll(/\\track "([^"]+)"/g)].map((m) => m[1]));
    }
  });

  it('only promises the parts a song has', () => {
    expect(onScreenText(song, 'play-along').labels).toEqual(['Guitars and bass play with you']);
    expect(onScreenText(byId('drunken-sailor'), 'play-along').labels).toEqual(['Guitars, bass and drums play with you']);
    expect(onScreenText(byId('fur-elise'), 'play-along').labels).toEqual(['Solo guitar, cursor on every note']);
    expect(shortCopy(byId('fur-elise'), 'play-along').instagram!.caption).not.toMatch(/band|bass|drums/);
    expect(tourTracks(song)).toEqual(['Melody', 'Rhythm guitar', 'Bass']);
    expect(onScreenText(byId('drunken-sailor'), 'track-tour').labels).toEqual(['Lead guitar', 'Bass', 'Drums']);
    for (const s of SONGBOOK.filter((x) => !x.drums)) {
      for (const f of ['play-along', 'half-speed', 'track-tour'] as const) expect(JSON.stringify(shortCopy(s, f)), s.id).not.toMatch(/drum/i);
    }
  });

  it('fits every platform limit for every song and format', () => {
    for (const s of SONGBOOK) {
      for (const format of ['play-along', 'half-speed', 'track-tour'] as const) {
        const post: QueuedPost = {
          id: postId(new Date('2026-10-20T16:30:00Z'), `${s.id} ${format}`),
          kind: 'short',
          scheduledAt: '2026-10-20T16:30:00Z',
          song: { id: s.id, title: s.title, format },
          media: { video: { file: 'v.mp4', sha256: 'x', bytes: 1, durationSec: 30, width: 1080, height: 1920 } },
          ...shortCopy(s, format),
        };
        expect(validatePost(post), `${s.id} ${format}`).toEqual([]);
      }
    }
  });

  it('says what the video shows', () => {
    expect(onScreenText(song, 'half-speed').labels).toEqual(['50 % speed', '100 % speed']);
    expect(shortCopy(song, 'play-along').youtube!.title).toBe('Greensleeves: guitar tab play-along with guitars and bass #Shorts');
    expect(shortCopy(song, 'play-along').facebook!.message).toContain('https://github.com/mauritsE/Fretlane/releases/latest');
    expect(hashtags(song)).toEqual(['#guitar', '#guitartabs', '#guitarpractice', '#beginnerguitar', '#folkguitar', '#fingerstyle', '#opensource']);
  });

  it('builds ids from the date and a slug', () => {
    expect(postId(new Date('2026-10-20T16:30:00Z'), 'Für Elise half-speed')).toBe('2026-10-20-fur-elise-half-speed');
  });
});

describe('release posts', () => {
  it('takes the bullets of a "What\'s new" section', () => {
    const notes = '## Download\n- not this\n\n## What\'s new\n- **Audio files**: play along with your own MP3\n- A `waveform` view\n\n## Opening it\n- nope';
    expect(releaseHighlights(notes)).toEqual(['Audio files: play along with your own MP3', 'A waveform view']);
  });

  it('leaves a TODO, which fails validation, when the notes have no such section', () => {
    expect(releaseHighlights('## Download Fretlane\n- a table')).toEqual([]);
    const copy = releaseCopy('v0.4.0', []);
    const post: QueuedPost = {
      id: '2026-10-20-release-v0-4-0', kind: 'release', scheduledAt: '2026-10-20T16:30:00Z',
      media: { image: { file: 'i.png', sha256: 'x', bytes: 1, width: 1080, height: 1350 } }, ...copy,
    };
    expect(validatePost(post).some((e) => e.includes('TODO'))).toBe(true);
    expect(validatePost({ ...post, ...releaseCopy('v0.4.0', ['New thing']) })).toEqual([]);
  });
});

describe('due posts', () => {
  const post = { scheduledAt: '2026-10-20T16:30:00Z', youtube: {}, instagram: {} } as QueuedPost;
  it('is due from its slot until 72 hours later', () => {
    expect(dueState(post, new Date('2026-10-20T16:29:00Z'))).toBe('not-yet');
    expect(dueState(post, new Date('2026-10-20T17:15:00Z'))).toBe('due');
    expect(dueState(post, new Date('2026-10-23T17:00:00Z'))).toBe('too-late');
  });
  it('only posts to switched-on platforms it has not posted to yet', () => {
    expect(pendingPlatforms(post, ['youtube', 'facebook'])).toEqual(['youtube']);
    expect(pendingPlatforms(post, ['youtube', 'instagram'], { youtube: { ok: true, at: '' } })).toEqual(['instagram']);
  });
});
