/**
 * Scheduler en proceso (cron simple, PRD §13.2). Ejecuta el sweeper cada
 * `intervalMs`; sin Redis/BullMQ. Los lateAlerts se loguean como ERROR (cero fallos
 * silenciosos); un monitor externo puede engancharse al log.
 */
import type { HealthGraphRepo } from './agent/repo.js';
import { hardDeleteExpired } from './agent/retention.js';
import { sweepConfirmations } from './agent/sweeper.js';
import type { Channel } from './channel/channel.js';

export interface SchedulerOptions {
  repo: HealthGraphRepo;
  channel: Channel;
  intervalMs?: number;
  logger?: Pick<Console, 'error' | 'info'>;
}

export function startScheduler(opts: SchedulerOptions): () => void {
  const intervalMs = opts.intervalMs ?? 60_000;
  const logger = opts.logger ?? console;

  const run = async () => {
    try {
      const result = await sweepConfirmations(opts.repo, opts.channel);
      if (result.lateAlerts.length > 0) {
        logger.error(
          `[sweeper] ${result.lateAlerts.length} confirmación(es) pendiente(s) con >24h de retraso`,
          { betIds: result.lateAlerts.map((b) => b.id) },
        );
      }
      if (result.remindersSent > 0 || result.scheduledSent > 0) {
        logger.info(
          `[sweeper] recordatorios=${result.remindersSent} proactivos=${result.scheduledSent}`,
        );
      }

      const deleted = await hardDeleteExpired(opts.repo);
      if (deleted > 0) {
        logger.info(`[retention] ${deleted} cuenta(s) con borrado duro tras gracia`);
      }
    } catch (err) {
      logger.error('[sweeper] error en la pasada', err);
    }
  };

  const timer = setInterval(run, intervalMs);
  run().catch(() => undefined);

  return () => clearInterval(timer);
}
