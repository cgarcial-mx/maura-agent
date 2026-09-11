/**
 * Canal WhatsApp vía Meta Cloud API (PRD §13.2).
 *
 * - Envía mensajes de texto y el timbre de confirmación como mensaje interactivo
 *   (botones). La confirmación fuera de la ventana de 24h requiere plantilla aprobada
 *   (AC11); aquí se modela el envío interactivo (dentro de ventana) y se deja el
 *   envío de plantilla como método separado.
 * - El webhook (src/app.ts) recibe las respuestas de botón; el `id` de cada botón
 *   codifica `bet:{betId}:{result}`.
 */
import { config } from '../config.js';
import type { Channel, ConfirmationPrompt } from './channel.js';

const API = 'https://graph.facebook.com/v19.0';

export class WhatsAppChannel implements Channel {
  constructor(
    private readonly token: string = config.whatsapp.token,
    private readonly phoneNumberId: string = config.whatsapp.phoneNumberId,
  ) {}

  async sendConfirmationPrompt(phone: string, prompt: ConfirmationPrompt): Promise<boolean> {
    const results = ['yes', 'partial', 'no'] as const;
    const buttons = prompt.quickReplies.map((title, i) => ({
      type: 'reply',
      reply: { id: encodeConfirmationButtonId(prompt.betId, results[i]!), title },
    }));
    return this.sendJson(phone, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: prompt.text },
        action: { buttons },
      },
    });
  }

  async sendText(phone: string, text: string): Promise<boolean> {
    return this.sendJson(phone, { type: 'text', text: { body: text } });
  }

  private async sendJson(phone: string, message: Record<string, unknown>): Promise<boolean> {
    if (!this.token || !this.phoneNumberId) return false;
    const res = await fetch(`${API}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        ...message,
      }),
    });
    return res.ok;
  }
}

/** Codifica/decodifica el `id` de botón de confirmación. */
export function encodeConfirmationButtonId(betId: string, result: string): string {
  return `bet:${betId}:${result}`;
}

export function parseConfirmationButtonId(
  id: string,
): { betId: string; result: string } | null {
  const m = /^bet:([^:]+):(yes|partial|no)$/.exec(id);
  if (!m) return null;
  return { betId: m[1]!, result: m[2]! };
}
