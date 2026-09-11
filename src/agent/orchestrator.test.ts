import { describe, expect, it } from 'vitest';
import { MemoryHealthGraphRepo } from './repo-memory.js';
import { generateReading } from './orchestrator.js';
import { FakeLLMProvider, FailingLLMProvider } from '../llm/fake.js';

const PSEUDONYM = 'pseudo-1';
const reading = {
  reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
  variable: 'energy',
  direction: 'drop',
  window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
};

describe('generateReading (orquestador)', () => {
  it('LLM propone lectura válida → bet persistido', async () => {
    const repo = new MemoryHealthGraphRepo();
    const r = await generateReading(
      repo,
      new FakeLLMProvider({ kind: 'reading', reading }),
      PSEUDONYM,
      { today: new Date('2026-09-11T00:00:00.000Z') },
    );
    expect(r.reading).not.toBeNull();
    expect(repo.betCount).toBe(1);
  });

  it('LLM se abstiene → "sigo observando"', async () => {
    const repo = new MemoryHealthGraphRepo();
    const r = await generateReading(
      repo,
      new FakeLLMProvider({ kind: 'observe' }),
      PSEUDONYM,
    );
    expect(r.reading).toBeNull();
    if (!r.reading) expect(r.msg).toBe('Sigo observando');
    expect(repo.betCount).toBe(0);
  });

  it('LLM falla → fail-closed "sigo observando" con reason', async () => {
    const repo = new MemoryHealthGraphRepo();
    const r = await generateReading(repo, new FailingLLMProvider(), PSEUDONYM);
    expect(r.reading).toBeNull();
    if (!r.reading) {
      expect(r.fellBack).toBe(true);
      expect(r.reason).toBe('error');
    }
    expect(repo.betCount).toBe(0);
  });

  it('LLM propone lectura genérica → safety/falsability la descartan', async () => {
    const repo = new MemoryHealthGraphRepo();
    const r = await generateReading(
      repo,
      new FakeLLMProvider({
        kind: 'reading',
        reading: {
          reading_text: 'Tu energía varía según el día.',
          variable: 'energy',
          direction: 'improve',
          window_spec: { kind: 'weekdays', start: 'mon', end: 'sun' },
        },
      }),
      PSEUDONYM,
      { today: new Date('2026-09-11T00:00:00.000Z') },
    );
    expect(r.reading).toBeNull();
    expect(repo.betCount).toBe(0);
  });
});
