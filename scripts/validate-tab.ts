/**
 * Parses tab files with alphaTab in Node and prints a summary. Used to validate demo tabs and
 * importer output without a browser:  npx tsx scripts/validate-tab.ts demo/*.atex demo/*.txt
 */
import { readFileSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';
import { asciiTabToAlphaTex } from '../shared/asciiTab.ts';
import { detectTabFormat } from '../shared/util.ts';

let failed = false;
for (const file of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(file));
  const format = detectTabFormat(file, bytes);
  try {
    const settings = new alphaTab.Settings();
    let score: alphaTab.model.Score;
    if (format === 'ascii' || format === 'alphatex') {
      const tex = format === 'ascii' ? asciiTabToAlphaTex(new TextDecoder().decode(bytes)) : new TextDecoder().decode(bytes);
      const importer = new alphaTab.importer.AlphaTexImporter();
      importer.initFromString(tex, settings);
      score = importer.readScore();
    } else {
      score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    }
    const tracks = score.tracks.map((t) => `${t.name}(${t.staves[0].tuning.length} str${t.staves[0].isPercussion ? ', drums' : ''})`);
    console.log(`OK   ${file} [${format}] "${score.title}" bars=${score.masterBars.length} tempo=${score.tempo} tracks=${tracks.join(', ')}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL ${file} [${format}]: ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
