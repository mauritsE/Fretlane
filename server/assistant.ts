/**
 * Server half of the songwriting assistant (see shared/editor/assistant.ts). Two ways to reach Claude:
 *
 * - **Your own API key** in FRETLANE_ANTHROPIC_API_KEY: this server calls the Claude API directly.
 *   For self-hosters and development; the key never reaches the browser.
 * - **Fretlane Cloud** (the default): the website calls Claude with its own key for signed-in users
 *   with the Fretlane Cloud plan, so Premium users need no key of their own.
 *
 * Either way the answer is Claude's raw riff JSON; the editor fits it into the song with riffToBars().
 * With `onEvent`, Claude's answer is passed on as it is written (shared/editor/riffStream.ts).
 */
import Anthropic from '@anthropic-ai/sdk';
import { envVar } from '../shared/brand.ts';
import { RIFF_SCHEMA, RIFF_SYSTEM_PROMPT, riffRequestProblem, riffUserContent, type AssistantStatus, type AssistantUsage, type RiffRequest } from '../shared/editor/assistant.ts';
import type { FretlaneCloud } from './cloud.ts';
import { riffFixPrompt, riffProblems } from '../shared/editor/riffCheck.ts';
import { HttpError } from './library.ts';
import type { RiffEvent } from '../shared/editor/riffStream.ts';

export const RIFF_MODEL = 'claude-opus-5-5';

export type AssistantVia = 'own-key' | 'cloud';

export interface AssistantAnswer {
  riff: unknown;
  via: AssistantVia;
  /** Through Fretlane Cloud: the plan's assistant bars this month. */
  usage?: AssistantUsage;
  /** Through Fretlane Cloud: e.g. which parts were left out because the month's bars ran out. */
  notice?: string;
}

export class RiffAssistant {
  private readonly client: Anthropic | null;

  constructor(
    private readonly cloud: FretlaneCloud,
    apiKey: string | undefined = envVar('ANTHROPIC_API_KEY'),
    client?: Anthropic,
  ) {
    this.client = client ?? (apiKey ? new Anthropic({ apiKey }) : null);
  }

  get via(): AssistantVia {
    return this.client ? 'own-key' : 'cloud';
  }

  /** Whether the assistant can be used, and this month's bars through Fretlane Cloud. */
  async status(): Promise<AssistantStatus> {
    // With an own key nothing is counted, and no plan is needed.
    if (this.client) return { access: 'own-key', usage: null, pricingUrl: this.cloud.pricingUrl };
    return this.cloud.assistantStatus();
  }

  /** Throws before anything is streamed when the request can't be asked (see `check`). `signal` stops an own-key call. */
  async riff(req: RiffRequest, onEvent?: (e: RiffEvent) => void, signal?: AbortSignal): Promise<AssistantAnswer> {
    this.check(req);
    if (this.client) return { riff: (await askClaude(this.client, req, onEvent, signal)).riff, via: 'own-key' };
    // No `signal` here: the website has reserved the plan's bars and settles them when Claude is
    // done, so the request runs to the end (and is charged for what was written) even after Stop.
    return { ...(await this.cloud.riffAssistant(req, onEvent)), via: 'cloud' };
  }

  /** The errors known before Claude is asked: a bad request, or no way to reach Claude. */
  check(req: RiffRequest): void {
    const problem = riffRequestProblem(req);
    if (problem) throw new HttpError(400, problem);
    if (!this.client && !this.cloud.status().connected) {
      throw new HttpError(402, 'The songwriting assistant comes with the Fretlane Cloud plan. Sign in to Fretlane Cloud first.');
    }
  }
}

