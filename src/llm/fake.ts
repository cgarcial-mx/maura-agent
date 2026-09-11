/**
 * Proveedores LLM de test: deterministas y controlables.
 */
import type { LLMProvider, ReadingProposal } from './provider.js';

/** Devuelve siempre la misma propuesta (por defecto "sigo observando"). */
export class FakeLLMProvider implements LLMProvider {
  readonly name = 'fake';
  constructor(private readonly proposal: ReadingProposal = { kind: 'observe' }) {}

  async proposeReading(): Promise<ReadingProposal> {
    return this.proposal;
  }
}

/** Devuelve las propuestas dadas en orden; la última se repite. */
export class ScriptedLLMProvider implements LLMProvider {
  readonly name = 'scripted';
  private i = 0;
  constructor(private readonly script: ReadingProposal[]) {}

  async proposeReading(): Promise<ReadingProposal> {
    const idx = Math.min(this.i, this.script.length - 1);
    this.i += 1;
    const next = this.script[idx];
    if (!next) return { kind: 'observe' };
    return next;
  }
}

/** Siempre falla (proveedor caído). */
export class FailingLLMProvider implements LLMProvider {
  readonly name = 'failing';
  async proposeReading(): Promise<ReadingProposal> {
    throw new Error('llm provider unavailable');
  }
}

/** Falla N veces y luego devuelve una propuesta. */
export class FlakyLLMProvider implements LLMProvider {
  readonly name = 'flaky';
  private failuresLeft: number;
  constructor(
    failures: number,
    private readonly proposal: ReadingProposal = { kind: 'observe' },
  ) {
    this.failuresLeft = failures;
  }

  async proposeReading(): Promise<ReadingProposal> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('transient failure');
    }
    return this.proposal;
  }
}

/** Tarda `delayMs` en responder. */
export class SlowLLMProvider implements LLMProvider {
  readonly name = 'slow';
  constructor(private readonly delayMs: number) {}

  async proposeReading(): Promise<ReadingProposal> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    return { kind: 'observe' };
  }
}
