/**
 * Página de portabilidad/borrado self-service (patrón "unsubscribe").
 * Se sirve desde el propio servidor del agente; la usuaria exporta o borra sus datos.
 */

export function renderPortabilityPage(token: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Maura — Tus datos</title>
  <style>
    :root { color-scheme: light; --fg: #1b1b1f; --muted: #5f5f6b; --accent: #b3445f; --line: #e7e3ea; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: #faf7f9; }
    main { max-width: 34rem; margin: 4rem auto; padding: 0 1.25rem; }
    h1 { font-size: 1.5rem; font-weight: 650; }
    p { color: var(--muted); line-height: 1.6; }
    .card { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 1.5rem; margin-top: 1.25rem; }
    .card h2 { font-size: 1.05rem; margin: 0 0 .4rem; }
    button { display: block; width: 100%; margin-top: 1rem; padding: .8rem 1rem; font-size: .95rem; font-weight: 600; border-radius: 10px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.danger { color: var(--accent); border-color: var(--accent); }
    .muted { color: var(--muted); font-size: .85rem; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <main>
    <h1>Tus datos, en tus manos</h1>
    <p>Aquí puedes descargar todo lo que Maura sabe de ti o pedir que borremos tu cuenta.</p>

    <div class="card">
      <h2>Descargar mis datos</h2>
      <p class="muted">Un archivo con tu historial: señales, ciclo, patrones y lecturas.</p>
      <form method="post" action="/portabilidad/${token}/exportar">
        <button class="primary" type="submit">Descargar mis datos</button>
      </form>
    </div>

    <div class="card">
      <h2>Borrar mi cuenta</h2>
      <p class="muted">Esto es definitivo. Conservaremos solo agregados anónimos que ya no pueden asociarse a ti.</p>
      <form method="post" action="/portabilidad/${token}/borrar" onsubmit="return confirm('¿Seguro que quieres borrar tu cuenta? Esta acción no se puede deshacer.');">
        <button class="danger" type="submit">Borrar mi cuenta</button>
      </form>
    </div>
  </main>
</body>
</html>`;
}
