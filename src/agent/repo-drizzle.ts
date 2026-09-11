/**
 * Implementación de producción del Health Graph sobre Drizzle/Postgres.
 *
 * Respeta los invariantes del moat: `bets` y `bet_confirmations` son append-only.
 * Solo `result`/`beliefPosterior`/`confirmed_at` se actualizan en un bet (vía la
 * confirmación); los campos de lectura jamás se tocan.
 */
import { and, desc, eq, inArray, isNull, lte, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';
import type { WindowSpec } from '../domain/window-spec.js';
import type {
  BetResult,
  Direction,
  Generator,
  PatternStatus,
  SignalType,
} from '../domain/vocabulary.js';
import type {
  Bet,
  BetConfirmation,
  ExportPayload,
  HealthGraphRepo,
  IdentifiableUser,
  Pattern,
  ScheduledMessage,
  Signal,
  UserProfile,
} from './repo.js';

type DB = NodePgDatabase<typeof schema>;
type PatternRow = typeof schema.patterns.$inferSelect;
type BetRow = typeof schema.bets.$inferSelect;

/** Comparación estructural de JSONB con cast explícito (evita ambigüedad de tipo). */
function windowEq(column: typeof schema.patterns.windowSpec, spec: WindowSpec) {
  return sql`${column} = ${JSON.stringify(spec)}::jsonb`;
}

export class DrizzleHealthGraphRepo implements HealthGraphRepo {
  constructor(private readonly db: DB) {}

  async createUser(input: {
    lifeStage?: string | null;
    hasDiagnosis?: boolean;
  }): Promise<{ id: string; pseudonym: string }> {
    const rows = await this.db
      .insert(schema.users)
      .values({
        lifeStage: input.lifeStage ?? null,
        hasDiagnosis: input.hasDiagnosis ?? false,
      })
      .returning();
    const user = rows[0];
    if (!user) throw new Error('failed to create user');
    return { id: user.id, pseudonym: user.pseudonym };
  }

  async getPseudonymByUserId(userId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return rows[0]?.pseudonym ?? null;
  }

  async getUserProfile(pseudonym: string): Promise<UserProfile | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.pseudonym, pseudonym))
      .limit(1);
    const user = rows[0];
    if (!user) return null;
    return {
      pseudonym: user.pseudonym,
      lifeStage: user.lifeStage,
      hasDiagnosis: user.hasDiagnosis ?? false,
    };
  }

  async getUserById(userId: string): Promise<IdentifiableUser | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const u = rows[0];
    if (!u) return null;
    return {
      id: u.id,
      pseudonym: u.pseudonym,
      whatsappPhone: u.whatsappPhone,
      lifeStage: u.lifeStage,
      hasDiagnosis: u.hasDiagnosis ?? false,
      deletedAt: u.deletedAt,
    };
  }

  async exportUserData(pseudonym: string): Promise<ExportPayload> {
    const [profileRows, signals, cycleEvents, memoryEntries, patterns, bets, lessons] =
      await Promise.all([
        this.db
          .select()
          .from(schema.users)
          .where(eq(schema.users.pseudonym, pseudonym))
          .limit(1),
        this.db.select().from(schema.signals).where(eq(schema.signals.pseudonym, pseudonym)),
        this.db
          .select()
          .from(schema.cycleEvents)
          .where(eq(schema.cycleEvents.pseudonym, pseudonym)),
        this.db
          .select()
          .from(schema.memoryEntries)
          .where(eq(schema.memoryEntries.pseudonym, pseudonym)),
        this.db.select().from(schema.patterns).where(eq(schema.patterns.pseudonym, pseudonym)),
        this.db.select().from(schema.bets).where(eq(schema.bets.pseudonym, pseudonym)),
        this.db
          .select()
          .from(schema.lessonsDelivered)
          .where(eq(schema.lessonsDelivered.pseudonym, pseudonym)),
      ]);

    const betIds = bets.map((b) => b.id);
    const confirmations =
      betIds.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.betConfirmations)
            .where(inArray(schema.betConfirmations.betId, betIds));

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        lifeStage: profileRows[0]?.lifeStage ?? null,
        hasDiagnosis: profileRows[0]?.hasDiagnosis ?? false,
      },
      signals: signals.map((s) => ({
        id: s.id,
        pseudonym: s.pseudonym,
        signalType: s.signalType,
        value: s.value,
        source: s.source,
        recordedAt: s.recordedAt.toISOString(),
      })),
      cycleEvents: cycleEvents.map((e) => ({
        id: e.id,
        pseudonym: e.pseudonym,
        eventType: e.eventType,
        eventDate: e.eventDate,
        source: e.source,
      })),
      memoryEntries: memoryEntries.map((m) => ({
        id: m.id,
        kind: m.kind,
        content: m.content,
        status: m.status,
      })),
      patterns: patterns.map((p) => this.toPattern(p)),
      bets: bets.map((b) => this.toBet(b)),
      confirmations: confirmations.map((c) => ({
        id: c.id,
        betId: c.betId,
        result: c.result as BetResult,
        corrected: c.corrected,
      })),
      lessons: lessons.map((l) => ({ lessonKey: l.lessonKey, betId: l.betId })),
    };
  }

  async softDeleteUser(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async hardDeleteUser(pseudonym: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 1. Romper el enlace en bets (conserva el agregado anónimo) y soltar el pattern.
      await tx
        .update(schema.bets)
        .set({ pseudonym: null, patternId: null })
        .where(eq(schema.bets.pseudonym, pseudonym));
      // 2. Borrar datos personales (patrones, proactivos, lecciones, memoria, señales, ciclo).
      await tx.delete(schema.patterns).where(eq(schema.patterns.pseudonym, pseudonym));
      await tx
        .delete(schema.scheduledMessages)
        .where(eq(schema.scheduledMessages.pseudonym, pseudonym));
      await tx
        .delete(schema.lessonsDelivered)
        .where(eq(schema.lessonsDelivered.pseudonym, pseudonym));
      await tx
        .delete(schema.memoryEntries)
        .where(eq(schema.memoryEntries.pseudonym, pseudonym));
      await tx.delete(schema.signals).where(eq(schema.signals.pseudonym, pseudonym));
      await tx.delete(schema.cycleEvents).where(eq(schema.cycleEvents.pseudonym, pseudonym));
      // 3. Borrar la identidad.
      await tx.delete(schema.users).where(eq(schema.users.pseudonym, pseudonym));
    });
  }

  async listUsersPastGrace(cutoff: Date): Promise<string[]> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(lt(schema.users.deletedAt, cutoff));
    return rows.map((u) => u.pseudonym);
  }

  async findPattern(
    pseudonym: string,
    variable: SignalType,
    direction: Direction,
    windowSpec: WindowSpec,
  ): Promise<Pattern | null> {
    const rows = await this.db
      .select()
      .from(schema.patterns)
      .where(
        and(
          eq(schema.patterns.pseudonym, pseudonym),
          eq(schema.patterns.variable, variable),
          eq(schema.patterns.direction, direction),
          windowEq(schema.patterns.windowSpec, windowSpec),
        ),
      )
      .limit(1);
    return rows[0] ? this.toPattern(rows[0]) : null;
  }

  async createPattern(input: {
    pseudonym: string;
    variable: SignalType;
    direction: Direction;
    windowSpec: WindowSpec;
    belief: number;
    specificity: number;
  }): Promise<Pattern> {
    const rows = await this.db
      .insert(schema.patterns)
      .values({
        pseudonym: input.pseudonym,
        variable: input.variable,
        direction: input.direction,
        windowSpec: input.windowSpec,
        belief: String(input.belief),
        specificity: String(input.specificity),
        status: 'candidate',
      })
      .returning();
    const pattern = rows[0];
    if (!pattern) throw new Error('failed to create pattern');
    return this.toPattern(pattern);
  }

  async updatePatternBelief(patternId: string, belief: number, status: PatternStatus): Promise<void> {
    await this.db
      .update(schema.patterns)
      .set({ belief: String(belief), status, updatedAt: new Date() })
      .where(eq(schema.patterns.id, patternId));
  }

  async insertBet(input: {
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
  }): Promise<Bet> {
    const rows = await this.db
      .insert(schema.bets)
      .values({
        pseudonym: input.pseudonym,
        patternId: input.patternId,
        readingText: input.readingText,
        variable: input.variable,
        direction: input.direction,
        windowSpec: input.windowSpec,
        predictedDate: input.predictedDate,
        beliefPrior: String(input.beliefPrior),
        engineVersion: input.engineVersion,
        generator: input.generator,
      })
      .returning();
    const bet = rows[0];
    if (!bet) throw new Error('failed to insert bet');
    return this.toBet(bet);
  }

  async getBet(betId: string): Promise<Bet | null> {
    const rows = await this.db
      .select()
      .from(schema.bets)
      .where(eq(schema.bets.id, betId))
      .limit(1);
    return rows[0] ? this.toBet(rows[0]) : null;
  }

  async getPendingBet(pseudonym: string): Promise<Bet | null> {
    const rows = await this.db
      .select()
      .from(schema.bets)
      .where(and(eq(schema.bets.pseudonym, pseudonym), isNull(schema.bets.result)))
      .orderBy(desc(schema.bets.createdAt))
      .limit(1);
    return rows[0] ? this.toBet(rows[0]) : null;
  }

  async listConfirmations(betId: string): Promise<BetConfirmation[]> {
    const rows = await this.db
      .select()
      .from(schema.betConfirmations)
      .where(eq(schema.betConfirmations.betId, betId))
      .orderBy(schema.betConfirmations.confirmedAt);
    return rows.map((r) => ({
      id: r.id,
      betId: r.betId,
      result: r.result as BetResult,
      corrected: r.corrected,
    }));
  }

  async insertConfirmation(input: {
    betId: string;
    result: BetResult;
    corrected: boolean;
    source: string;
  }): Promise<void> {
    await this.db.insert(schema.betConfirmations).values({
      betId: input.betId,
      result: input.result,
      corrected: input.corrected,
      source: input.source,
    });
  }

  async updateBetResult(betId: string, result: BetResult, posterior: number): Promise<void> {
    await this.db
      .update(schema.bets)
      .set({ result, beliefPosterior: String(posterior), confirmedAt: new Date() })
      .where(eq(schema.bets.id, betId));
  }

  async listDueBets(today: string, maxReminders: number): Promise<Bet[]> {
    const rows = await this.db
      .select()
      .from(schema.bets)
      .where(
        and(
          lte(schema.bets.predictedDate, today),
          isNull(schema.bets.result),
          lt(schema.bets.reminderCount, maxReminders),
        ),
      );
    return rows.map((r) => this.toBet(r));
  }

  async listLateBets(today: string): Promise<Bet[]> {
    const rows = await this.db
      .select()
      .from(schema.bets)
      .where(and(lt(schema.bets.predictedDate, today), isNull(schema.bets.result)));
    return rows.map((r) => this.toBet(r));
  }

  async markReminderSent(betId: string): Promise<void> {
    await this.db
      .update(schema.bets)
      .set({
        reminderCount: sql`${schema.bets.reminderCount} + 1`,
        reminderSentAt: new Date(),
      })
      .where(eq(schema.bets.id, betId));
  }

  async getPhoneByPseudonym(pseudonym: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.pseudonym, pseudonym))
      .limit(1);
    return rows[0]?.whatsappPhone ?? null;
  }

  async listDueScheduledMessages(now: Date): Promise<ScheduledMessage[]> {
    const rows = await this.db
      .select()
      .from(schema.scheduledMessages)
      .where(
        and(
          lte(schema.scheduledMessages.sendAt, now),
          eq(schema.scheduledMessages.status, 'pending'),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      pseudonym: r.pseudonym,
      kind: r.kind as ScheduledMessage['kind'],
      payload: r.payload,
      sendAt: r.sendAt,
      status: r.status as ScheduledMessage['status'],
    }));
  }

  async markScheduledMessageSent(id: string): Promise<void> {
    await this.db
      .update(schema.scheduledMessages)
      .set({ status: 'sent' })
      .where(eq(schema.scheduledMessages.id, id));
  }

  async logSignal(input: {
    pseudonym: string;
    signalType: SignalType;
    value: string;
    source: string;
  }): Promise<void> {
    await this.db.insert(schema.signals).values({
      pseudonym: input.pseudonym,
      signalType: input.signalType,
      value: input.value,
      source: input.source,
    });
  }

  async listRecentSignals(pseudonym: string, limit: number): Promise<Signal[]> {
    const rows = await this.db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.pseudonym, pseudonym))
      .orderBy(desc(schema.signals.recordedAt))
      .limit(limit);
    return rows.map((s) => ({
      id: s.id,
      pseudonym: s.pseudonym,
      signalType: s.signalType,
      value: s.value,
      source: s.source,
      recordedAt: s.recordedAt.toISOString(),
    }));
  }

  async logCycleEvent(input: {
    pseudonym: string;
    eventType: string;
    eventDate: string;
    source: string;
  }): Promise<void> {
    await this.db.insert(schema.cycleEvents).values({
      pseudonym: input.pseudonym,
      eventType: input.eventType,
      eventDate: input.eventDate,
      source: input.source,
    });
  }

  async getLastPeriodStart(pseudonym: string): Promise<Date | null> {
    const rows = await this.db
      .select()
      .from(schema.cycleEvents)
      .where(
        and(
          eq(schema.cycleEvents.pseudonym, pseudonym),
          eq(schema.cycleEvents.eventType, 'period_start'),
        ),
      )
      .orderBy(desc(schema.cycleEvents.eventDate))
      .limit(1);
    return rows[0] ? new Date(`${rows[0].eventDate}T00:00:00.000Z`) : null;
  }

  async completeLesson(input: {
    pseudonym: string;
    lessonKey: string;
    betId: string;
  }): Promise<void> {
    await this.db.insert(schema.lessonsDelivered).values({
      pseudonym: input.pseudonym,
      lessonKey: input.lessonKey,
      betId: input.betId,
    });
  }

  private toPattern(row: PatternRow): Pattern {
    return {
      id: row.id,
      pseudonym: row.pseudonym,
      variable: row.variable as SignalType,
      direction: row.direction as Direction,
      windowSpec: row.windowSpec as WindowSpec,
      belief: Number(row.belief),
      specificity: Number(row.specificity),
      status: row.status as PatternStatus,
    };
  }

  private toBet(row: BetRow): Bet {
    return {
      id: row.id,
      pseudonym: row.pseudonym,
      patternId: row.patternId,
      readingText: row.readingText,
      variable: row.variable as SignalType,
      direction: row.direction as Direction,
      windowSpec: row.windowSpec as WindowSpec,
      predictedDate: row.predictedDate,
      result: row.result as BetResult | null,
      beliefPrior: Number(row.beliefPrior),
      beliefPosterior: row.beliefPosterior === null ? null : Number(row.beliefPosterior),
      engineVersion: row.engineVersion,
      generator: row.generator as Generator,
      reminderCount: Number(row.reminderCount),
    };
  }
}
