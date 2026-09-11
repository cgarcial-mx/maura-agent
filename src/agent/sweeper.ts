/**
 * Sweeper del cron (PRD §13.2). Sin Redis/BullMQ: cron simple + Postgres.
 *
 * - La confirmación de un bet se DERIVA de `bets` (`predicted_date <= today AND
 *   result IS NULL`), no de `scheduled_messages` (evita doble contabilidad).
 * - Deriva TODAS las pendientes (no solo las de hoy) para recuperarse de un día caído.
 * - `reminder_count` limita los recordatorios (máx. MAX_REMINDERS) y pausa tras 2 sin
 *   respuesta (R8.3 "nunca spam").
 * - Alerta: pendientes con >24h de retraso se devuelven en `lateAlerts` (cero fallos
 *   silenciosos); el caller decide cómo alertar (log/monitor).
 * - `scheduled_messages` lleva `check_in`/`follow_up` proactivos.
 */
import { buildConfirmationPrompt, type Channel } from '../channel/channel.js';
import type { Bet, HealthGraphRepo } from './repo.js';

/** Máximo de recordatorios por bet antes de pausar (R8.3: 1 suave, tras 2 se pausa). */
export const MAX_REMINDERS = 2;

export interface SweepResult {
  remindersSent: number;
  lateAlerts: Bet[];
  scheduledSent: number;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function sweepConfirmations(
  repo: HealthGraphRepo,
  channel: Channel,
  today: Date = new Date(),
): Promise<SweepResult> {
  const todayStr = toDateStr(today);

  // 1. Recordatorios de confirmación (derivados de bets).
  const due = await repo.listDueBets(todayStr, MAX_REMINDERS);
  let remindersSent = 0;
  for (const bet of due) {
    const phone = await repo.getPhoneByPseudonym(bet.pseudonym);
    if (!phone) continue; // sin canal resuelto: no hay a dónde enviar
    const sent = await channel.sendConfirmationPrompt(phone, buildConfirmationPrompt(bet));
    if (sent) {
      await repo.markReminderSent(bet.id);
      remindersSent += 1;
    }
  }

  // 2. Alerta de retraso (>24h pendientes).
  const lateAlerts = await repo.listLateBets(todayStr);

  // 3. Mensajes proactivos (check_in / follow_up).
  const scheduled = await repo.listDueScheduledMessages(today);
  let scheduledSent = 0;
  for (const msg of scheduled) {
    const phone = await repo.getPhoneByPseudonym(msg.pseudonym);
    if (!phone) continue;
    const text = typeof (msg.payload as { text?: unknown })?.text === 'string'
      ? (msg.payload as { text: string }).text
      : '¿Cómo estás hoy?';
    const sent = await channel.sendText(phone, text);
    if (sent) {
      await repo.markScheduledMessageSent(msg.id);
      scheduledSent += 1;
    }
  }

  return { remindersSent, lateAlerts, scheduledSent };
}
