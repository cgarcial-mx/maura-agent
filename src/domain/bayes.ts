/**
 * Actualización bayesiana de `patterns.belief` (PRD §9.5).
 *
 * Versión simple del MVP: un likelihood por resultado sobre cada confirmación.
 *   posterior = prior * L / ( prior * L + (1 - prior) * (1 - L) )
 *
 * Interpretación (odds ratio, forma simétrica): L = P(resultado | patrón real),
 * (1 - L) = P(resultado | patrón no real). El motor v1 refina esto a una matriz de
 * confusión completa (yes/partial/no × real/no-real).
 *
 * Umbrales (PRD §18.3): belief > 0.75 → promoted; < 0.30 → discarded; en medio active.
 */
import type { BetResult, PatternStatus } from './vocabulary.js';

export const LIKELIHOODS: Record<BetResult, number> = {
  yes: 0.85,
  partial: 0.55,
  no: 0.20,
} as const;

export const PROMOTED_THRESHOLD = 0.75;
export const DISCARDED_THRESHOLD = 0.30;

/** Prior por defecto de un patrón recién creado (candidate). */
export const DEFAULT_PRIOR = 0.5;

export function bayesUpdate(prior: number, result: BetResult): number {
  const L = LIKELIHOODS[result];
  const posterior = (prior * L) / (prior * L + (1 - prior) * (1 - L));
  return round6(posterior);
}

export function deriveStatus(belief: number): PatternStatus {
  if (belief > PROMOTED_THRESHOLD) return 'promoted';
  if (belief < DISCARDED_THRESHOLD) return 'discarded';
  return 'active';
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
