/**
 * Implementación de producción del Health Graph sobre Drizzle/Postgres.
 *
 * Respeta los invariantes del moat: `bets` y `bet_confirmations` son append-only.
 * Solo `result`/`beliefPosterior`/`confirmed_at` se actualizan en un bet (vía la
 * confirmación); los campos de lectura jamás se tocan.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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
import type { Bet, BetConfirmation, HealthGraphRepo, Pattern, UserProfile } from './repo.js';

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
    };
  }
}
