import { describe, expect, it } from 'vitest';
import { MemoryHealthGraphRepo } from './repo-memory.js';
import { confirmReading, proposeReading } from './tools.js';
import { hardDeleteExpired, DELETION_GRACE_MS } from './retention.js';

const today = new Date('2026-09-11T00:00:00.000Z');
const validInput = {
  reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
  variable: 'energy',
  direction: 'drop',
  window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
};

describe('borrado duro (AC7, §9.6)', () => {
  it('rompe el enlace en bets y borra datos personales; conserva el agregado anónimo', async () => {
    const repo = new MemoryHealthGraphRepo();
    const { id: userId, pseudonym } = await repo.createUser({ lifeStage: 'peri_40_47' });
    repo.setPhone(pseudonym, '5215550000000');

    const proposed = await proposeReading(repo, pseudonym, validInput, { today });
    if (!proposed.ok) throw new Error('expected ok');
    const betId = proposed.bet.id;
    await confirmReading(repo, { betId, result: 'yes' });

    expect(await repo.getUserById(userId)).not.toBeNull();
    expect((await repo.exportUserData(pseudonym)).bets).toHaveLength(1);

    await repo.hardDeleteUser(pseudonym);

    // Identidad borrada.
    expect(await repo.getUserById(userId)).toBeNull();
    expect(await repo.getPseudonymByUserId(userId)).toBeNull();

    // El bet sobrevive anónimo (pseudonym null, sin pattern).
    const bet = await repo.getBet(betId);
    expect(bet).not.toBeNull();
    expect(bet?.pseudonym).toBeNull();
    expect(bet?.patternId).toBeNull();
    expect(bet?.result).toBe('yes'); // el agregado verificado se conserva
  });

  it('soft-delete marca deleted_at y el barrido borra tras la gracia', async () => {
    const repo = new MemoryHealthGraphRepo();
    const { id: userId, pseudonym } = await repo.createUser({});

    await repo.softDeleteUser(userId);
    expect((await repo.getUserById(userId))?.deletedAt).not.toBeNull();

    // Antes de la gracia: no se borra.
    expect(await hardDeleteExpired(repo, new Date())).toBe(0);
    expect(await repo.getUserById(userId)).not.toBeNull();

    // Tras 31 días: se borra.
    const future = new Date(Date.now() + DELETION_GRACE_MS + 86_400_000);
    expect(await hardDeleteExpired(repo, future)).toBe(1);
    expect(await repo.getUserById(userId)).toBeNull();
  });
});
