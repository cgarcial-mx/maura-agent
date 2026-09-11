/**
 * Contrato de acceso a datos del Health Graph (capa patrón).
 *
 * Las tools del agente operan sobre esta interfaz (PRD §11.2): es el único camino de
 * escritura; el LLM nunca toca la DB directamente. Hay dos implementaciones:
 * - `MemoryHealthGraphRepo` (tests / arranque sin Postgres)
 * - `DrizzleHealthGraphRepo` (producción)
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
  /** null tras el borrado duro (se rompe el enlace para conservar el agregado anónimo). */
  pseudonym: string | null;
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
  reminderCount: number;
}

export interface BetConfirmation {
  id: string;
  betId: string;
  result: BetResult;
  corrected: boolean;
}

export interface ScheduledMessage {
  id: string;
  pseudonym: string;
  kind: 'check_in' | 'follow_up';
  payload: unknown;
  sendAt: Date;
  status: 'pending' | 'sent' | 'cancelled';
}

export interface IdentifiableUser {
  id: string;
  pseudonym: string;
  whatsappPhone: string | null;
  lifeStage: string | null;
  hasDiagnosis: boolean;
  deletedAt: Date | null;
}

export interface Signal {
  id: string;
  pseudonym: string;
  signalType: string;
  value: string | null;
  source: string;
  recordedAt: string;
}

export interface CycleEvent {
  id: string;
  pseudonym: string;
  eventType: string;
  eventDate: string;
  source: string;
}

export interface MemoryEntry {
  id: string;
  kind: string;
  content: string;
  status: string;
}

export interface ExportPayload {
  exportedAt: string;
  profile: { lifeStage: string | null; hasDiagnosis: boolean };
  signals: Signal[];
  cycleEvents: CycleEvent[];
  memoryEntries: MemoryEntry[];
  patterns: Pattern[];
  bets: Bet[];
  confirmations: BetConfirmation[];
  lessons: { lessonKey: string; betId: string | null }[];
}

export interface HealthGraphRepo {
  // Capa identificable
  createUser(input: {
    lifeStage?: string | null;
    hasDiagnosis?: boolean;
  }): Promise<{ id: string; pseudonym: string }>;
  getPseudonymByUserId(userId: string): Promise<string | null>;
  getUserProfile(pseudonym: string): Promise<UserProfile | null>;
  getUserById(userId: string): Promise<IdentifiableUser | null>;

  // Portabilidad / borrado (AC7, AC12, §9.6)
  exportUserData(pseudonym: string): Promise<ExportPayload>;
  softDeleteUser(userId: string): Promise<void>;
  hardDeleteUser(pseudonym: string): Promise<void>;
  listUsersPastGrace(cutoff: Date): Promise<string[]>;

  // Patrones
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

  // Bets
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
  getPendingBet(pseudonym: string): Promise<Bet | null>;
  listConfirmations(betId: string): Promise<BetConfirmation[]>;
  insertConfirmation(input: {
    betId: string;
    result: BetResult;
    corrected: boolean;
    source: string;
  }): Promise<void>;
  updateBetResult(betId: string, result: BetResult, posterior: number): Promise<void>;

  // Scheduler / sweeper (PRD §13.2)
  listDueBets(today: string, maxReminders: number): Promise<Bet[]>;
  listLateBets(today: string): Promise<Bet[]>;
  markReminderSent(betId: string): Promise<void>;
  getPhoneByPseudonym(pseudonym: string): Promise<string | null>;
  listDueScheduledMessages(now: Date): Promise<ScheduledMessage[]>;
  markScheduledMessageSent(id: string): Promise<void>;

  // Señales / ciclo / lecciones
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
  getLastPeriodStart(pseudonym: string): Promise<Date | null>;
  completeLesson(input: {
    pseudonym: string;
    lessonKey: string;
    betId: string;
  }): Promise<void>;
}
