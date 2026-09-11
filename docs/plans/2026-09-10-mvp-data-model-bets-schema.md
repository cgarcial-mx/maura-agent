# MVP Data Model: schema `bets`-shaped + Health Graph

Status: Draft
Date: 2026-09-10
Owner: CEO + CTO
Relates: `decisions/2026-09-10-agente-whatsapp-mvp-motor-largo-plazo.md`

## Proposito

Fijar el modelo de datos del MVP agentico (WhatsApp + LLM stand-in) de modo que cada confirmacion de la usuaria llene, desde el dia 1, la tabla que el futuro motor hibrido va a consumir. Este documento es el contrato de forward-compatibility: si se respeta, el motor se construye sobre datos propios; si no, se construye sobre aire.

## Principios (no negociables)

1. **Dos capas**: identificable (users) y patron (todo lo demas referenciando `pseudonym`). Nunca se mezclan en analitica.
2. **`bets` es append-only**. Es el activo. No se actualiza ni se borra una lectura emitida.
3. **`engine_version` en cada lectura**. Distingue que logica la genero.
4. **Toda confirmacion nace falsable** (especifica + fechada) o no se guarda como bet. Se impone en el validador, no en la buena voluntad del LLM.
5. **El LLM redacta, no decide el schema**. El modelo produce lenguaje; el sistema extrae y valida la estructura antes de persistir.

## Capa 1: identificable

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    whatsapp_phone  TEXT UNIQUE,          -- canal MVP
    life_stage      TEXT,                 -- 'peri_40_47', 'reproductive', 'post_dx', ...
    has_diagnosis   BOOLEAN DEFAULT FALSE,
    diagnosis_notes TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
```

`pseudonym` es el unico enlace entre la capa identificable y la de patron. El borrado real de `users` rompe el `pseudonym` en `bets` conservando el valor agregado sin reidentificar.

## Capa 2: patron (referencia `pseudonym`)

### Health Graph — senales y eventos

```sql
CREATE TABLE signals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym    UUID NOT NULL,
    signal_type  TEXT NOT NULL,   -- 'energy','sleep','mood','pain','cycle',...
    value        TEXT,            -- numerico o categorico, flexible en MVP
    unit         TEXT,
    cycle_day    INTEGER,
    context      JSONB,           -- condicion opcional ("dormi mal antes")
    source       TEXT NOT NULL,   -- 'check_in','conversation','proactive'
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cycle_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym   UUID NOT NULL,
    event_type  TEXT NOT NULL,    -- 'period_start','period_end',...
    event_date  DATE NOT NULL,
    source      TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Patrones (la creencia acumulada)

```sql
CREATE TABLE patterns (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym    UUID NOT NULL,
    variable     TEXT NOT NULL,          -- 'energy','sleep','mood','pain'
    direction    TEXT NOT NULL,          -- 'drop','rise','spike'
    window_spec  JSONB NOT NULL,         -- forma estricta, ver seccion "window_spec estricto"
    belief       NUMERIC NOT NULL DEFAULT 0.5,
    specificity  NUMERIC NOT NULL DEFAULT 0.0,
    status       TEXT NOT NULL DEFAULT 'candidate',  -- candidate|active|promoted|discarded
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### bets — el activo (append-only)

```sql
CREATE TABLE bets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym         UUID NOT NULL,
    pattern_id        UUID REFERENCES patterns(id),
    reading_text      TEXT NOT NULL,     -- string humano (redaccion del LLM)
    variable          TEXT NOT NULL,
    direction         TEXT NOT NULL,
    window_spec       JSONB NOT NULL,     -- misma forma estricta que patterns.window_spec
    predicted_date    DATE NOT NULL,     -- cuando se pregunta "acerto?"
    result            TEXT,              -- 'yes'|'partial'|'no'|NULL (pendiente)
    confirmed_at      TIMESTAMPTZ,
    belief_prior      NUMERIC NOT NULL,
    belief_posterior  NUMERIC,
    engine_version    TEXT NOT NULL,     -- 'llm-mvp-0.1' | 'motor-v1.0'
    generator         TEXT NOT NULL,     -- 'llm' | 'motor' | 'manual'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bet_confirmations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bet_id       UUID NOT NULL REFERENCES bets(id),
    result       TEXT NOT NULL,          -- 'yes'|'partial'|'no'
    source       TEXT NOT NULL,          -- 'whatsapp','web','push'
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Indices minimos:

```sql
CREATE INDEX idx_bets_pseudonym       ON bets(pseudonym);
CREATE INDEX idx_bets_predicted_date  ON bets(predicted_date) WHERE result IS NULL;
CREATE INDEX idx_signals_pseudonym    ON signals(pseudonym);
CREATE INDEX idx_patterns_pseudonym   ON patterns(pseudonym);
```

### Memoria (corto y largo plazo)

