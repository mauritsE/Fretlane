import { describe, expect, it } from 'vitest';
import { extractPreText, fetchTab, isPublicAddress } from '../server/fetchTab.ts';

describe('extractPreText', () => {
  it('returns empty string when there is no <pre>', () => {
    expect(extractPreText('<html><body><p>hi</p></body></html>')).toBe('');
  });
  it('extracts and trims a simple pre', () => {
    expect(extractPreText('<pre>\ne|--0--|\n</pre>')).toBe('e|--0--|');
  });
  it('strips nested tags and decodes entities', () => {
    const html = '<html><pre class="tab">e|--<span class="n">3</span>h5--|  &lt;bend&gt; &quot;x&quot; &#39;y&#39; a &amp; b</pre></html>';
    expect(extractPreText(html)).toBe(`e|--3h5--|  <bend> "x" 'y' a & b`);
  });
  it('joins multiple pre blocks with a blank line', () => {
    expect(extractPreText('<PRE>one</PRE><p>x</p><pre id="b">two</pre>')).toBe('one\n\ntwo');
  });
  it('decodes &amp; last so &amp;lt; stays literal &lt;', () => {
    expect(extractPreText('<pre>&amp;lt;</pre>')).toBe('&lt;');
  });
  it('keeps newlines in multi-line content', () => {
    expect(extractPreText('<pre>a\nb\nc</pre>')).toBe('a\nb\nc');
  });
});

describe('isPublicAddress', () => {
  it('accepts internet addresses', () => {
    for (const ip of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it('refuses this computer, the local network, cloud metadata and IPv4-mapped forms', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '0.0.0.0', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:7f00:1', '::ffff:192.168.0.1', 'not-an-ip'])
      expect(isPublicAddress(ip), ip).toBe(false);
  });
});

describe('fetchTab', () => {
  it('refuses loopback and private hosts before connecting', async () => {
    for (const url of ['http://127.0.0.1:5173/api/health', 'http://localhost/x.gp', 'http://[::1]/x', 'http://0x7f000001/x', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.1/tab.txt'])
      await expect(fetchTab(url, 1000), url).rejects.toMatchObject({ status: 400 });
  });
});
