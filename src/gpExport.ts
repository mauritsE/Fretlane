import * as alphaTab from '@coderline/alphatab';
import type { TabFormat } from '../shared/types.ts';
import { h, toast } from './dom.ts';

/** A file name the OS accepts: no path separators or reserved characters. */
function fileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'song'}.gp`;
}

/**
 * The tab as a Guitar Pro 7 file. A GP7/GP8 file (a zip) is handed over as it is, so nothing it
 * holds is lost; everything else (alphaTex, older GP, MusicXML) goes through alphaTab's exporter.
 */
export function tabToGp(tab: Uint8Array, format: TabFormat): Uint8Array {
  if (format === 'gp' && tab[0] === 0x50 && tab[1] === 0x4b) return tab;
  const settings = new alphaTab.Settings();
  let score: alphaTab.model.Score;
  if (format === 'alphatex') {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(new TextDecoder().decode(tab), settings);
    score = importer.readScore();
  } else {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(tab, settings);
  }
  return scoreToGp(score);
}

export function scoreToGp(score: alphaTab.model.Score): Uint8Array {
  return new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
}

/** Saves the bytes as "<title>.gp" through the browser's (or Electron's) download. */
export async function downloadGp(title: string, make: () => Uint8Array | Promise<Uint8Array>): Promise<void> {
  try {
    const bytes = await make();
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
    const a = h('a', { href: url, download: fileName(title) });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'error');
  }
}
