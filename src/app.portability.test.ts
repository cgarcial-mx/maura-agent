import { describe, expect, it } from 'vitest';
import { buildServer } from './app.js';
import { MemoryHealthGraphRepo } from './agent/repo-memory.js';
import { FakeLLMProvider } from './llm/fake.js';
import { issueToken } from './portability/token.js';

const SECRET = 'portability-secret';

describe('Portabilidad / borrado self-service', () => {
  async function setup() {
    const repo = new MemoryHealthGraphRepo();
    const app = await buildServer({
      repo,
      provider: new FakeLLMProvider({ kind: 'observe' }),
      portability: { secret: SECRET },
    });
    const { userId } = (await app.inject({ method: 'POST', url: '/users', payload: {} })).json();
    return { repo, app, userId: userId as string };
  }

  it('genera un enlace y sirve la página', async () => {
    const { app, userId } = await setup();

    const link = await app.inject({
      method: 'POST',
      url: `/users/${userId}/portabilidad`,
    });
    expect(link.statusCode).toBe(200);
    const url = link.json().url as string;
    expect(url).toContain('/portabilidad/');

    const token = url.split('/portabilidad/')[1]!;
    const page = await app.inject({ method: 'GET', url: `/portabilidad/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('Descargar mis datos');
    expect(page.body).toContain('Borrar mi cuenta');
  });

  it('rechaza un token inválido', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/portabilidad/basura' });
    expect(res.statusCode).toBe(403);
  });

  it('exporta los datos de la usuaria', async () => {
    const { app, userId } = await setup();
    const token = issueToken(userId, SECRET);

    const res = await app.inject({ method: 'POST', url: `/portabilidad/${token}/exportar` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('maura-datos.json');
    const data = res.json();
    expect(data).toHaveProperty('signals');
    expect(data).toHaveProperty('bets');
    expect(data).toHaveProperty('profile');
  });

  it('borrar marca la cuenta (soft-delete)', async () => {
    const { app, repo, userId } = await setup();
    const token = issueToken(userId, SECRET);

    const res = await app.inject({ method: 'POST', url: `/portabilidad/${token}/borrar` });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain('borrado');

    const user = await repo.getUserById(userId);
    expect(user?.deletedAt).not.toBeNull();
  });
});
