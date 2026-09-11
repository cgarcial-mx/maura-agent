import { describe, expect, it } from 'vitest';
import { buildServer } from './app.js';
import { MemoryHealthGraphRepo } from './agent/repo-memory.js';
import { MemoryChannel } from './channel/memory.js';
import { FakeLLMProvider } from './llm/fake.js';

const reading = {
  reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
  variable: 'energy',
  direction: 'drop',
  window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
};

const VERIFY_TOKEN = 'secret-verify';

function whatsappPayload(betId: string, result: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              messages: [
                {
                  from: '5215550000000',
                  type: 'interactive',
                  interactive: {
                    type: 'button_reply',
                    button_reply: { id: `bet:${betId}:${result}`, title: 'Sí' },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('Webhook WhatsApp', () => {
  it('verifica el webhook con el token correcto', async () => {
    const repo = new MemoryHealthGraphRepo();
    const app = await buildServer({
      repo,
      provider: new FakeLLMProvider({ kind: 'observe' }),
      whatsapp: { verifyToken: VERIFY_TOKEN, channel: new MemoryChannel() },
    });

    const ok = await app.inject({
      method: 'GET',
      url: `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
  });

  it('rechaza el webhook con token incorrecto', async () => {
    const repo = new MemoryHealthGraphRepo();
    const app = await buildServer({
      repo,
      provider: new FakeLLMProvider({ kind: 'observe' }),
      whatsapp: { verifyToken: VERIFY_TOKEN, channel: new MemoryChannel() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1',
    });
    expect(res.statusCode).toBe(403);
  });

  it('procesa el botón de confirmación y responde', async () => {
    const repo = new MemoryHealthGraphRepo();
    const channel = new MemoryChannel();
    const app = await buildServer({
      repo,
      provider: new FakeLLMProvider({ kind: 'reading', reading }),
      whatsapp: { verifyToken: VERIFY_TOKEN, channel },
    });

    const { userId } = (await app.inject({ method: 'POST', url: '/users', payload: {} })).json();
    const assessment = await app.inject({
      method: 'POST',
      url: '/assessment',
      payload: { userId, responses: [] },
    });
    const betId = assessment.json().reading.betId as string;

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      payload: whatsappPayload(betId, 'yes'),
    });
    expect(res.statusCode).toBe(200);

    const bet = await repo.getBet(betId);
    expect(bet?.result).toBe('yes');
    expect(channel.sent.some((m) => m.text.includes('Gracias por confirmar'))).toBe(true);
  });
});
