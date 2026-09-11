/**
 * Vocabularios controlados — fuente única de verdad (PRD §18.6).
 *
 * El LLM nunca escribe a la base de datos directamente; toda escritura pasa por
 * tools que validan contra estos vocabularios (PRD §11.2). Un valor fuera de lista
 * se rechaza.
 */

export const SIGNAL_TYPES = [
  'energy',
  'sleep',
  'mood',
  'pain',
  'cycle',
  'digestion',
  'skin',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const DIRECTIONS = ['drop', 'rise', 'spike', 'improve'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const LIFE_STAGES = [
  'reproductive',
  'peri_40_47',
  'peri_48_55',
  'post_meno',
  'post_dx',
  'unknown',
] as const;
export type LifeStage = (typeof LIFE_STAGES)[number];

export const CONDITIONS = [
  'none',
  'sleep_poor',
  'stress',
  'exercise',
  'alcohol',
  'caffeine',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const EVENT_TYPES = ['period_start', 'period_end'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const BET_RESULTS = ['yes', 'partial', 'no'] as const;
export type BetResult = (typeof BET_RESULTS)[number];

export const PATTERN_STATUSES = [
  'candidate',
  'active',
  'promoted',
  'discarded',
] as const;
export type PatternStatus = (typeof PATTERN_STATUSES)[number];

export const ESCALATION_LEVELS = [
  'educational',
  'wellness',
  'potentially concerning',
  'professional care recommended',
] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Generadores de lectura (PRD §9.4). */
export const GENERATORS = ['llm', 'manual', 'motor'] as const;
export type Generator = (typeof GENERATORS)[number];

/** El LLM stand-in escribe lecturas con este engine_version durante el MVP. */
export const ENGINE_VERSION = 'llm-mvp-0.1' as const;

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

export const isSignalType = (v: string): v is SignalType => isOneOf(SIGNAL_TYPES, v);
export const isDirection = (v: string): v is Direction => isOneOf(DIRECTIONS, v);
export const isLifeStage = (v: string): v is LifeStage => isOneOf(LIFE_STAGES, v);
export const isCondition = (v: string): v is Condition => isOneOf(CONDITIONS, v);
export const isEventType = (v: string): v is EventType => isOneOf(EVENT_TYPES, v);
export const isBetResult = (v: string): v is BetResult => isOneOf(BET_RESULTS, v);
export const isPatternStatus = (v: string): v is PatternStatus =>
  isOneOf(PATTERN_STATUSES, v);
export const isWeekday = (v: string): v is Weekday => isOneOf(WEEKDAYS, v);
