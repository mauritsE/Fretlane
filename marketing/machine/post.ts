/**
 * Posts whatever in marketing/queue/ is due. Runs on a schedule in GitHub Actions
 * (.github/workflows/marketing-post.yml), or by hand:
 *
 *   npx tsx marketing/machine/post.ts [--now 2026-10-20T16:35:00Z]
 *
 * Platforms are switched on in channels.json. Phase 1 has no publishers yet, so with every channel
 * off this is a dry run: for each due post it downloads the media from its public URL, checks it
 * is byte for byte the file that was approved (sha256), and prints exactly what each platform
 * would get. A post more than 72 hours past its time is reported and not posted.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { dueState, PLATFORMS, pendingPlatforms, validatePost, type MediaFile, type Platform, type PostedRecord, type QueuedPost } from './plan.ts';
import { POSTED, QUEUE, readJsonDir } from './queue.ts';

const { values } = parseArgs({ options: { now: { type: 'string' } } });
const now = values.now ? new Date(values.now) : new Date();
const channels = JSON.parse(readFileSync(path.join(import.meta.dirname, 'channels.json'), 'utf8')) as Record<Platform, boolean>;
const enabled = PLATFORMS.filter((p) => channels[p]);

const out: string[] = [];
const say = (s = '') => { console.log(s); out.push(s); };

async function checkMedia(m: MediaFile): Promise<string> {
  if (!m.url) return `${m.file}: no public URL (drafted without --upload), Instagram and Facebook could not fetch it`;
  const res = await fetch(m.url);
  if (!res.ok) return `${m.file}: HTTP ${res.status} from ${m.url}`;
  const hash = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
  return hash === m.sha256 ? '' : `${m.file}: the file at its URL is not the approved one (sha256 differs)`;
}

const posted = new Map(readJsonDir<PostedRecord>(POSTED).map((r) => [r.post.id, r]));
const queue = readJsonDir<QueuedPost>(QUEUE).filter((p) => !posted.has(p.id) || pendingPlatforms(p, enabled, posted.get(p.id)!.results).length);
let failed = false;

say(`## Marketing machine, ${now.toISOString()}`);
say(`Channels on: ${enabled.length ? enabled.join(', ') : 'none (dry run)'}`);
say();
for (const p of queue) {
  const state = dueState(p, now);
  if (state === 'not-yet') {
    say(`- ${p.id}: scheduled for ${p.scheduledAt}`);
    continue;
  }
  if (state === 'too-late') {
    say(`- ⚠ ${p.id}: more than 72 h past ${p.scheduledAt}, not posting it. Delete its file or give it a new time.`);
    continue;
  }
  say(`### Due: ${p.id}`);
  const problems = validatePost(p);
  for (const m of Object.values(p.media)) {
    const err = m ? await checkMedia(m) : '';
    if (err) problems.push(err);
  }
  if (problems.length) {
    failed = true;
    say(`❌ Not posting: ${problems.join('; ')}`);
    continue;
  }
  say('Media verified against the approved files.');
  for (const pl of PLATFORMS) {
    const text = p[pl];
    if (!text) continue;
    const media = pl === 'youtube' ? p.media.video : (p.media.video ?? p.media.image);
    if (!enabled.includes(pl)) {
      say(`\n**${pl}** (off, would send):`);
      say('```');
      say(JSON.stringify({ media: media?.url, ...(pl === 'instagram' && p.media.cover ? { cover: p.media.cover.url } : {}), ...text }, null, 2));
      say('```');
      continue;
    }
    // Phase 2 adds the publishers (YouTube Data API, Instagram Graph API, Facebook Pages API).
    failed = true;
    say(`❌ ${pl} is switched on in channels.json, but its publisher is not built yet.`);
  }
}
if (!queue.length) say('The queue is empty.');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out.join('\n')}\n`);
if (failed) process.exit(1);
