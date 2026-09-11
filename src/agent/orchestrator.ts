/**
 * Orquestador del loop central: une LLM (fail-closed) → tools → repo.
 *
 * Es el stand-in del motor: el LLM propone, el sistema valida y persiste. Ante fallo
 * del LLM o lectura no falsable, responde "sigo observando" (nunca degrada a genérico).
 */
import { proposeReadingFailClosed } from '../llm/client.js';
import type { LLMProvider } from '../llm/provider.js';
import type { Bet, HealthGraphRepo } from './repo.js';
import { proposeReading } from './tools.js';

export type GenerateReadingResult =
  | {
      reading: Bet;
    }
  | {
      reading: null;
      msg: string;
      fellBack?: boolean;
      reason?: 'timeout' | 'error' | 'malformed';
    };

export async function generateReading(
  repo: HealthGraphRepo,
  provider: LLMProvider,
  pseudonym: string,
  opts: { today?: Date; context?: unknown } = {},
): Promise<GenerateReadingResult> {
  const cycleAnchor = await repo.getLastPeriodStart(pseudonym);

  const llm = await proposeReadingFailClosed(provider, opts.context);
  if (llm.proposal.kind === 'observe') {
    return {
      reading: null,
      msg: 'Sigo observando',
      ...(llm.fellBack ? { fellBack: true, reason: llm.reason } : {}),
    };
  }

  const proposed = await proposeReading(repo, pseudonym, llm.proposal.reading, {
    today: opts.today,
    cycleAnchor: cycleAnchor ?? undefined,
  });

  if (!proposed.ok) {
    // Safety o Falsability descartaron la lectura → chat, no bet.
    return { reading: null, msg: 'Sigo observando' };
  }

  return { reading: proposed.bet };
}
