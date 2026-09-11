import { describe, expect, it } from 'vitest';
import { proposeReadingFailClosed } from './client.js';
import {
  FakeLLMProvider,
  FailingLLMProvider,
  FlakyLLMProvider,
  SlowLLMProvider,
} from './fake.js';

const reading = {
  reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
  variable: 'energy',
  direction: 'drop',
  window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
};

describe('LLM client fail-closed', () => {
  it('proveedor sano → propuesta sin fallback', async () => {
    const r = await proposeReadingFailClosed(new FakeLLMProvider({ kind: 'reading', reading }));
    expect(r.fellBack).toBe(false);
    expect(r.proposal.kind).toBe('reading');
  });

  it('proveedor caído → "sigo observando" con reason error', async () => {
    const r = await proposeReadingFailClosed(new FailingLLMProvider());
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBe('error');
    expect(r.proposal).toEqual({ kind: 'observe' });
  });

  it('timeout → "sigo observando" con reason timeout', async () => {
    const r = await proposeReadingFailClosed(new SlowLLMProvider(200), undefined, {
      timeoutMs: 20,
      retries: 0,
    });
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBe('timeout');
  });

  it('respuesta malformada → reason malformed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = new FakeLLMProvider({ kind: 'reading', reading: { reading_text: '' } } as any);
    const r = await proposeReadingFailClosed(bad);
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBe('malformed');
  });

  it('reintenta una vez y recupera', async () => {
    const r = await proposeReadingFailClosed(
      new FlakyLLMProvider(1, { kind: 'reading', reading }),
      { retries: 1 },
    );
    expect(r.fellBack).toBe(false);
    expect(r.proposal.kind).toBe('reading');
  });

  it('no reintenta indefinidamente', async () => {
    const r = await proposeReadingFailClosed(new FailingLLMProvider(), { retries: 2 });
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBe('error');
  });
});
