/**
 * Retención / borrado duro tras el periodo de gracia (PRD §9.6).
 *
 * El "borrar cuenta" hace soft-delete (deleted_at). Tras 30 días de gracia, el
 * barrido ejecuta el borrado duro: rompe el enlace a pseudonym en `bets` (conserva el
 * agregado anónimo) y borra los datos personales.
 */
import type { HealthGraphRepo } from './repo.js';

export const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

export async function hardDeleteExpired(
  repo: HealthGraphRepo,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_MS);
  const pseudonyms = await repo.listUsersPastGrace(cutoff);
  for (const pseudonym of pseudonyms) {
    await repo.hardDeleteUser(pseudonym);
  }
  return pseudonyms.length;
}
