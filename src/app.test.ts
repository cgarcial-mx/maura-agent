import { describe, expect, it } from 'vitest';
import { buildServer } from './app.js';
import { MemoryHealthGraphRepo } from './agent/repo-memory.js';
import { FakeLLMProvider } from './llm/fake.js';

const reading = {
  reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
  variable: 'energy',
  direction: 'drop',
  window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
};

describe('API Fastify (con repo en memoria)', () => {
  it('loop completo: crear usuaria → assessment → lectura → confirmar', async () => {
    const repo = new MemoryHealthGraphRepo();
    const provider = new FakeLLMProvider({ kind: 'reading', reading });
    const app = await buildServer({ repo, provider });

    const create = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { life_stage: 'peri_40_47' },
    });
    expect(create.statusCode).toBe(200);
    const { userId } = create.json();

    const assessment = await app.inject({
      method: 'POST',
      url: '/assessment',
      payload: { userId, responses: [{ signal_type: 'energy', value: 'baja' }] },
    });
    expect(assessment.statusCode).toBe(200);
    const body = assessment.json();
    expect(body.reading).not.toBeNull();
    const betId = body.reading.betId as string;
    expect(betId).toBeTruthy();
    expect(body.reading.variable).toBe('energy');

    const active = await app.inject({
      method: 'GET',
      url: `/users/${userId}/reading/active`,
    });
    expect(active.json().reading.betId).toBe(betId);

    const confirm = await app.inject({
      method: 'POST',
      url: '/confirmar',
      payload: { betId, result: 'yes' },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().patternStatus).toBe('promoted');
    expect(confirm.json().lesson).toBe('energy-drop');
  });

  it('LLM "observe" → "sigo observando" sin lectura', async () => {
    const repo = new MemoryHealthGraphRepo();
    const app = await buildServer({ repo, provider: new FakeLLMProvider({ kind: 'observe' }) });

    const { userId } = (await app.inject({ method: 'POST', url: '/users', payload: {} })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/assessment',
      payload: { userId, responses: [] },
    });
    expect(res.json().reading).toBeNull();
    expect(res.json().msg).toBe('Sigo observando');
  });

  it('usuaria inexistente → 404', async () => {
    const repo = new MemoryHealthGraphRepo();
    const app = await buildServer({ repo, provider: new FakeLLMProvider({ kind: 'observe' }) });
    const res = await app.inject({
      method: 'POST',
      url: '/assessment',
      payload: { userId: 'nope', responses: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('confirmar con resultado inválido → 400', async () => {
    const repo = new MemoryHealthGraphRepo();
    const provider = new FakeLLMProvider({ kind: 'reading', reading });
    const app = await buildServer({ repo, provider });

    const { userId } = (await app.inject({ method: 'POST', url: '/users', payload: {} })).json();
    const assessment = await app.inject({
      method: 'POST',
      url: '/assessment',
      payload: { userId, responses: [] },
    });
    const betId = assessment.json().reading.betId;

    const res = await app.inject({
      method: 'POST',
      url: '/confirmar',
      payload: { betId, result: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_result');
  });
});
