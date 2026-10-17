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
import { RIFF_SCHEMA, RIFF_SYSTEM_PROMPT, riffRequestProblem, riffUserMessage, type RiffRequest } from '../shared/editor/assistant.ts';
import type { FretlaneCloud } from './cloud.ts';
import { HttpError } from './library.ts';

export const RIFF_MODEL = 'claude-opus-5-5';

export type AssistantVia = 'own-key' | 'cloud';

export interface AssistantAnswer {
  riff: unknown;
  via: AssistantVia;
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

  async riff(req: RiffRequest): Promise<AssistantAnswer> {
    const problem = riffRequestProblem(req);
    if (problem) throw new HttpError(400, problem);
    if (this.client) return { riff: await askClaude(this.client, req), via: 'own-key' };
    if (!this.cloud.status().connected) {
      throw new HttpError(402, 'The songwriting assistant comes with the Fretlane Cloud plan. Sign in to Fretlane Cloud first.');
    }
    return { riff: await this.cloud.riffAssistant(req), via: 'cloud' };
  }
}

/** One Claude call with structured outputs, so the answer is JSON in the shape of RIFF_SCHEMA. */
export async function askClaude(client: Anthropic, req: RiffRequest): Promise<unknown> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create({
      model: RIFF_MODEL,
      max_tokens: 16000,
      // If the model declines for policy reasons, the API retries on its default fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: RIFF_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: riffUserMessage(req) }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: RIFF_SCHEMA } },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'The Claude API rejected FRETLANE_ANTHROPIC_API_KEY. Check the key.');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The Claude API is rate limiting this key. Try again in a minute.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `The Claude API answered ${err.status ?? 'with an error'}: ${err.message}`);
    throw new HttpError(502, 'Could not reach the Claude API. Are you online?');
  }
  if (message.stop_reason === 'refusal') throw new HttpError(422, 'The assistant declined this request. Try describing the riff differently.');
  if (message.stop_reason === 'max_tokens') throw new HttpError(502, 'The riff was cut off before it was finished. Ask for fewer bars.');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, 'The assistant sent back something that is not a riff. Try again.');
  }
}
