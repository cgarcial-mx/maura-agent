/**
 * Cliente LLM fail-closed (PRD §13.2, AC13).
 *
 * Ante fallo del LLM — malformed, vacío, refusal, timeout o estructura inválida —
 * Maura responde "sigo observando": NO emite lectura y el motivo se registra para
 * el caller (error logging). Nunca degrada a una lectura genérica.
 *
 * Timeout duro (default 8s) + 1 reintento; si se agota, fail-closed. La conversación
 * nunca se cuelga.
 */
import { config } from '../config.js';
import type { AgentContext, LLMProvider, ReadingProposal } from './provider.js';

export type FailReason = 'timeout' | 'error' | 'malformed';

export interface ProposeResult {
  proposal: ReadingProposal;
  /** true cuando el LLM falló y se degradó a "sigo observando". */
  fellBack: boolean;
  reason?: FailReason;
}

class TimeoutError extends Error {
  readonly isTimeout = true;
  constructor() {
    super('llm timeout');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function isTimeout(err: unknown): boolean {
  return err instanceof TimeoutError;
}

function isValidProposal(p: unknown): p is ReadingProposal {
  if (typeof p !== 'object' || p === null) return false;
  const q = p as { kind?: unknown; reading?: unknown };
  if (q.kind === 'observe') return true;
  if (q.kind !== 'reading' || typeof q.reading !== 'object' || q.reading === null) {
    return false;
  }
  const r = q.reading as {
    reading_text?: unknown;
    variable?: unknown;
    direction?: unknown;
    window_spec?: unknown;
  };
  return (
    typeof r.reading_text === 'string' &&
    r.reading_text.trim().length > 0 &&
    typeof r.variable === 'string' &&
    typeof r.direction === 'string' &&
    typeof r.window_spec === 'object' &&
    r.window_spec !== null
  );
}

export interface FailClosedOptions {
  timeoutMs?: number;
  /** Reintentos tras el primer intento (default 1 → hasta 2 intentos). */
  retries?: number;
}

export async function proposeReadingFailClosed(
  provider: LLMProvider,
  context: AgentContext = {
    lifeStage: null,
    cycleAnchor: null,
    recentSignals: [],
  },
  opts: FailClosedOptions = {},
): Promise<ProposeResult> {
  const timeoutMs = opts.timeoutMs ?? config.llm.timeoutMs;
  const retries = opts.retries ?? 1;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const proposal = await withTimeout(provider.proposeReading(context), timeoutMs);
      if (!isValidProposal(proposal)) {
        return { proposal: { kind: 'observe' }, fellBack: true, reason: 'malformed' };
      }
      return { proposal, fellBack: false };
    } catch (err) {
      lastError = err;
    }
  }

  const reason: FailReason = isTimeout(lastError) ? 'timeout' : 'error';
  return { proposal: { kind: 'observe' }, fellBack: true, reason };
}
