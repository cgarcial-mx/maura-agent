import { describe, expect, it } from 'vitest';
import { generateReading } from '../agent/orchestrator.js';
import { MemoryHealthGraphRepo } from '../agent/repo-memory.js';
import { proposeReadingFailClosed } from './client.js';
import { DeepSeekProvider } from './deepseek.js';
import type { AgentContext } from './provider.js';

const context: AgentContext = {
  lifeStage: 'peri_40_47',
  cycleAnchor: '2026-09-01',
  recentSignals: [{ signalType: 'energy', value: 'baja', recordedAt: '2026-09-10T08:00:00.000Z' }],
};

const readingJson = {
  kind: 'reading',
  reading: {
    reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
    variable: 'energy',
    direction: 'drop',
    window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
  },
};

function deepseekResponse(content: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

function providerWith(body: Response) {
  return new DeepSeekProvider({
    apiKey: 'test-key',
    fetchImpl: (async () => body) as unknown as typeof fetch,
  });
}

describe('DeepSeekProvider', () => {
  it('parsea una lectura válida', async () => {
    const provider = providerWith(deepseekResponse(JSON.stringify(readingJson)));
    const r = await provider.proposeReading(context);
    expect(r).toEqual(readingJson);
  });

  it('parsea una abstención (observe)', async () => {
    const provider = providerWith(deepseekResponse(JSON.stringify({ kind: 'observe' })));
    const r = await provider.proposeReading(context);
    expect(r).toEqual({ kind: 'observe' });
  });

  it('lanza ante HTTP no-ok', async () => {
    const provider = providerWith(deepseekResponse('{}', 500));
    await expect(provider.proposeReading(context)).rejects.toThrow();
  });

  it('lanza ante content no-JSON', async () => {
    const provider = providerWith(deepseekResponse('esto no es json'));
    await expect(provider.proposeReading(context)).rejects.toThrow();
  });

  it('envía la petición con el modelo y Authorization correctos', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const provider = new DeepSeekProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      fetchImpl: (async (url: unknown, init?: RequestInit) => {
        captured = { url: url as string, init: init! };
        return deepseekResponse(JSON.stringify(readingJson));
      }) as unknown as typeof fetch,
    });
    await provider.proposeReading(context);

    expect(captured?.url).toContain('/chat/completions');
    expect(captured?.init.method).toBe('POST');
    expect((captured?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key',
    );
    const body = JSON.parse(captured!.init.body as string);
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
});

describe('DeepSeekProvider bajo el cliente fail-closed', () => {
  it('lectura válida → passthrough', async () => {
    const provider = providerWith(deepseekResponse(JSON.stringify(readingJson)));
    const r = await proposeReadingFailClosed(provider, context);
    expect(r.fellBack).toBe(false);
    expect(r.proposal.kind).toBe('reading');
  });

  it('respuesta malformada → "sigo observando" (malformed)', async () => {
    // Forma no válida según isValidProposal (reading sin window_spec).
    const bad = { kind: 'reading', reading: { reading_text: 'hola' } };
    const provider = providerWith(deepseekResponse(JSON.stringify(bad)));
    const r = await proposeReadingFailClosed(provider, context);
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBe('malformed');
    expect(r.proposal).toEqual({ kind: 'observe' });
  });

  it('error HTTP → "sigo observando" (error)', async () => {
    const provider = providerWith(deepseekResponse('{}', 401));
    const r = await proposeReadingFailClosed(provider, context, { retries: 0 });
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBe('error');
  });
});

describe('loop completo con DeepSeek (mock) → orquestador → bet', () => {
  it('una lectura válida del modelo se persiste como bet', async () => {
    const repo = new MemoryHealthGraphRepo();
    const { pseudonym } = await repo.createUser({ lifeStage: 'peri_40_47' });
    const provider = providerWith(deepseekResponse(JSON.stringify(readingJson)));

    const result = await generateReading(repo, provider, pseudonym, {
      today: new Date('2026-09-11T00:00:00.000Z'),
    });

    expect(result.reading).not.toBeNull();
    expect(repo.betCount).toBe(1);
    if (!result.reading) return;
    expect(result.reading.variable).toBe('energy');
    expect(repo.getPattern(result.reading.patternId!)?.status).toBe('candidate');
  });

  it('un modelo que se abstiene no crea bet', async () => {
    const repo = new MemoryHealthGraphRepo();
    const { pseudonym } = await repo.createUser({});
    const provider = providerWith(deepseekResponse(JSON.stringify({ kind: 'observe' })));

    const result = await generateReading(repo, provider, pseudonym);
    expect(result.reading).toBeNull();
    expect(repo.betCount).toBe(0);
  });
});
