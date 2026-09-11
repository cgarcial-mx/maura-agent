/**
 * Servidor Fastify (PRD §13.1). Expone la API HTTP del MVP; el canal WhatsApp
 * (webhook) se añade encima de esta capa.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { generateReading } from './agent/orchestrator.js';
import type { Bet, HealthGraphRepo } from './agent/repo.js';
import { confirmReading, logSymptom, ToolError } from './agent/tools.js';
import type { Channel } from './channel/channel.js';
import { parseConfirmationButtonId } from './channel/whatsapp.js';
import type { LLMProvider } from './llm/provider.js';

export interface BuildServerOptions {
  repo: HealthGraphRepo;
  provider: LLMProvider;
  logger?: boolean;
  whatsapp?: {
    verifyToken: string;
    channel: Channel;
  };
}

interface AssessmentBody {
  userId: string;
  responses?: { signal_type: string; value: string }[];
}

interface IncomingWhatsAppMessage {
  from: string;
  type: string;
  buttonReplyId?: string;
  text?: string;
}

function parseWhatsAppMessages(body: unknown): IncomingWhatsAppMessage[] {
  const messages: IncomingWhatsAppMessage[] = [];
  const entries = (body as { entry?: { changes?: { value?: { messages?: unknown[] } }[] }[] })
    ?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const msg of (change.value?.messages ?? []) as Array<Record<string, unknown>>) {
        const from = typeof msg.from === 'string' ? msg.from : '';
        const interactive = msg.interactive as { type?: string; button_reply?: { id?: string } };
        if (msg.type === 'interactive' && interactive?.type === 'button_reply') {
          messages.push({
            from,
            type: 'interactive',
            buttonReplyId: interactive.button_reply?.id,
          });
        } else if (msg.type === 'text') {
          const textBody = msg.text as { body?: string };
          messages.push({ from, type: 'text', text: textBody?.body });
        }
      }
    }
  }
  return messages;
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

  // Webhook de WhatsApp (PRD §13.2): verificación + mensajes entrantes.
  if (opts.whatsapp) {
    const { verifyToken, channel } = opts.whatsapp;

    app.get('/webhook/whatsapp', async (req, reply) => {
      const q = req.query as {
        'hub.mode'?: string;
        'hub.verify_token'?: string;
        'hub.challenge'?: string;
      };
      if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verifyToken) {
        return reply.type('text/plain').send(q['hub.challenge'] ?? 'ok');
      }
      return reply.code(403).send({ error: 'forbidden' });
    });

    app.post('/webhook/whatsapp', async (req) => {
      const messages = parseWhatsAppMessages(req.body);
      for (const msg of messages) {
        // Respuesta de botón de confirmación (sí / más o menos / no).
        if (msg.buttonReplyId) {
          const parsed = parseConfirmationButtonId(msg.buttonReplyId);
          if (parsed && msg.from) {
            const r = await confirmReading(repo, {
              betId: parsed.betId,
              result: parsed.result,
              source: 'whatsapp',
            });
            if (r.ok) {
              await channel.sendText(
                msg.from,
                'Gracias por confirmar. Sigo aprendiendo de ti.',
              );
            }
          }
        }
        // Mensajes de texto: la conversación se conecta en Fase 2.
      }
      return { status: 'received' };
    });
  }

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
