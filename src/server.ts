import { DrizzleHealthGraphRepo } from './agent/repo-drizzle.js';
import { buildServer } from './app.js';
import { createDb } from './db/index.js';
import { FakeLLMProvider } from './llm/fake.js';

async function main() {
  const db = createDb();
  const repo = new DrizzleHealthGraphRepo(db);
  // Proveedor real se elige después (§18.7). El cliente fail-closed ya garantiza que
  // un proveedor "observe" sea seguro para arrancar (nunca emite lectura genérica).
  const provider = new FakeLLMProvider({ kind: 'observe' });

  const app = await buildServer({ repo, provider, logger: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
