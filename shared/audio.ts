/**
 * Local audio files (an MP3 or WAV of your own band, a backing track, a recording you bought) that a
 * tab can play along with instead of a YouTube video or Spotify track.
 */

export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'm4a' | 'aac' | 'webm';

export const AUDIO_FORMATS: Record<AudioFormat, { mime: string; exts: string[] }> = {
  mp3: { mime: 'audio/mpeg', exts: ['mp3'] },
  wav: { mime: 'audio/wav', exts: ['wav', 'wave'] },
  ogg: { mime: 'audio/ogg', exts: ['ogg', 'oga', 'opus'] },
  flac: { mime: 'audio/flac', exts: ['flac'] },
  m4a: { mime: 'audio/mp4', exts: ['m4a', 'mp4'] },
  aac: { mime: 'audio/aac', exts: ['aac'] },
  webm: { mime: 'audio/webm', exts: ['webm'] },
};

/** For `<input type=file accept=…>`. */
export const AUDIO_ACCEPT = Object.values(AUDIO_FORMATS)
  .flatMap((f) => f.exts.map((e) => `.${e}`))
  .join(',');

/** Largest audio file accepted: a long WAV at CD quality is about 10 MB per minute. */
export const MAX_AUDIO_BYTES = 300 * 1024 * 1024;

/**
 * Detects the format from the first bytes of the file (at least 12). Returns null for anything that
 * is not a supported audio file, so a renamed PDF can't end up in the library as "song.mp3".
 */
export function detectAudioFormat(head: Uint8Array): AudioFormat | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(4, 8) === 'ftyp') return 'm4a';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  if (ascii(0, 3) === 'ID3') return 'mp3';
  // An MPEG frame sync: 11 set bits. Layer bits 00 mean ADTS (AAC); anything else is an MP3 frame.
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return (head[1] & 0x06) === 0 ? 'aac' : 'mp3';
  return null;
}

export function audioMime(format: AudioFormat): string {
  return AUDIO_FORMATS[format].mime;
}

/** The format a stored file name (`<song id>.<ext>`) was saved as. */
export function audioFormatOfFile(file: string): AudioFormat | null {
  const ext = extOf(file);
  for (const [format, info] of Object.entries(AUDIO_FORMATS) as [AudioFormat, (typeof AUDIO_FORMATS)[AudioFormat]][]) {
    if (info.exts.includes(ext)) return format;
  }
  return null;
}

function extOf(name: string): string {
  return (name.split(/[?#]/)[0].split('.').pop() ?? '').toLowerCase();
}

/**
 * Parses an HTTP `Range: bytes=…` header for a file of `size` bytes. Browsers need range support
 * to seek in an `<audio>` element. Returns the inclusive byte range, null when the header is absent
 * or not a single byte range (the whole file is sent), or 'unsatisfiable' (answer 416).
 */
export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // A suffix range: the last N bytes.
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
