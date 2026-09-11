/**
 * Abstracción de canal (PRD §13.2). Maura habla por canales (WhatsApp en el MVP);
 * el núcleo no se acopla a Meta. La confirmación proactiva se envía como mensaje
 * con acciones rápidas sí/más o menos/no; fuera de la ventana de 24h es plantilla
 * aprobada por Meta (dependencia dura, AC11).
 */
import type { Bet } from '../agent/repo.js';

export interface ConfirmationPrompt {
  betId: string;
  text: string;
  quickReplies: readonly ['Sí', 'Más o menos', 'No'];
}

export interface Channel {
  /** Envía el timbre de confirmación con acciones rápidas. Devuelve true si se envió. */
  sendConfirmationPrompt(phone: string, prompt: ConfirmationPrompt): Promise<boolean>;
  /** Envía texto plano. Devuelve true si se envió. */
  sendText(phone: string, text: string): Promise<boolean>;
}

/** Compone el mensaje del timbre a partir de la lectura (la lectura exacta viaja). */
export function buildConfirmationPrompt(bet: Bet): ConfirmationPrompt {
  return {
    betId: bet.id,
    text: `Te dije: «${bet.readingText}». ¿Pasó?`,
    quickReplies: ['Sí', 'Más o menos', 'No'],
  };
}