```sql
CREATE TABLE memory_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym      UUID NOT NULL,
    kind           TEXT NOT NULL,       -- 'fact','preference','pattern_summary','intention'
    content        TEXT NOT NULL,
    source_bet_id  UUID,                -- trazabilidad opcional a una lectura
    status         TEXT NOT NULL DEFAULT 'active',  -- active|superseded|deleted
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

La memoria es explicita, limitada, editable y borrable. No todo lo que dice la usuaria se vuelve memoria permanente: entra solo lo que supera el umbral de utilidad futura.

### Educacion (anclada a confirmacion)

```sql
CREATE TABLE lessons_delivered (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym   UUID NOT NULL,
    lesson_key  TEXT NOT NULL,
    bet_id      UUID,                   -- regla: no hay microleccion sin lectura verificada
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Ciclo de vida de una lectura (LLM stand-in)

```text
conversacion
  └─ LLM propone una lectura
       └─ validador extrae {variable, direction, window_spec, predicted_date}
            ├─ OK + eval de falsabilidad pasa ──▶ INSERT bets (engine_version='llm-mvp-0.1', generator='llm')
            │                                        └─ programar confirmacion (WhatsApp) en predicted_date
            │                                             └─ usuaria responde yes/partial/no
            │                                                  └─ INSERT bet_confirmations + update pattern.belief
            │                                                       └─ reward: lesson + update Mapa
            └─ NO se puede estructurar o no es falsable ──▶ es chat, no bet (no se guarda)
```

Punto critico: si el LLM dice "tu energia varia", el validador no puede extraer una ventana con fecha, y no se persiste. Solo lo que puede fallar con fecha se convierte en dato de oro.

## Convencion de `engine_version`

| Version | Significado |
| --- | --- |
| `llm-mvp-0.x` | La lectura la genero el LLM stand-in durante el MVP |
| `manual-0.x` | Lectura emitida a mano en Fase 0 (validacion con 5 usuarias) |
| `motor-v1.0` | La lectura la genero el motor hibrido |

Esto permite, el dia que exista el motor, comparar la tasa de confirmacion de `llm-mvp` contra `motor-v1` sobre los mismos datos. Es un eval gratuito de la transicion.

## Privacidad, retencion y borrado

- Nunca `JOIN users ↔ bets` en analitica. El puente es `pseudonym`.
- Borrado de cuenta: marcar `users.deleted_at`, romper el `pseudonym` en `bets` (conserva el agregado), borrar `memory_entries` y `signals` segun politica de retencion.
- Retencion minima: `signals` y `conversations` retenibles; `bets` conserva el par verificado agregado (anonimo) aunque se borre la identidad.
- El LLM recibe solo el contexto necesario (age_group, ciclo relevante, sintomas relevantes, memoria relevante, conversacion actual). Nunca el perfil completo ni todo el historial.

## window_spec estricto

Decidido: tipado estricto, no texto libre. El validador lo impone; la DB solo guarda.

```jsonc
// kind determina la interpretacion de start/end
{
  "kind": "cycle_days",        // 'cycle_days' | 'weekdays'
  "start": "22",               // cycle_days: numero de dia del ciclo; weekdays: 'mon'..'sun'
  "end": "26",
  "condition": "dormiste mal"  // opcional, vocabulario controlado
}
```

- `kind` ∈ {`cycle_days`, `weekdays`}. Cualquier otra cosa el validador la rechaza.
- `start`/`end` con tipo segun `kind`; si `kind=cycle_days`, son enteros en rango 1..35; si `kind=weekdays`, abreviaturas de 3 letras.
- `condition` es opcional y usa un vocabulario controlado (la lista exacta se define con los evals). No es campo de texto libre.

Esto es lo que el motor podra consumir sin parsear lenguaje natural. El `reading_text` humano vive aparte; `window_spec` es la version maquina.

## Retencion (recomendada, decidida)

- Cuenta activa: los datos se conservan indefinidamente; son el activo longitudinal.
- Cuenta borrada (marcar `users.deleted_at`, luego):
  - `users`: anonimizado o borrado tras periodo de gracia (30 dias).
  - `memory_entries`, `signals`, `cycle_events`, `lessons_delivered`: borrados (personales).
  - `bets`, `bet_confirmations`: se rompe el enlace a `pseudonym` y se conservan como agregado anonimo. Es la unica capa que sobrevive y es el moat.
- Los logs de aplicacion, analytics, error trackers y debugging **nunca** guardan conversaciones sensibles. Solo eventos de comportamiento ("check_in_completed", "symptom_logged").

## Decisiones cerradas

1. `window_spec` → **estricto** (seccion dedicada arriba).
2. `signals.value` → **TEXT** flexible (acepta "bajo/medio/alto" y numerico como string).
3. `belief`/`specificity` → **se actualizan en el MVP**. `belief` con la formula bayesiana simple (likelihood yes=0.85, partial=0.55, no=0.20) sobre cada confirmacion; `specificity` como heuristica en el validador (es el gate anti-generico). No se congelan.
4. Retencion → **la recomendada** (seccion dedicada arriba).

## Siguiente paso

Evals: el conjunto de tests que valida (a) calidad, (b) safety (no diagnostico) y (c) falsabilidad (especifico + fechado). Se escriben contra este schema: el eval de falsabilidad es el que decide si una salida del LLM se persiste como `bet` o no.
