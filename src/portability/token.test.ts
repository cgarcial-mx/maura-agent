import { describe, expect, it } from 'vitest';
import { issueToken, verifyToken } from './token.js';

const SECRET = 'test-secret';

describe('token de portabilidad', () => {
  it('emite y verifica un token válido', () => {
    const token = issueToken('user-1', SECRET);
    expect(verifyToken(token, SECRET)).toEqual({ userId: 'user-1' });
  });

  it('rechaza un token manipulado', () => {
    const token = issueToken('user-1', SECRET);
    const tampered = `${token.slice(0, -2)}ab`;
    expect(verifyToken(tampered, SECRET)).toBeNull();
  });

  it('rechaza un token firmado con otro secreto', () => {
    const token = issueToken('user-1', SECRET);
    expect(verifyToken(token, 'otro-secreto')).toBeNull();
  });

  it('rechaza un token expirado', () => {
    const token = issueToken('user-1', SECRET, -1000);
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('falla cerrado sin secreto', () => {
    expect(() => issueToken('user-1', '')).toThrow();
    expect(verifyToken('cualquier-cosa', '')).toBeNull();
  });
});
