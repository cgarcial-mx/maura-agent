/**
 * Canal en memoria para tests: registra los envíos y siempre "envía" con éxito.
 */
import type { Channel, ConfirmationPrompt } from './channel.js';

export interface SentMessage {
  phone: string;
  kind: 'confirmation' | 'text';
  text: string;
  quickReplies?: readonly string[];
}

export class MemoryChannel implements Channel {
  readonly sent: SentMessage[] = [];

  async sendConfirmationPrompt(phone: string, prompt: ConfirmationPrompt): Promise<boolean> {
    this.sent.push({
      phone,
      kind: 'confirmation',
      text: prompt.text,
      quickReplies: prompt.quickReplies,
    });
    return true;
  }

  async sendText(phone: string, text: string): Promise<boolean> {
    this.sent.push({ phone, kind: 'text', text });
    return true;
  }
}
