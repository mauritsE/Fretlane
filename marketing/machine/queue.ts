/** Where queued and posted posts live, and how to read them. Shared by draft.ts and post.ts. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
/** Approved (merged) posts waiting for their time: one JSON file per post. */
export const QUEUE = path.join(ROOT, 'marketing/queue');
/** Posts that went out, with the id and URL per platform. */
export const POSTED = path.join(ROOT, 'marketing/posted');
/** The pre-release whose assets hold the videos and images (public URLs, not in git). */
export const MEDIA_TAG = 'marketing-media';
export const REPO = process.env.GITHUB_REPOSITORY ?? 'mauritsE/Fretlane';

export function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T);
}
