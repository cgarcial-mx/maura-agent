import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryHealthGraphRepo } from './repo-memory.js';
import {
  completeLesson,
  confirmReading,
  logSymptom,
  proposeReading,
  ToolError,
} from './tools.js';

// 2026-09-11 es viernes (verificado).
const today = new Date('2026-09-11T00:00:00.000Z');
const PSEUDONYM = 'pseudo-1';

const validInput = {
  reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
  variable: 'energy',
  direction: 'drop',
  window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
};

let repo: MemoryHealthGraphRepo;

beforeEach(() => {
  repo = new MemoryHealthGraphRepo();
});

describe('proposeReading (Safety + Falsability → bets)', () => {
  it('lectura válida → bet persistido, patrón candidate y belief_prior 0.5', async () => {
    const r = await proposeReading(repo, PSEUDONYM, validInput, { today });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bet.engineVersion).toBe('llm-mvp-0.1');
    expect(r.bet.generator).toBe('llm');
    expect(r.bet.predictedDate).toBe('2026-09-11');
    expect(r.bet.result).toBeNull();
    expect(Number(r.bet.beliefPrior)).toBe(0.5);

    const pattern = repo.getPattern(r.bet.patternId!);
    expect(pattern?.status).toBe('candidate');
  });

  it('diagnóstico → safety_blocked, no se persiste', async () => {
    const r = await proposeReading(repo, PSEUDONYM, {
      ...validInput,
      reading_text: 'Tienes endometriosis.',
    }, { today });
    expect(r).toEqual({ ok: false, reason: 'safety_blocked' });
    expect(repo.betCount).toBe(0);
  });

  it('lectura genérica → not_falsable, no se persiste', async () => {
    const r = await proposeReading(repo, PSEUDONYM, {
      reading_text: 'Tu energía varía según el día.',
      variable: 'energy',
      direction: 'improve',
      window_spec: { kind: 'weekdays', start: 'mon', end: 'sun' },
    }, { today });
    expect(r).toEqual({ ok: false, reason: 'not_falsable' });
    expect(repo.betCount).toBe(0);
  });

  it('la misma ventana reusa el patrón (upsert)', async () => {
    await proposeReading(repo, PSEUDONYM, validInput, { today });
    await proposeReading(repo, PSEUDONYM, validInput, { today });
    expect(repo.patternCount).toBe(1);
    expect(repo.betCount).toBe(2);
  });
});

describe('confirmReading (bayes + append-only + idempotencia + corrección)', () => {
  async function emittedBet() {
    const r = await proposeReading(repo, PSEUDONYM, validInput, { today });
    if (!r.ok) throw new Error('expected ok');
    return r.bet;
  }

  it('primera confirmación "yes" → posterior 0.85 y patrón promoted', async () => {
    const bet = await emittedBet();
    const r = await confirmReading(repo, { betId: bet.id, result: 'yes' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corrected).toBe(false);
    expect(r.posterior).toBeCloseTo(0.85, 6);
    expect(r.status).toBe('promoted');
    expect(r.lessonKey).toBe('energy-drop');

    const stored = await repo.getBet(bet.id);
    expect(stored?.result).toBe('yes');
    expect(Number(stored?.beliefPosterior)).toBeCloseTo(0.85, 6);
    expect(repo.getPattern(bet.patternId!)?.belief).toBeCloseTo(0.85, 6);
    expect(repo.getPattern(bet.patternId!)?.status).toBe('promoted');
  });

  it('idempotencia: doble "yes" no registra una segunda confirmación (AC6)', async () => {
    const bet = await emittedBet();
    await confirmReading(repo, { betId: bet.id, result: 'yes' });
    const r2 = await confirmReading(repo, { betId: bet.id, result: 'yes' });
    expect(r2.ok).toBe(true);
    expect(repo.confirmationCount).toBe(1);
  });

  it('corrección única: "yes"→"no" se registra con flag corrected y actualiza el resultado', async () => {
    const bet = await emittedBet();
    await confirmReading(repo, { betId: bet.id, result: 'yes' });

    const r = await confirmReading(repo, { betId: bet.id, result: 'no' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corrected).toBe(true);
    expect(r.posterior).toBeCloseTo(0.2, 6);
    expect(r.status).toBe('discarded');

    const confirmations = repo.getConfirmations(bet.id);
    expect(confirmations).toHaveLength(2);
    // El original nunca se borra; la corrección es un evento aparte.
    expect(confirmations.filter((c) => !c.corrected)).toHaveLength(1);
    expect(confirmations.filter((c) => c.corrected)).toHaveLength(1);
    const stored = await repo.getBet(bet.id);
    expect(stored?.result).toBe('no');
    expect(repo.getPattern(bet.patternId!)?.status).toBe('discarded');
  });

  it('segunda corrección → already_corrected (máximo una, AC14)', async () => {
    const bet = await emittedBet();
    await confirmReading(repo, { betId: bet.id, result: 'yes' });
    await confirmReading(repo, { betId: bet.id, result: 'no' });
    const r = await confirmReading(repo, { betId: bet.id, result: 'yes' });
    expect(r).toEqual({ ok: false, reason: 'already_corrected' });
    expect(repo.confirmationCount).toBe(2);
  });

  it('append-only: tras confirmar y corregir, los campos de lectura no cambian', async () => {
    const bet = await emittedBet();
    const snapshot = {
      readingText: bet.readingText,
      variable: bet.variable,
      direction: bet.direction,
      windowSpec: JSON.stringify(bet.windowSpec),
      predictedDate: bet.predictedDate,
      engineVersion: bet.engineVersion,
      generator: bet.generator,
    };
    await confirmReading(repo, { betId: bet.id, result: 'yes' });
    await confirmReading(repo, { betId: bet.id, result: 'no' });

    const after = await repo.getBet(bet.id);
    expect(after?.readingText).toBe(snapshot.readingText);
    expect(after?.variable).toBe(snapshot.variable);
    expect(after?.direction).toBe(snapshot.direction);
    expect(JSON.stringify(after?.windowSpec)).toBe(snapshot.windowSpec);
    expect(after?.predictedDate).toBe(snapshot.predictedDate);
    expect(after?.engineVersion).toBe(snapshot.engineVersion);
    expect(after?.generator).toBe(snapshot.generator);
  });

  it('resultado inválido → invalid_result', async () => {
    const bet = await emittedBet();
    const r = await confirmReading(repo, { betId: bet.id, result: 'maybe' });
    expect(r).toEqual({ ok: false, reason: 'invalid_result' });
  });

  it('bet inexistente → bet_not_found', async () => {
    const r = await confirmReading(repo, { betId: 'nope', result: 'yes' });
    expect(r).toEqual({ ok: false, reason: 'bet_not_found' });
  });
});

describe('tools de escritura (validación de vocabulario)', () => {
  it('logSymptom rechaza signal_type fuera de lista', async () => {
    await expect(logSymptom(repo, PSEUDONYM, 'weight', '70')).rejects.toThrow(ToolError);
  });

  it('completeLesson exige bet_id existente (R6.2)', async () => {
    await expect(completeLesson(repo, PSEUDONYM, 'energy-drop', 'nope')).rejects.toThrow(
      ToolError,
    );
  });
});
