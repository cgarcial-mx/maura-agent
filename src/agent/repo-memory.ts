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
  CycleEvent,
  ExportPayload,
  HealthGraphRepo,
  IdentifiableUser,
  MemoryEntry,
  Pattern,
  ScheduledMessage,
  Signal,
  UserProfile,
} from './repo.js';

export class MemoryHealthGraphRepo implements HealthGraphRepo {
  private users = new Map<string, UserProfile>(); // pseudonym → profile
  private userIds = new Map<string, string>(); // users.id → pseudonym
  private patterns: Pattern[] = [];
  private bets: Bet[] = [];
  private confirmations: BetConfirmation[] = [];
  private signals: Signal[] = [];
  private cycleEvents: CycleEvent[] = [];
  private memoryEntries: MemoryEntry[] = [];
  private lessons: { pseudonym: string; lessonKey: string; betId: string }[] = [];
  private phones = new Map<string, string>(); // pseudonym → whatsapp_phone
  private scheduledMessages: ScheduledMessage[] = [];
  private deletedAt = new Map<string, Date>(); // pseudonym → deleted_at
  private memoryEntryOwners = new Map<string, string>(); // memory entry id → pseudonym

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

  async getUserById(userId: string): Promise<IdentifiableUser | null> {
    const pseudonym = this.userIds.get(userId);
    if (!pseudonym) return null;
    const profile = this.users.get(pseudonym);
    if (!profile) return null;
    return {
      id: userId,
      pseudonym,
      whatsappPhone: this.phones.get(pseudonym) ?? null,
      lifeStage: profile.lifeStage,
      hasDiagnosis: profile.hasDiagnosis,
      deletedAt: this.deletedAt.get(pseudonym) ?? null,
    };
  }

  async exportUserData(pseudonym: string): Promise<ExportPayload> {
    const profile = this.users.get(pseudonym);
    const betIds = new Set(this.bets.filter((b) => b.pseudonym === pseudonym).map((b) => b.id));
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        lifeStage: profile?.lifeStage ?? null,
        hasDiagnosis: profile?.hasDiagnosis ?? false,
      },
      signals: this.signals.filter((s) => s.pseudonym === pseudonym),
      cycleEvents: this.cycleEvents.filter((e) => e.pseudonym === pseudonym),
      memoryEntries: this.memoryEntries.filter((m) => this.memoryEntryOwners.get(m.id) === pseudonym),
      patterns: this.patterns.filter((p) => p.pseudonym === pseudonym),
      bets: this.bets.filter((b) => b.pseudonym === pseudonym),
      confirmations: this.confirmations.filter((c) => betIds.has(c.betId)),
      lessons: this.lessons
        .filter((l) => l.pseudonym === pseudonym)
        .map((l) => ({ lessonKey: l.lessonKey, betId: l.betId })),
    };
  }

  async softDeleteUser(userId: string): Promise<void> {
    const pseudonym = this.userIds.get(userId);
    if (!pseudonym) return;
    this.deletedAt.set(pseudonym, new Date());
  }

  async hardDeleteUser(pseudonym: string): Promise<void> {
    // Romper el enlace en bets (conserva el agregado anónimo) + soltar patterns.
    for (const b of this.bets) {
      if (b.pseudonym === pseudonym) {
        b.pseudonym = null;
        b.patternId = null;
      }
    }
    // Borrar datos personales.
    this.patterns = this.patterns.filter((p) => p.pseudonym !== pseudonym);
    this.signals = this.signals.filter((s) => s.pseudonym !== pseudonym);
    this.cycleEvents = this.cycleEvents.filter((e) => e.pseudonym !== pseudonym);
    this.lessons = this.lessons.filter((l) => l.pseudonym !== pseudonym);
    this.scheduledMessages = this.scheduledMessages.filter((m) => m.pseudonym !== pseudonym);
    for (const [entryId, owner] of [...this.memoryEntryOwners.entries()]) {
      if (owner === pseudonym) {
        this.memoryEntries = this.memoryEntries.filter((m) => m.id !== entryId);
        this.memoryEntryOwners.delete(entryId);
      }
    }
    this.users.delete(pseudonym);
    this.phones.delete(pseudonym);
    this.deletedAt.delete(pseudonym);
    for (const [id, pseudo] of [...this.userIds.entries()]) {
      if (pseudo === pseudonym) this.userIds.delete(id);
    }
  }

  async listUsersPastGrace(cutoff: Date): Promise<string[]> {
    const out: string[] = [];
    for (const [pseudonym, deleted] of this.deletedAt.entries()) {
      if (deleted <= cutoff) out.push(pseudonym);
    }
    return out;
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
      reminderCount: 0,
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

  async listDueBets(today: string, maxReminders: number): Promise<Bet[]> {
    return this.bets.filter(
      (b) => b.predictedDate <= today && b.result === null && b.reminderCount < maxReminders,
    );
  }

  async listLateBets(today: string): Promise<Bet[]> {
    return this.bets.filter((b) => b.predictedDate < today && b.result === null);
  }

  async markReminderSent(betId: string): Promise<void> {
    const b = this.bets.find((x) => x.id === betId);
    if (!b) throw new Error(`bet not found: ${betId}`);
    b.reminderCount += 1;
  }

  async getPhoneByPseudonym(pseudonym: string): Promise<string | null> {
    return this.phones.get(pseudonym) ?? null;
  }

  async listDueScheduledMessages(now: Date): Promise<ScheduledMessage[]> {
    return this.scheduledMessages.filter((m) => m.sendAt <= now && m.status === 'pending');
  }

  async markScheduledMessageSent(id: string): Promise<void> {
    const m = this.scheduledMessages.find((x) => x.id === id);
    if (!m) throw new Error(`scheduled message not found: ${id}`);
    m.status = 'sent';
  }

  // ── helpers de test ─────────────────────────────────────────────────────
  setPhone(pseudonym: string, phone: string): void {
    this.phones.set(pseudonym, phone);
  }

  enqueueScheduledMessage(msg: ScheduledMessage): void {
    this.scheduledMessages.push(msg);
  }

  async logSignal(input: {
    pseudonym: string;
    signalType: string;
    value: string;
    source: string;
  }): Promise<void> {
    this.signals.push({
      id: randomUUID(),
      pseudonym: input.pseudonym,
      signalType: input.signalType,
      value: input.value,
      source: input.source,
      recordedAt: new Date().toISOString(),
    });
  }

  async listRecentSignals(pseudonym: string, limit: number): Promise<Signal[]> {
    return this.signals.filter((s) => s.pseudonym === pseudonym).slice(-limit).reverse();
  }

  async logCycleEvent(input: {
    pseudonym: string;
    eventType: string;
    eventDate: string;
    source: string;
  }): Promise<void> {
    this.cycleEvents.push({
      id: randomUUID(),
      pseudonym: input.pseudonym,
      eventType: input.eventType,
      eventDate: input.eventDate,
      source: input.source,
    });
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
