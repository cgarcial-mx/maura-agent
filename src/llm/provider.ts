/**
 * Contrato del proveedor LLM (PRD §13.2, §18.4).
 *
 * El LLM actúa como stand-in del motor: propone una lectura (estructurada vía
 * function calling) o se abstiene ("sigo observando"). El sistema la valida
 * después (Safety + Falsability). Nunca decide el schema ni escribe a la DB.
 *
 * El proveedor se elige después (§18.7); el contrato de privacidad exigido
 * (zero-retention, no-training, DPA) se aplica al elegirlo.
 */
import type { WindowSpec } from '../domain/window-spec.js';

/** Estructura que propone el LLM. `window_spec` se valida estrictamente luego. */
export interface ProposedReading {
  reading_text: string;
  variable: string;
  direction: string;
  window_spec: unknown;
}

export type ReadingProposal =
  | { kind: 'reading'; reading: ProposedReading }
  | { kind: 'observe' }; // "sigo observando": no hay señal suficiente

export interface LLMProvider {
  readonly name: string;
  /**
   * Dado el contexto (señales/historial minimizado y pseudonimizado), propone una
   * lectura o se abstiene. Nunca recibe identidad (`users.id`, teléfono, email).
   */
  proposeReading(context: unknown): Promise<ReadingProposal>;
}

/** Forma reexportada para conveniencia del tool-calling (no la usa la DB). */
export type { WindowSpec };
