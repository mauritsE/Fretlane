/**
 * Server half of the songwriting assistant (see shared/editor/assistant.ts). Two ways to reach Claude:
 *
 * - **Your own API key** in FRETLANE_ANTHROPIC_API_KEY: this server calls the Claude API directly.
 *   For self-hosters and development; the key never reaches the browser.
 * - **Fretlane Cloud** (the default): the website calls Claude with its own key for signed-in users
 *   with the Fretlane Cloud plan, so Premium users need no key of their own.
 *
 * Either way the answer is Claude's raw riff JSON; the editor fits it into the song with riffToBars().
 */
import Anthropic from '@anthropic-ai/sdk';
import { envVar } from '../shared/brand.ts';
import { RIFF_SCHEMA, RIFF_SYSTEM_PROMPT, riffRequestProblem, riffUserContent, type AssistantStatus, type AssistantUsage, type RiffRequest } from '../shared/editor/assistant.ts';
import type { FretlaneCloud } from './cloud.ts';
import { HttpError } from './library.ts';

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

  async riff(req: RiffRequest): Promise<AssistantAnswer> {
    const problem = riffRequestProblem(req);
    if (problem) throw new HttpError(400, problem);
    if (this.client) return { riff: await askClaude(this.client, req), via: 'own-key' };
    if (!this.cloud.status().connected) {
      throw new HttpError(402, 'The songwriting assistant comes with the Fretlane Cloud plan. Sign in to Fretlane Cloud first.');
    }
    return { ...(await this.cloud.riffAssistant(req)), via: 'cloud' };
  }
}

/** One Claude call with structured outputs, so the answer is JSON in the shape of RIFF_SCHEMA. */
export async function askClaude(client: Anthropic, req: RiffRequest): Promise<unknown> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    // Streamed: four parts of eight bars can be a long answer, and a stream doesn't time out on it.
    message = await client.beta.messages
      .stream({
        model: RIFF_MODEL,
        max_tokens: 64000,
        // If the model declines for policy reasons, the API retries on its default fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: RIFF_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: riffUserContent(req) }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: RIFF_SCHEMA } },
      })
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'The Claude API rejected FRETLANE_ANTHROPIC_API_KEY. Check the key.');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The Claude API is rate limiting this key. Try again in a minute.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `The Claude API answered ${err.status ?? 'with an error'}: ${err.message}`);
    throw new HttpError(502, 'Could not reach the Claude API. Are you online?');
  }
  // What the request cost, for pricing the assistant: tokens in (new, cache write, cache read) and out.
  const u = message.usage;
  console.info(`Riff assistant: ${req.mode}, ${req.bars} bar(s): ${u.input_tokens} in, ${u.cache_creation_input_tokens ?? 0} cache write, ${u.cache_read_input_tokens ?? 0} cache read, ${u.output_tokens} out`);
  if (message.stop_reason === 'refusal') throw new HttpError(422, 'The assistant declined this request. Try describing the riff differently.');
  if (message.stop_reason === 'max_tokens') throw new HttpError(502, 'The riff was cut off before it was finished. Ask for fewer bars.');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, 'The assistant sent back something that is not a riff. Try again.');
  }
}
