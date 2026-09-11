/**
 * Capa de tools del agente (PRD §11.2). Único camino de escritura: el LLM nunca toca
 * la DB; toda acción pasa por aquí con validación, autorización, schema y safety.
 *
 * El loop central:
 * - `proposeReading`: Safety + Falsability → si es falsable, INSERT en `bets`
 *   (append-only); si no, retorna chat (no se persiste).
 * - `confirmReading`: el dato de oro → INSERT `bet_confirmations` + actualiza
 *   `patterns.belief` (bayes) y `patterns.status`. Append-only, idempotente, con
 *   una única corrección marcada `corrected`.
 */
import { bayesUpdate, deriveStatus } from '../domain/bayes.js';
import {
  ENGINE_VERSION,
  isBetResult,
  isEventType,
  isSignalType,
  type BetResult,
  type EventType,
  type PatternStatus,
  type SignalType,
} from '../domain/vocabulary.js';
import { evaluateFalsability, type ReadingCandidate } from '../evals/falsability.js';
import { evaluateSafety } from '../evals/safety.js';
import type { Bet, HealthGraphRepo } from './repo.js';

export class ToolError extends Error {}

function assertSignalType(v: string): SignalType {
  if (!isSignalType(v)) throw new ToolError(`signal_type fuera de vocabulario: ${v}`);
  return v;
}

function assertEventType(v: string): EventType {
  if (!isEventType(v)) throw new ToolError(`event_type fuera de vocabulario: ${v}`);
  return v;
}

// ── Loop central ────────────────────────────────────────────────────────────────

export interface ProposeReadingInput {
  reading_text: string;
  variable: string;
  direction: string;
  window_spec: unknown;
}

export type ProposeReadingResult =
  | { ok: true; bet: Bet }
  | { ok: false; reason: 'safety_blocked' | 'not_falsable' };

export async function proposeReading(
  repo: HealthGraphRepo,
  pseudonym: string,
  input: ProposeReadingInput,
  opts: { today?: Date; cycleAnchor?: Date } = {},
): Promise<ProposeReadingResult> {
  // 1. Safety (bloquea/reformula). No se confía en que el LLM "ya validó".
  const safety = evaluateSafety(input.reading_text);
  if (!safety.safe) return { ok: false, reason: 'safety_blocked' };

  // 2. Falsability (bet vs chat).
  const candidate: ReadingCandidate = {
    reading_text: input.reading_text,
    variable: input.variable,
    direction: input.direction,
    window_spec: input.window_spec,
  };
  const evalResult = evaluateFalsability(candidate, {
    today: opts.today,
    cycleAnchor: opts.cycleAnchor,
  });
  if (!evalResult.ok) return { ok: false, reason: 'not_falsable' };

  // 3. Pattern upsert (candidate la primera vez).
  let pattern = await repo.findPattern(
    pseudonym,
    evalResult.variable,
    evalResult.direction,
    evalResult.windowSpec,
  );
  if (!pattern) {
    pattern = await repo.createPattern({
      pseudonym,
      variable: evalResult.variable,
      direction: evalResult.direction,
      windowSpec: evalResult.windowSpec,
      belief: 0.5,
      specificity: evalResult.specificity,
    });
  }

  // 4. INSERT bets (append-only). belief_prior = creencia actual del patrón.
  const bet = await repo.insertBet({
    pseudonym,
    patternId: pattern.id,
    readingText: input.reading_text,
    variable: evalResult.variable,
    direction: evalResult.direction,
    windowSpec: evalResult.windowSpec,
    predictedDate: evalResult.predictedDate,
    beliefPrior: pattern.belief,
    engineVersion: ENGINE_VERSION,
    generator: 'llm',
  });

  return { ok: true, bet };
}

export interface ConfirmReadingInput {
  betId: string;
  result: string;
}

