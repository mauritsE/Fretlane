/**
 * The MCP server end to end: a real MCP client (in-memory transport) calls the tools, which talk to
 * a real Fretlane server on a free port with a temporary library.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startServer } from '../server/app.ts';
import { FretlaneApi, createFretlaneMcp } from '../server/mcpTools.ts';

const beats = (frets: number[], string = 6) => ({ beats: frets.map((f) => ({ duration: 4, notes: [{ string, fret: f }] })) });
const song = { title: 'Ridge', tempo: 100, tracks: [{ instrument: 'guitar' }], parts: [{ track: 1, bars: [beats([0, 3, 5, 3]), beats([0, 3, 5, 7])] }] };

async function setup(premiumIncluded: boolean) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fretlane-mcp-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', libraryDir: dir, premiumIncluded, cloud: { siteUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', apiKey: 'pk' } });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createFretlaneMcp(new FretlaneApi(server.url)).connect(a);
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  return {
    server,
    call,
    client,
    close: async () => {
      await client.close();
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe('MCP server with Premium', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => (env = await setup(true)));
  afterAll(() => env.close());

  it('lists its tools and the writing guide', async () => {
    const { tools } = await env.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_song', 'get_song', 'list_songs', 'write_bars']);
    expect(env.client.getInstructions()).toMatch(/Every bar must add up/);
  });

  it('writes a song, reads it back and adds bars to it', async () => {
    const created = await env.call('create_song', song);
    expect(created.isError).toBe(false);
    expect(created.text).toMatch(/editable in the tab editor/);
    const id = /as song (\S+)\./.exec(created.text)![1];
    expect(created.text).toContain(`${env.server.url}/#/song/${id}`);

    const list = await env.call('list_songs', { query: 'ridge' });
    expect(list.text).toContain(`${id}: "Ridge"`);

    const read = await env.call('get_song', { songId: id, fromBar: 1, toBar: 2 });
    expect(read.text).toMatch(/2 bars\. Tempo: 100 BPM/);
    expect(read.text).toContain('s6f0 1/4');
    expect(read.text).toContain('e |---------|');
    expect(read.text).toContain('E |-0-3-5-3-|-0-3-5-7-|');

    const more = await env.call('write_bars', { songId: id, mode: 'generate', parts: [{ track: 1, bars: [beats([5, 5, 3, 0])] }, { track: 0, instrument: 'bass', name: 'Bass', bars: [beats([0, 0, 3, 3], 4)] }] });
    expect(more.isError).toBe(false);
    expect(more.text).toMatch(/Wrote Guitar and Bass \(new track\) in bars 3–3/);
    const after = await env.call('get_song', { songId: id });
    expect(after.text).toMatch(/3 bars/);
    expect(after.text).toContain('Track 2 "Bass": bass');
  });

  it('sends problems back instead of saving, unless forced', async () => {
    const bad = { ...song, title: 'Short', parts: [{ track: 1, bars: [beats([0, 3, 5])] }] };
    const refused = await env.call('create_song', bad);
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/nothing was saved.*\n- Guitar, bar 1 adds up to 3 quarter notes/);
    expect((await env.call('list_songs', { query: 'short' })).text).toMatch(/No songs match/);
    const forced = await env.call('create_song', { ...bad, force: true });
    expect(forced.isError).toBe(false);
    expect(forced.text).toMatch(/trimmed or filled with rests/);
  });

  it('will not change imported songs in place', async () => {
    const songs = (await (await fetch(`${env.server.url}/api/songs`)).json()) as { id: string }[];
    const imported = await fetch(`${env.server.url}/api/songs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Imported', tabText: '\\title "Imported"\n0.6.4 3.6.4 5.6.4 3.6.4 |' }) });
    const { id } = (await imported.json()) as { id: string };
    expect(songs.some((s) => s.id === id)).toBe(false);
    const r = await env.call('write_bars', { songId: id, mode: 'generate', parts: [{ track: 1, bars: [beats([0, 0, 0, 0])] }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/can't be changed in place.*create_song/);
    expect((await env.call('get_song', { songId: id })).text).toContain('s6f3 1/4');
  });
});

describe('MCP server without Premium', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => (env = await setup(false)));
  afterAll(() => env.close());

  it('still saves new songs, as tabs that play in the player', async () => {
    const created = await env.call('create_song', song);
    expect(created.isError).toBe(false);
    expect(created.text).toMatch(/plays in the player.*needs Fretlane Premium/);
    const id = /as song (\S+)\./.exec(created.text)![1];
    const stored = (await (await fetch(`${env.server.url}/api/songs/${id}`)).json()) as { written?: boolean; tabFormat: string };
    expect(stored.written).toBeFalsy();
    expect(stored.tabFormat).toBe('alphatex');
    expect((await env.call('get_song', { songId: id })).text).toMatch(/2 bars/);
  });

  it('says so when Fretlane is not running', async () => {
    const client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createFretlaneMcp(new FretlaneApi('http://127.0.0.1:9')).connect(a);
    await client.connect(b);
    const r = (await client.callTool({ name: 'list_songs', arguments: {} })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Could not reach Fretlane/);
    await client.close();
  });
});
