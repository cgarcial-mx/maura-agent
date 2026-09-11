/**
 * Eval B — Falsabilidad (determinista). PRD §12.2.
 *
 * Decide bet vs chat. Una salida es `bet` SOLO si la estructura es completa y válida:
 *   variable + direction + window_spec(estricto) + predicted_date computable + específica.
 *
 * El LLM propone la estructura vía function calling (PRD §18.4); este validador es el
 * gate duro. El sistema no confía en que el LLM "ya validó".
 *
 * Regla dura (1.0): "si aplica a cualquiera, no sale." Preferir no leer a leer genérico.
 */
import {
  isDirection,
  isSignalType,
  type Direction,
  type SignalType,
  type Weekday,
} from '../domain/vocabulary.js';
import {
  computePredictedDate,
  validateWindowSpec,
  type WindowSpec,
} from '../domain/window-spec.js';

export interface ReadingCandidate {
  reading_text: string;
  variable?: unknown;
  direction?: unknown;
  window_spec?: unknown;
}

export type FalsabilityFailureReason =
  | 'missing_field'
  | 'invalid_variable'
  | 'invalid_direction'
  | 'invalid_window'
  | 'no_predicted_date'
  | 'not_specific_enough';

export type FalsabilityResult =
  | {
      ok: true;
      variable: SignalType;
      direction: Direction;
      windowSpec: WindowSpec;
      predictedDate: string;
      specificity: number;
    }
  | { ok: false; reason: FalsabilityFailureReason };

export const SPECIFICITY_THRESHOLD = 0.55;

export interface FalsabilityContext {
  today?: Date;
  /** Último inicio de periodo (día 1 del ciclo); requerido para `cycle_days`. */
  cycleAnchor?: Date;
}

export function evaluateFalsability(
  candidate: ReadingCandidate,
  ctx: FalsabilityContext = {},
): FalsabilityResult {
  const { reading_text, variable, direction, window_spec } = candidate;

  if (typeof reading_text !== 'string' || !reading_text.trim()) {
    return { ok: false, reason: 'missing_field' };
  }
  if (typeof variable !== 'string' || !isSignalType(variable)) {
    return { ok: false, reason: 'invalid_variable' };
  }
  if (typeof direction !== 'string' || !isDirection(direction)) {
    return { ok: false, reason: 'invalid_direction' };
  }

  const window = validateWindowSpec(window_spec);
  if (!window.ok) return { ok: false, reason: 'invalid_window' };

  const predictedDate = computePredictedDate(window.value, ctx);
  if (predictedDate === null) return { ok: false, reason: 'no_predicted_date' };

  const specificity = computeSpecificity(reading_text, direction, window.value);
  if (specificity < SPECIFICITY_THRESHOLD) {
    return { ok: false, reason: 'not_specific_enough' };
  }

  return {
    ok: true,
    variable,
    direction,
    windowSpec: window.value,
    predictedDate,
    specificity,
  };
}

// ── Heurística de especificidad (gate anti-genérico) ─────────────────────────────
// Cuanto más estrecha la ventana y más concreta la condición, más específica la
// lectura. Las frases genéricas penalizan. Umbral 0.55 (PRD §18.3).

const GENERIC_PHRASES: RegExp[] = [
  /var[ií]a/i,
  /seg[uú]n el d[ií]a/i,
  /\bdepende\b/i,
  /a veces/i,
  /en general/i,
  /muchas mujeres/i,
  /algunas veces/i,
  /puede que/i,
  /es normal que/i,
  /todo el mundo/i,
];

const WEEKDAY_INDEX: Record<Weekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export function computeSpecificity(
  readingText: string,
  direction: Direction,
  window: WindowSpec,
): number {
  let s = 0;

  if (window.kind === 'cycle_days') {
    const range = window.end - window.start + 1;
    if (range <= 3) s += 0.55;
    else if (range <= 5) s += 0.45;
    else if (range <= 7) s += 0.35;
    else s += 0.2;
  } else {
    const span = WEEKDAY_INDEX[window.end] - WEEKDAY_INDEX[window.start] + 1;
    if (span <= 2) s += 0.55;
    else if (span <= 3) s += 0.5;
    else if (span <= 5) s += 0.35;
    else s += 0.2;
  }

  if (window.condition && window.condition !== 'none') s += 0.3;
  if (direction !== 'improve') s += 0.15; // drop/rise/spike son más específicos

  if (GENERIC_PHRASES.some((re) => re.test(readingText))) s -= 0.4;

  return Math.max(0, Math.min(1, s));
}
