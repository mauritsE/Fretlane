import type { PremiumStatus } from '../shared/premium.ts';
import { api } from './api.ts';
import { h, toast } from './dom.ts';

const POLL_MS = 3000;

/**
 * Resolves true when Fretlane Premium is available, after the upsell dialog if needed: from there
 * the user can sign in to Fretlane Cloud or subscribe on the website, and the dialog notices by
 * itself. Resolves false when the dialog is closed without Premium.
 */
export async function ensurePremium(): Promise<boolean> {
  let status: PremiumStatus;
  try {
    status = await api.premium();
  } catch (err) {
    toast((err as Error).message, 'error');
    return false;
  }
  if (status.premium) return true;
  return openPremiumDialog(status);
}

export function openPremiumDialog(first: PremiumStatus): Promise<boolean> {
  return new Promise((resolve) => {
    let unlocked = false;
    let poll: number | undefined;
    const body = h('div.premium-state');
    const dialog = h(
      'dialog.song-dialog.premium-dialog',
      {},
      h(
        'div.cloud-inner',
        {},
        h('h2', {}, '✎ Write your own songs'),
        h('p', {}, 'Fretlane Premium adds a tab editor: type frets with the keyboard, hear every note, and practise what you wrote with the loop, speed and metronome you already know.'),
        h(
          'ul.premium-points',
          {},
          h('li', {}, 'Guitar, bass, drums, ukulele, mandolin and banjo tracks, any tuning'),
          h('li', {}, 'Saves as you type; export to Guitar Pro (.gp) any time'),
          h('li', {}, 'Songs you wrote keep playing in Fretlane, with or without Premium'),
        ),
        body,
        h('div.dialog-actions', {}, h('button', { type: 'button', onclick: () => dialog.close() }, 'Not now')),
      ),
    );
    dialog.addEventListener('close', () => {
      window.clearInterval(poll);
      dialog.remove();
      resolve(unlocked);
    });
    document.body.append(dialog);
    dialog.showModal();

    /** Checks the website again every few seconds after the user went there. */
    function watch(): void {
      window.clearInterval(poll);
      poll = window.setInterval(async () => {
        try {
          const s = await api.premium(true);
          if (s.premium) {
            unlocked = true;
            toast('✎ Fretlane Premium is on. Happy writing!');
            dialog.close();
          } else if (s.reason !== status.reason) {
            void draw(s);
          }
        } catch {
          /* keep waiting */
        }
      }, POLL_MS);
    }

    let status = first;
    async function draw(s: PremiumStatus): Promise<void> {
      status = s;
      const plans = h('a.button.primary', { href: s.pricingUrl, target: '_blank', rel: 'noopener' }, 'See the Fretlane Cloud plan');
      plans.addEventListener('click', watch);
      const recheck = h('button', { type: 'button' }, 'Check again');
      recheck.addEventListener('click', async () => {
        recheck.disabled = true;
        try {
          const next = await api.premium(true);
          if (next.premium) {
            unlocked = true;
            dialog.close();
          } else void draw(next);
        } catch (err) {
          toast((err as Error).message, 'error');
        } finally {
          recheck.disabled = false;
        }
      });
      if (s.reason === 'signed-out') {
        let url = '';
        try {
          ({ url } = await api.cloudLogin(location.origin));
        } catch (err) {
          body.replaceChildren(h('p.form-status.error', {}, (err as Error).message));
          return;
        }
        // A real link (not window.open after an await) so pop-up blockers allow it.
        const signIn = h('a.button.primary', { href: url, target: '_blank', rel: 'noopener' }, 'Sign in to Fretlane Cloud');
        signIn.addEventListener('click', watch);
        body.replaceChildren(
          h('p.hint', {}, 'Premium comes with the Fretlane Cloud plan on the Fretlane website. Sign in with that account; this window updates by itself.'),
          h('div.cloud-actions', {}, signIn, h('a.button', { href: s.pricingUrl, target: '_blank', rel: 'noopener' }, 'About the plan')),
        );
      } else if (s.reason === 'offline') {
        body.replaceChildren(
          h('p.form-status.error', {}, 'Could not reach the Fretlane website to check your plan. Are you online?'),
          h('div.cloud-actions', {}, recheck),
        );
      } else {
        body.replaceChildren(
          h('p.hint', {}, `Signed in as ${s.email || 'your account'}, which has no active Fretlane Cloud plan.`),
          h('div.cloud-actions', {}, plans, recheck),
        );
      }
    }
    void draw(first);
  });
}
