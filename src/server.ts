import { DrizzleHealthGraphRepo } from './agent/repo-drizzle.js';
import { buildServer } from './app.js';
import { WhatsAppChannel } from './channel/whatsapp.js';
import { config } from './config.js';
import { createDb } from './db/index.js';
import { FakeLLMProvider } from './llm/fake.js';
import { startScheduler } from './scheduler.js';

async function main() {
  const db = createDb();
  const repo = new DrizzleHealthGraphRepo(db);
  // Proveedor real se elige después (§18.7). El cliente fail-closed ya garantiza que
  // un proveedor "observe" sea seguro para arrancar (nunca emite lectura genérica).
  const provider = new FakeLLMProvider({ kind: 'observe' });
  const channel = new WhatsAppChannel();

  const app = await buildServer({
    repo,
    provider,
    logger: true,
    whatsapp: { verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '', channel },
    portability: {
      secret: config.portability.secret,
      publicUrl: config.portability.publicUrl || undefined,
    },
  });

  // Cron simple (PRD §13.2): deriva confirmaciones de bets + proactivos.
  const stopScheduler = startScheduler({
    repo,
    channel,
    intervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 60_000),
  });
  process.on('SIGINT', () => {
    stopScheduler();
    app.close().finally(() => process.exit(0));
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
