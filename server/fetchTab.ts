import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { HttpError } from './library.ts';
import { APP_NAME } from '../shared/brand.ts';

/**
 * Downloads a tab file from any http(s) URL on behalf of the browser (which would otherwise be
 * blocked by CORS). Some hosts serve HTML pages that wrap an ASCII tab in <pre>; that text is
 * extracted so the ASCII importer can handle it.
 */
export async function fetchTab(rawUrl: string, maxBytes: number): Promise<{ bytes: Uint8Array; name: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, 'Not a valid URL');
  }

  // Redirects are followed by hand so that every hop is checked for a public address.
  let res: Response | undefined;
  const signal = AbortSignal.timeout(20_000);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) URLs are supported');
    await assertPublicHost(url.hostname);
    try {
      res = await fetch(url, { redirect: 'manual', signal, headers: { 'user-agent': `${APP_NAME}/1 (+local tab player)` } });
    } catch (err) {
      throw new HttpError(502, `Could not download tab: ${(err as Error).message}`);
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) break;
    if (hop >= MAX_REDIRECTS) throw new HttpError(502, 'The tab host redirected too many times');
    url = new URL(location, url);
  }
  if (!res.ok) throw new HttpError(502, `Tab host answered ${res.status} ${res.statusText}`);

  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'Remote tab is larger than 20 MB');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new HttpError(413, 'Remote tab is larger than 20 MB');

  const disposition = res.headers.get('content-disposition') ?? '';
  const dispName = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  let name = decodeURIComponent(dispName ?? url.pathname.split('/').pop() ?? 'tab');

  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) {
    const text = extractPreText(new TextDecoder().decode(buf));
    if (!text) throw new HttpError(422, 'The URL returned a web page without a recognizable tab. Link directly to a .gp/.gp5/.musicxml/.txt file.');
    name = `${name || 'page'}.txt`;
    return { bytes: new TextEncoder().encode(text), name };
  }
  return { bytes: buf, name: name || 'tab' };
}

const MAX_REDIRECTS = 5;

/** Loopback, private, link-local (cloud metadata), CGNAT, multicast and reserved ranges. */
const NOT_PUBLIC = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) NOT_PUBLIC.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) NOT_PUBLIC.addSubnet(net, bits, 'ipv6');

/** True for an address on the internet, false for this computer, the local network and the like. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is refused as a whole: the URL parser writes it in hex.
  if (family === 6 && /^::ffff:/i.test(ip)) return false;
  return !NOT_PUBLIC.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Tab downloads may only go to the internet. Otherwise a link (or a web page that gets the app to
 * import one) could make the server read this computer's or the home network's web services.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const name = hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(name) ? [name] : (await lookup(name, { all: true })).map((a) => a.address);
  } catch (err) {
    throw new HttpError(502, `Could not download tab: ${(err as Error).message}`);
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) {
    throw new HttpError(400, 'Tabs can only be downloaded from the internet, not from this computer or the local network');
  }
}

export function extractPreText(html: string): string {
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => m[1]);
  const text = pres
    .join('\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return text.trim();
}
