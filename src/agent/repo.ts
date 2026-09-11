/**
 * Contrato de acceso a datos del Health Graph (capa patrón).
 *
 * Las tools del agente operan sobre esta interfaz (PRD §11.2): es el único camino de
 * escritura; el LLM nunca toca la DB directamente. Hay dos implementaciones:
 * - `MemoryHealthGraphRepo` (tests / arranque sin Postgres)
 * - `DrizzleHealthGraphRepo` (producción, se añade al conectar el server)
 *
 * Invariantes del moat que toda implementación debe respetar:
 * - `bets` es append-only: los campos de lectura (reading_text, variable, direction,
 *   window_spec, predicted_date, engine_version, generator) son inmutables tras emitirse.
 * - `bet_confirmations` es append-only: solo se inserta; la corrección es un evento
 *   aparte con flag `corrected`, el original nunca se borra.
 */
import type { WindowSpec } from '../domain/window-spec.js';
import type {
  BetResult,
  Direction,
  EventType,
  Generator,
  PatternStatus,
  SignalType,
} from '../domain/vocabulary.js';

export interface UserProfile {
  pseudonym: string;
  lifeStage: string | null;
  hasDiagnosis: boolean;
}

export interface Pattern {
  id: string;
  pseudonym: string;
  variable: SignalType;
  direction: Direction;
  windowSpec: WindowSpec;
  belief: number;
  specificity: number;
  status: PatternStatus;
}

export interface Bet {
  id: string;
  pseudonym: string;
  patternId: string | null;
  readingText: string;
  variable: SignalType;
  direction: Direction;
  windowSpec: WindowSpec;
  predictedDate: string;
  result: BetResult | null;
  beliefPrior: number;
  beliefPosterior: number | null;
  engineVersion: string;
  generator: Generator;
}

export interface BetConfirmation {
  id: string;
  betId: string;
  result: BetResult;
  corrected: boolean;
}

export interface HealthGraphRepo {
  getUserProfile(pseudonym: string): Promise<UserProfile | null>;
  upsertUserProfile(profile: UserProfile): Promise<void>;

  findPattern(
    pseudonym: string,
    variable: SignalType,
    direction: Direction,
    windowSpec: WindowSpec,
  ): Promise<Pattern | null>;
  createPattern(input: {
    pseudonym: string;
    variable: SignalType;
    direction: Direction;
    windowSpec: WindowSpec;
    belief: number;
    specificity: number;
  }): Promise<Pattern>;
  updatePatternBelief(patternId: string, belief: number, status: PatternStatus): Promise<void>;

  insertBet(input: {
    pseudonym: string;
    patternId: string | null;
    readingText: string;
    variable: SignalType;
    direction: Direction;
    windowSpec: WindowSpec;
    predictedDate: string;
    beliefPrior: number;
    engineVersion: string;
    generator: Generator;
  }): Promise<Bet>;
  getBet(betId: string): Promise<Bet | null>;
  listConfirmations(betId: string): Promise<BetConfirmation[]>;
  insertConfirmation(input: {
    betId: string;
    result: BetResult;
    corrected: boolean;
  }): Promise<void>;
  updateBetResult(betId: string, result: BetResult, posterior: number): Promise<void>;

  logSignal(input: {
    pseudonym: string;
    signalType: SignalType;
    value: string;
    source: string;
  }): Promise<void>;
  logCycleEvent(input: {
    pseudonym: string;
    eventType: EventType;
    eventDate: string;
    source: string;
  }): Promise<void>;
  completeLesson(input: {
    pseudonym: string;
    lessonKey: string;
    betId: string;
  }): Promise<void>;
}
