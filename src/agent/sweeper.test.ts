import { describe, expect, it } from 'vitest';
import { MemoryChannel } from '../channel/memory.js';
import { MemoryHealthGraphRepo } from './repo-memory.js';
import { sweepConfirmations, MAX_REMINDERS } from './sweeper.js';

const TODAY = new Date('2026-09-11T00:00:00.000Z');
const PHONE = '5215550000000';

function betInput(pseudonym: string, predictedDate: string) {
  return {
    pseudonym,
    patternId: null,
    readingText: 'Creo que tu energía va a caer entre miércoles y viernes.',
    variable: 'energy' as const,
    direction: 'drop' as const,
    windowSpec: { kind: 'weekdays', start: 'wed', end: 'fri' } as const,
    predictedDate,
    beliefPrior: 0.5,
    engineVersion: 'llm-mvp-0.1',
    generator: 'llm' as const,
  };
}

async function seeded() {
  const repo = new MemoryHealthGraphRepo();
  const { pseudonym } = await repo.createUser({});
  repo.setPhone(pseudonym, PHONE);
  return { repo, pseudonym };
}

describe('sweepConfirmations (derivado de bets)', () => {
  it('envía recordatorio al bet vencido y marca reminderCount', async () => {
    const { repo, pseudonym } = await seeded();
    const channel = new MemoryChannel();
    const bet = await repo.insertBet(betInput(pseudonym, '2026-09-11'));

    const r = await sweepConfirmations(repo, channel, TODAY);
    expect(r.remindersSent).toBe(1);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.kind).toBe('confirmation');
    expect(channel.sent[0]!.quickReplies).toEqual(['Sí', 'Más o menos', 'No']);

    const stored = await repo.getBet(bet.id);
    expect(stored?.reminderCount).toBe(1);
  });

  it('pausa tras MAX_REMINDERS recordatorios sin respuesta (R8.3)', async () => {
    const { repo, pseudonym } = await seeded();
    const channel = new MemoryChannel();
    const bet = await repo.insertBet(betInput(pseudonym, '2026-09-10'));

    await sweepConfirmations(repo, channel, TODAY);
    await sweepConfirmations(repo, channel, TODAY);
    const third = await sweepConfirmations(repo, channel, TODAY);

    expect(third.remindersSent).toBe(0);
    const stored = await repo.getBet(bet.id);
    expect(stored?.reminderCount).toBe(MAX_REMINDERS);
    expect(channel.sent).toHaveLength(MAX_REMINDERS);
  });

  it('no toca bets no vencidos ni confirmados', async () => {
    const { repo, pseudonym } = await seeded();
    const channel = new MemoryChannel();
    await repo.insertBet(betInput(pseudonym, '2026-09-12')); // futuro
    const confirmed = await repo.insertBet(betInput(pseudonym, '2026-09-10'));
    await repo.updateBetResult(confirmed.id, 'yes', 0.85);

    const r = await sweepConfirmations(repo, channel, TODAY);
    expect(r.remindersSent).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it('alerta sobre confirmaciones pendientes con >24h de retraso', async () => {
    const { repo, pseudonym } = await seeded();
    const channel = new MemoryChannel();
    const late = await repo.insertBet(betInput(pseudonym, '2026-09-09'));

    const r = await sweepConfirmations(repo, channel, TODAY);
    expect(r.lateAlerts.map((b) => b.id)).toContain(late.id);
  });

  it('procesa mensajes proactivos (check_in) vencidos', async () => {
    const { repo, pseudonym } = await seeded();
    const channel = new MemoryChannel();
    repo.enqueueScheduledMessage({
      id: 'msg-1',
      pseudonym,
      kind: 'check_in',
      payload: { text: '¿Cómo dormiste anoche?' },
      sendAt: new Date('2026-09-10T00:00:00.000Z'),
      status: 'pending',
    });

    const r = await sweepConfirmations(repo, channel, TODAY);
    expect(r.scheduledSent).toBe(1);
    expect(channel.sent.some((m) => m.kind === 'text' && m.text === '¿Cómo dormiste anoche?')).toBe(
      true,
    );
    // Tras enviarse, ya no está pendiente.
    expect(await repo.listDueScheduledMessages(TODAY)).toHaveLength(0);
  });

  it('sin teléfono resuelto, no envía pero sí sigue (no rompe)', async () => {
    const repo = new MemoryHealthGraphRepo();
    const { pseudonym } = await repo.createUser({}); // sin phone
    const channel = new MemoryChannel();
    await repo.insertBet(betInput(pseudonym, '2026-09-11'));

    const r = await sweepConfirmations(repo, channel, TODAY);
    expect(r.remindersSent).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });
});
