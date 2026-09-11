/**
 * Integración del repo Drizzle contra Postgres real.
 *
 * Se ejecuta solo si `TEST_DATABASE_URL` está definido (p. ej. el Postgres de
 * docker-compose). En CI sin DB se omite (skipIf).
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confirmReading, proposeReading } from './tools.js';
import { DrizzleHealthGraphRepo } from './repo-drizzle.js';
import { createDb, schema } from '../db/index.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('DrizzleHealthGraphRepo (Postgres)', () => {
  const db = createDb(url!);
  const repo = new DrizzleHealthGraphRepo(db);
  let userId: string;
  let pseudonym: string;

  const today = new Date('2026-09-11T00:00:00.000Z');
  const validInput = {
    reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
    variable: 'energy',
    direction: 'drop',
    window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
  };

  beforeAll(async () => {
    const user = await repo.createUser({ lifeStage: 'peri_40_47' });
    userId = user.id;
    pseudonym = user.pseudonym;
  });

  afterAll(async () => {
    // Limpieza en orden (FKs): confirmations → bets → patterns → signals → users.
    await db.delete(schema.betConfirmations).where(
      sql`bet_id IN (SELECT id FROM bets WHERE pseudonym = ${pseudonym})`,
    );
    await db.delete(schema.bets).where(eq(schema.bets.pseudonym, pseudonym));
    await db.delete(schema.patterns).where(eq(schema.patterns.pseudonym, pseudonym));
    await db.delete(schema.signals).where(eq(schema.signals.pseudonym, pseudonym));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it('resuelve pseudonym desde userId', async () => {
    expect(await repo.getPseudonymByUserId(userId)).toBe(pseudonym);
  });

  it('persiste el loop completo propose → confirm en Postgres', async () => {
    const proposed = await proposeReading(repo, pseudonym, validInput, { today });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const betId = proposed.bet.id;
    expect(Number(proposed.bet.beliefPrior)).toBe(0.5);

    // Pending bet visible desde el repo.
    const pending = await repo.getPendingBet(pseudonym);
    expect(pending?.id).toBe(betId);

    const confirmed = await confirmReading(repo, { betId, result: 'yes' });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.posterior).toBeCloseTo(0.85, 6);

    const stored = await repo.getBet(betId);
    expect(stored?.result).toBe('yes');
    expect(Number(stored?.beliefPosterior)).toBeCloseTo(0.85, 6);

    // Tras confirmar, ya no hay bet pendiente.
    expect(await repo.getPendingBet(pseudonym)).toBeNull();
  });
});
