/**
 * Servidor Fastify (PRD §13.1). Expone la API HTTP del MVP; el canal WhatsApp
 * (webhook) se añade encima de esta capa.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { generateReading } from './agent/orchestrator.js';
import type { Bet, HealthGraphRepo } from './agent/repo.js';
import { confirmReading, logSymptom, ToolError } from './agent/tools.js';
import type { LLMProvider } from './llm/provider.js';

export interface BuildServerOptions {
  repo: HealthGraphRepo;
  provider: LLMProvider;
  logger?: boolean;
}

interface AssessmentBody {
  userId: string;
  responses?: { signal_type: string; value: string }[];
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const { repo, provider } = opts;

  app.get('/health', async () => ({ status: 'ok' }));

  // Crear usuaria (onboarding): pseudonym generado server-side, nunca expuesto.
  app.post('/users', async (req) => {
    const body = req.body as { life_stage?: string; has_diagnosis?: boolean };
    const user = await repo.createUser({
      lifeStage: body.life_stage ?? null,
      hasDiagnosis: body.has_diagnosis ?? false,
    });
    return { userId: user.id };
  });

  // Assessment conversacional: guarda señales y genera la primera lectura.
  app.post('/assessment', async (req, reply) => {
    const body = req.body as AssessmentBody;
    const pseudonym = await repo.getPseudonymByUserId(body.userId);
    if (!pseudonym) return reply.code(404).send({ error: 'user_not_found' });

    try {
      for (const r of body.responses ?? []) {
        await logSymptom(repo, pseudonym, r.signal_type, r.value, 'assessment');
      }
    } catch (err) {
      if (err instanceof ToolError) return reply.code(400).send({ error: err.message });
      throw err;
    }

    const result = await generateReading(repo, provider, pseudonym);
    if (!result.reading) {
      return {
        reading: null,
        msg: result.msg,
        ...(result.fellBack ? { fellBack: result.fellBack, reason: result.reason } : {}),
      };
    }
    return { reading: toReadingPayload(result.reading) };
  });

  // Lectura activa o confirmación pendiente.
  app.get('/users/:userId/reading/active', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const pseudonym = await repo.getPseudonymByUserId(userId);
    if (!pseudonym) return reply.code(404).send({ error: 'user_not_found' });
    const bet = await repo.getPendingBet(pseudonym);
    return { reading: bet ? toReadingPayload(bet) : null };
  });

  // El dato de oro: confirmación de lectura.
  app.post('/confirmar', async (req, reply) => {
    const body = req.body as { betId: string; result: string };
    const result = await confirmReading(repo, { betId: body.betId, result: body.result });
    if (!result.ok) {
      const code = result.reason === 'bet_not_found' ? 404 : 400;
      return reply.code(code).send({ error: result.reason });
    }
    return {
      message: 'Gracias por confirmar',
      lesson: result.lessonKey,
      patternStatus: result.status,
      corrected: result.corrected,
    };
  });

  return app;
}

function toReadingPayload(bet: Bet) {
  return {
    betId: bet.id,
    reading: bet.readingText,
    predictedDate: bet.predictedDate,
    variable: bet.variable,
    direction: bet.direction,
    result: bet.result,
  };
}
