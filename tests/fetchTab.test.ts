import { describe, expect, it } from 'vitest';
import { extractPreText } from '../server/fetchTab.ts';

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
