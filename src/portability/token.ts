/**
 * Token de portabilidad/borrado firmado (HMAC-SHA256), sin estado ni tabla extra.
 *
 * Formato: `base64url(payload).base64url(signature)`, payload = { userId, exp }.
 * - `issueToken`: lo genera el servidor (Maura envía el enlace por canal).
 * - `verifyToken`: verifica firma, integridad y expiración. Devuelve `userId` o null.
 *
 * Sin `secret` configurado, `issueToken`/`verifyToken` fallan cerrado.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEP = '.';

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}

function unb64url(s: string): string {
  return Buffer.from(s, 'base64url').toString();
}

export const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export function issueToken(
  userId: string,
  secret: string,
  ttlMs: number = DEFAULT_TOKEN_TTL_MS,
): string {
  if (!secret) throw new Error('PORTABILITY_SECRET no configurado');
  const payload = { userId, exp: Date.now() + ttlMs };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}${SEP}${sig}`;
}

export function verifyToken(token: string, secret: string): { userId: string } | null {
  if (!secret) return null;
  const idx = token.indexOf(SEP);
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: { userId?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(unb64url(body));
  } catch {
    return null;
  }
  if (typeof payload.userId !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return { userId: payload.userId };
}