export type ConfirmReadingResult =
  | {
      ok: true;
      corrected: boolean;
      posterior: number;
      status: PatternStatus;
      lessonKey: string;
    }
  | { ok: false; reason: 'bet_not_found' | 'invalid_result' | 'already_corrected' };

export async function confirmReading(
  repo: HealthGraphRepo,
  input: ConfirmReadingInput,
): Promise<ConfirmReadingResult> {
  if (!isBetResult(input.result)) return { ok: false, reason: 'invalid_result' };
  const result: BetResult = input.result;

  const bet = await repo.getBet(input.betId);
  if (!bet) return { ok: false, reason: 'bet_not_found' };

  const lessonKey = lessonKeyFor(bet.variable, bet.direction);

  // Primera confirmación.
  if (bet.result === null) {
    return applyConfirmation(repo, bet, result, false, lessonKey);
  }

  // Idempotencia: misma respuesta → primera gana (AC6), no se registra de nuevo.
  if (bet.result === result) {
    const posterior = Number(bet.beliefPosterior ?? bayesUpdate(Number(bet.beliefPrior), result));
    return {
      ok: true,
      corrected: false,
      posterior,
      status: deriveStatus(posterior),
      lessonKey,
    };
  }

  // Respuesta distinta → corrección. Máximo una (AC14).
  const confirmations = await repo.listConfirmations(bet.id);
  if (confirmations.some((c) => c.corrected)) {
    return { ok: false, reason: 'already_corrected' };
  }

  return applyConfirmation(repo, bet, result, true, lessonKey);
}

async function applyConfirmation(
  repo: HealthGraphRepo,
  bet: Bet,
  result: BetResult,
  corrected: boolean,
  lessonKey: string,
): Promise<ConfirmReadingResult> {
  const prior = Number(bet.beliefPrior);
  const posterior = bayesUpdate(prior, result);
  const status = deriveStatus(posterior);

  await repo.insertConfirmation({ betId: bet.id, result, corrected });
  await repo.updateBetResult(bet.id, result, posterior);
  if (bet.patternId) {
    await repo.updatePatternBelief(bet.patternId, posterior, status);
  }

  return { ok: true, corrected, posterior, status, lessonKey };
}

function lessonKeyFor(variable: string, direction: string): string {
  return `${variable}-${direction}`;
}

// ── Tools de lectura/escritura (superficie permitida al LLM) ────────────────────

export async function getUserProfile(
  repo: HealthGraphRepo,
  pseudonym: string,
): Promise<{ lifeStage: string | null; hasDiagnosis: boolean } | null> {
  const profile = await repo.getUserProfile(pseudonym);
  if (!profile) return null;
  // Solo contexto minimizado: nunca identidad.
  return { lifeStage: profile.lifeStage, hasDiagnosis: profile.hasDiagnosis };
}

export async function logSymptom(
  repo: HealthGraphRepo,
  pseudonym: string,
  signalType: string,
  value: string,
  source = 'conversation',
): Promise<void> {
  await repo.logSignal({ pseudonym, signalType: assertSignalType(signalType), value, source });
}

export async function logMood(
  repo: HealthGraphRepo,
  pseudonym: string,
  value: string,
  source = 'conversation',
): Promise<void> {
  await repo.logSignal({ pseudonym, signalType: 'mood', value, source });
}

export async function logPeriod(
  repo: HealthGraphRepo,
  pseudonym: string,
  eventType: string,
  eventDate: string,
  source = 'conversation',
): Promise<void> {
  await repo.logCycleEvent({ pseudonym, eventType: assertEventType(eventType), eventDate, source });
}

export async function completeLesson(
  repo: HealthGraphRepo,
  pseudonym: string,
  lessonKey: string,
  betId: string,
): Promise<void> {
  // Regla dura: no hay microlección sin lectura verificada detrás (R6.2).
  const bet = await repo.getBet(betId);
  if (!bet) throw new ToolError(`bet not found: ${betId}`);
  await repo.completeLesson({ pseudonym, lessonKey, betId });
}
