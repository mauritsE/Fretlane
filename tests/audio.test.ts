import { describe, expect, it } from 'vitest';
import { AUDIO_ACCEPT, audioFormatOfFile, detectAudioFormat, parseByteRange } from '../shared/audio.ts';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('detectAudioFormat', () => {
  it('recognises each supported format by its signature', () => {
    expect(detectAudioFormat(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))).toBe('wav');
    expect(detectAudioFormat(bytes('OggS', [0, 2, 0, 0, 0, 0, 0, 0]))).toBe('ogg');
    expect(detectAudioFormat(bytes('fLaC', [0, 0, 0, 34, 0, 0, 0, 0]))).toBe('flac');
    expect(detectAudioFormat(bytes([0, 0, 0, 32], 'ftypM4A ', [0, 0, 0, 0]))).toBe('m4a');
    expect(detectAudioFormat(bytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('webm');
    expect(detectAudioFormat(bytes('ID3', [4, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('mp3');
  });

  it('tells a bare MP3 frame from an ADTS (AAC) frame by the layer bits', () => {
    expect(detectAudioFormat(bytes([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('mp3'); // MPEG-1 layer III
    expect(detectAudioFormat(bytes([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('aac'); // ADTS
  });

  it('rejects files that are not audio, whatever their name', () => {
    expect(detectAudioFormat(bytes('%PDF-1.7 abc'))).toBeNull();
    expect(detectAudioFormat(bytes('RIFF', [0, 0, 0, 0], 'AVI '))).toBeNull();
    expect(detectAudioFormat(new Uint8Array())).toBeNull();
  });
});

describe('audioFormatOfFile', () => {
  it('maps stored file names back to a format', () => {
    expect(audioFormatOfFile('me-song-abc123.mp3')).toBe('mp3');
    expect(audioFormatOfFile('x.WAV')).toBe('wav');
    expect(audioFormatOfFile('x.txt')).toBeNull();
  });

  it('every format key is also an extension, so stored names round-trip', () => {
    for (const f of ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'webm'] as const) expect(audioFormatOfFile(`s.${f}`)).toBe(f);
    expect(AUDIO_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.mp3', '.wav', '.flac', '.m4a']));
  });
});

describe('parseByteRange', () => {
  it('sends the whole file without a (usable) Range header', () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange('bytes=-', 100)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-9', 100)).toBeNull(); // multipart ranges are not supported
    expect(parseByteRange('items=0-5', 100)).toBeNull();
  });

  it('parses open, closed and suffix ranges', () => {
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 });
    expect(parseByteRange('bytes=-300', 100)).toEqual({ start: 0, end: 99 });
  });

  it('flags ranges outside the file', () => {
    expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=20-10', 100)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});
