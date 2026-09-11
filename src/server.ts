import { DrizzleHealthGraphRepo } from './agent/repo-drizzle.js';
import { buildServer } from './app.js';
import { WhatsAppChannel } from './channel/whatsapp.js';
import { config } from './config.js';
import { createDb } from './db/index.js';
import { DeepSeekProvider } from './llm/deepseek.js';
import { FakeLLMProvider } from './llm/fake.js';
import type { LLMProvider } from './llm/provider.js';
import { startScheduler } from './scheduler.js';

function createProvider(): LLMProvider {
  if (config.llm.apiKey) {
    return new DeepSeekProvider({
      apiKey: config.llm.apiKey,
      model: config.llm.model || undefined,
      baseUrl: config.llm.baseUrl || undefined,
    });
  }
  // Sin API key → fail-closed "sigo observando" (seguro para arrancar).
  return new FakeLLMProvider({ kind: 'observe' });
}

async function main() {
  const db = createDb();
  const repo = new DrizzleHealthGraphRepo(db);
  const provider = createProvider();
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
