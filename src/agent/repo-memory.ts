/**
 * Implementación en memoria del Health Graph (tests / arranque sin Postgres).
 *
 * Respeta los invariantes del moat: `bets` y `bet_confirmations` son append-only.
 * Los campos de lectura de un bet no se mutan nunca; solo `result`/`beliefPosterior`
 * se rellenan vía `updateBetResult` (la confirmación es la única escritura permitida
 * sobre un bet ya emitido).
 */
import { randomUUID } from 'node:crypto';
import type { BetResult } from '../domain/vocabulary.js';
import type {
  Bet,
  BetConfirmation,
  HealthGraphRepo,
  Pattern,
  UserProfile,
} from './repo.js';

export class MemoryHealthGraphRepo implements HealthGraphRepo {
  private users = new Map<string, UserProfile>(); // pseudonym → profile
  private userIds = new Map<string, string>(); // users.id → pseudonym
  private patterns: Pattern[] = [];
  private bets: Bet[] = [];
  private confirmations: BetConfirmation[] = [];
  private signals: { pseudonym: string; signalType: string; value: string; source: string }[] = [];
  private cycleEvents: { pseudonym: string; eventType: string; eventDate: string; source: string }[] = [];
  private lessons: { pseudonym: string; lessonKey: string; betId: string }[] = [];

  async createUser(input: {
    lifeStage?: string | null;
    hasDiagnosis?: boolean;
  }): Promise<{ id: string; pseudonym: string }> {
    const id = randomUUID();
    const pseudonym = randomUUID();
    this.users.set(pseudonym, {
      pseudonym,
      lifeStage: input.lifeStage ?? null,
      hasDiagnosis: input.hasDiagnosis ?? false,
    });
    this.userIds.set(id, pseudonym);
    return { id, pseudonym };
  }

  async getPseudonymByUserId(userId: string): Promise<string | null> {
    return this.userIds.get(userId) ?? null;
  }

  async getUserProfile(pseudonym: string): Promise<UserProfile | null> {
    return this.users.get(pseudonym) ?? null;
  }

  async findPattern(
    pseudonym: string,
    variable: Pattern['variable'],
    direction: Pattern['direction'],
    windowSpec: Pattern['windowSpec'],
  ): Promise<Pattern | null> {
    return (
      this.patterns.find(
        (p) =>
          p.pseudonym === pseudonym &&
          p.variable === variable &&
          p.direction === direction &&
          JSON.stringify(p.windowSpec) === JSON.stringify(windowSpec),
      ) ?? null
    );
  }

  async createPattern(input: {
    pseudonym: string;
    variable: Pattern['variable'];
    direction: Pattern['direction'];
    windowSpec: Pattern['windowSpec'];
    belief: number;
    specificity: number;
  }): Promise<Pattern> {
    const pattern: Pattern = {
      id: randomUUID(),
      pseudonym: input.pseudonym,
      variable: input.variable,
      direction: input.direction,
      windowSpec: input.windowSpec,
      belief: input.belief,
      specificity: input.specificity,
      status: 'candidate',
    };
    this.patterns.push(pattern);
    return pattern;
  }

  async updatePatternBelief(
    patternId: string,
    belief: number,
    status: Pattern['status'],
  ): Promise<void> {
    const p = this.patterns.find((x) => x.id === patternId);
    if (!p) throw new Error(`pattern not found: ${patternId}`);
    p.belief = belief;
    p.status = status;
  }

  async insertBet(input: {
    pseudonym: string;
    patternId: string | null;
    readingText: string;
    variable: Pattern['variable'];
    direction: Pattern['direction'];
    windowSpec: Pattern['windowSpec'];
    predictedDate: string;
    beliefPrior: number;
    engineVersion: string;
    generator: Bet['generator'];
  }): Promise<Bet> {
    const bet: Bet = {
      id: randomUUID(),
      pseudonym: input.pseudonym,
      patternId: input.patternId,
      readingText: input.readingText,
      variable: input.variable,
      direction: input.direction,
      windowSpec: input.windowSpec,
      predictedDate: input.predictedDate,
      result: null,
      beliefPrior: input.beliefPrior,
      beliefPosterior: null,
      engineVersion: input.engineVersion,
      generator: input.generator,
    };
    this.bets.push(bet);
    return bet;
  }

  async getBet(betId: string): Promise<Bet | null> {
    return this.bets.find((b) => b.id === betId) ?? null;
  }

  async getPendingBet(pseudonym: string): Promise<Bet | null> {
    const pending = this.bets.filter((b) => b.pseudonym === pseudonym && b.result === null);
    return pending.at(-1) ?? null;
  }

  async listConfirmations(betId: string): Promise<BetConfirmation[]> {
    return this.confirmations.filter((c) => c.betId === betId);
  }

  async insertConfirmation(input: {
    betId: string;
    result: BetConfirmation['result'];
    corrected: boolean;
    source: string;
  }): Promise<void> {
    this.confirmations.push({
      id: randomUUID(),
      betId: input.betId,
      result: input.result,
      corrected: input.corrected,
    });
  }

  async updateBetResult(betId: string, result: BetResult, posterior: number): Promise<void> {
    const b = this.bets.find((x) => x.id === betId);
    if (!b) throw new Error(`bet not found: ${betId}`);
    b.result = result;
    b.beliefPosterior = posterior;
  }

  async logSignal(input: {
    pseudonym: string;
    signalType: string;
    value: string;
    source: string;
  }): Promise<void> {
    this.signals.push({ ...input });
  }

  async logCycleEvent(input: {
    pseudonym: string;
    eventType: string;
    eventDate: string;
    source: string;
  }): Promise<void> {
    this.cycleEvents.push({ ...input });
  }

  async getLastPeriodStart(pseudonym: string): Promise<Date | null> {
    const starts = this.cycleEvents
      .filter((e) => e.pseudonym === pseudonym && e.eventType === 'period_start')
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
    return starts[0] ? new Date(`${starts[0].eventDate}T00:00:00.000Z`) : null;
  }

  async completeLesson(input: {
    pseudonym: string;
    lessonKey: string;
    betId: string;
  }): Promise<void> {
    this.lessons.push({ ...input });
  }

  // ── Introspección para tests ─────────────────────────────────────────────
  get patternCount(): number {
    return this.patterns.length;
  }
  get betCount(): number {
    return this.bets.length;
  }
  get confirmationCount(): number {
    return this.confirmations.length;
  }
  getConfirmations(betId: string): BetConfirmation[] {
    return this.confirmations.filter((c) => c.betId === betId);
  }
  getPattern(id: string): Pattern | undefined {
    return this.patterns.find((p) => p.id === id);
  }
  getSignalCount(): number {
    return this.signals.length;
  }
  getLessonCount(): number {
    return this.lessons.length;
  }
}
