import { HttpError } from './library.ts';

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
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) URLs are supported');

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'Songstarr/0.1 (+local tab player)' },
    });
  } catch (err) {
    throw new HttpError(502, `Could not download tab: ${(err as Error).message}`);
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