/** Tokens one request used, across Claude calls: the inputs (new, written to and read from the cache) and the output. */
export interface RiffTokens {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export interface ClaudeRiff {
  riff: unknown;
  tokens: RiffTokens;
  /** The checks found problems and Claude sent a corrected answer, which is the one returned. */
  corrected: boolean;
}

type Turn = Anthropic.Beta.BetaMessageParam;

/**
 * Asks Claude for a riff with structured outputs, so the answer is JSON in the shape of RIFF_SCHEMA.
 * When the riff checks (riffCheck.ts) find problems, Claude gets them back once and the corrected
 * answer is kept, unless it is worse or the second call fails.
 */
export async function askClaude(client: Anthropic, req: RiffRequest, onEvent?: (e: RiffEvent) => void, signal?: AbortSignal): Promise<ClaudeRiff> {
  const tokens: RiffTokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const ask: Turn = { role: 'user', content: riffUserContent(req) };
  const call = (messages: Turn[]) => callClaude(client, messages, tokens, onEvent, signal);
  const first = await call([ask]);
  const problems = riffProblems(first.riff, req.bars, req.check);
  let result: ClaudeRiff = { riff: first.riff, tokens, corrected: false };
  if (problems.length) {
    onEvent?.({ type: 'restart', problems: problems.length });
    try {
      const second = await call([ask, { role: 'assistant', content: first.text }, { role: 'user', content: riffFixPrompt(problems) }]);
      if (riffProblems(second.riff, req.bars, req.check).length <= problems.length) result = { riff: second.riff, tokens, corrected: true };
    } catch (err) {
      if (signal?.aborted) throw err;
      // The first answer still stands; the app repairs what it can.
      console.warn(`Riff assistant: the corrected answer failed (${(err as Error).message}); keeping the first.`);
    }
  }
  // What the request cost, for pricing the assistant: tokens in (new, cache write, cache read) and out.
  console.info(
    `Riff assistant: ${req.mode}, ${req.bars} bar(s)${problems.length ? `, ${problems.length} problem(s) sent back${result.corrected ? '' : ', kept the first answer'}` : ''}: ${tokens.input} in, ${tokens.cacheWrite} cache write, ${tokens.cacheRead} cache read, ${tokens.output} out`,
  );
  return result;
}

/** One Claude call. Adds what it used to `tokens`, and passes the answer on to `onEvent` as it is written. */
async function callClaude(
  client: Anthropic,
  messages: Turn[],
  tokens: RiffTokens,
  onEvent?: (e: RiffEvent) => void,
  signal?: AbortSignal,
): Promise<{ riff: unknown; text: string }> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    // Streamed: four parts of eight bars can be a long answer, and a stream doesn't time out on it.
    const stream = client.beta.messages.stream(
      {
        model: RIFF_MODEL,
        max_tokens: 64000,
        // If the model declines for policy reasons, the API retries on its default fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: RIFF_SYSTEM_PROMPT,
        messages,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: RIFF_SCHEMA } },
      },
      signal ? { signal } : undefined,
    );
    if (onEvent) stream.on('text', (text) => onEvent({ type: 'text', text }));
    message = await stream.finalMessage();
  } catch (err) {
    if (signal?.aborted) throw new HttpError(499, 'Stopped.');
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'The Claude API rejected FRETLANE_ANTHROPIC_API_KEY. Check the key.');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The Claude API is rate limiting this key. Try again in a minute.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `The Claude API answered ${err.status ?? 'with an error'}: ${err.message}`);
    throw new HttpError(502, 'Could not reach the Claude API. Are you online?');
  }
  const u = message.usage;
  tokens.input += u.input_tokens;
  tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
  tokens.cacheRead += u.cache_read_input_tokens ?? 0;
  tokens.output += u.output_tokens;
  if (message.stop_reason === 'refusal') throw new HttpError(422, 'The assistant declined this request. Try describing the riff differently.');
  if (message.stop_reason === 'max_tokens') throw new HttpError(502, 'The riff was cut off before it was finished. Ask for fewer bars.');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    return { riff: JSON.parse(text) as unknown, text };
  } catch {
    throw new HttpError(502, 'The assistant sent back something that is not a riff. Try again.');
  }
}
