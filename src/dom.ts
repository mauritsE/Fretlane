type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | null | undefined | false;

type TagName<S extends string> = S extends `${infer T}.${string}` ? TagName<T> : S extends `${infer T}#${string}` ? T : S;
type ElementFor<S extends string> = TagName<S> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[TagName<S>] : HTMLElement;

/** Tiny hyperscript helper: h('button.primary', { onclick }, 'Play'). */
export function h<S extends string>(tag: S, attrs: Attrs = {}, ...children: (Child | Child[])[]): ElementFor<S> {
  const [name, ...classes] = tag.split('.');
  const [tagName, id] = name.split('#');
  const el = document.createElement(tagName) as ElementFor<S>;
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div#toast');
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), kind === 'error' ? 6000 : 2500);
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
