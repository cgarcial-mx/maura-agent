# MVP Agent Tools: mapping al schema

Status: Draft
Date: 2026-09-10
Owner: CEO + CTO
Relates: `2026-09-10-mvp-data-model-bets-schema.md`, `2026-09-10-mvp-evals.md`

## Proposito

Mapear las tools del agente (del documento Maura 2.0, seccion 8) al schema. Las tools son el unico camino de escritura: el LLM nunca toca la base de datos directamente. Todo pasa por tools con validacion, autorizacion, schema y reglas de safety.

## Principio

```text
LLM  ──tool call──▶  API/tool layer  ──validacion + safety──▶  DB
        (nunca SQL directo)
```

- El LLM tiene una lista blanca de tools. No puede inventar queries.
- Cada tool resuelve `pseudonym` server-side desde la sesion autenticada. El LLM **nunca** ve `users.id` ni `whatsapp_phone`.
- Las tools de lectura devuelven contexto minimizado y pseudonimizado (age_group, no edad exacta; senales relevantes, no todo el historial).

## Mapping completo

| Tool (2.0) | Destino schema | R/W | Notas |
| --- | --- | --- | --- |
| `get_user_profile()` | `users` | R | Solo `life_stage`, `has_diagnosis`, `diagnosis_notes`. Sin id, telefono ni email |
| `update_user_profile(fields)` | `users` | W | Solo campos permitidos: `life_stage`, `has_diagnosis`. Nunca identidad |
| `get_cycle()` | `cycle_events` | R | Ultimos eventos de periodo |
| `get_cycle_prediction()` | derivado de `cycle_events` | R | Heuristica en MVP; el motor la mejora despues |
| `log_period()` | `cycle_events` | W | `event_type='period_start'|'period_end'` |
| `log_symptom()` | `signals` | W | `signal_type` en set de sintomas; `value` libre (TEXT) |
| `get_symptoms()` | `signals` | R | Filtrado por rango de tiempo |
| `get_symptom_patterns()` | `patterns` | R | `variable` en set de sintomas |
| `log_mood()` | `signals` | W | `signal_type='mood'` |
| `get_mood_history()` | `signals` | R | `signal_type='mood'` |
| `get_sleep()` | `signals` | R | `signal_type='sleep'` |
| `get_wellness_patterns()` | `patterns` | R | `variable` en set de bienestar |
| `get_content()` | `content` (nuevo) | R | Catalogo estatico |
| `recommend_content()` | `content` + contexto | R | Filtra por topics + life_stage |
| `complete_lesson()` | `lessons_delivered` | W | `bet_id` requerido (regla: no hay microleccion sin lectura verificada) |
| `create_check_in()` | `scheduled_messages` (nuevo) | W | Mensaje proactivo |
| `schedule_follow_up()` | `scheduled_messages` (nuevo) | W | Seguimiento proactivo |

## Las dos tools que faltan (y que hacen al LLM stand-in del motor)

El listado de 2.0 no incluye la tool mas importante: la que crea y verifica lecturas. Sin ella, el LLM no puede hacer el loop central. Se agregan dos:

### `propose_reading(reading_text)`

El unico camino de escritura a `bets`.

```text
propose_reading(texto)
  └─ Safety (bloquea/reformula)
       └─ Falsabilidad: extraer {variable, direction, window_spec, predicted_date}
            ├─ no falsable → retorna null (es chat)
            └─ falsable → INSERT bets (engine_version='llm-mvp-0.1', generator='llm')
                          └─ programar confirmacion (derivada de bets.predicted_date)
```

- Solo esta tool escribe en `bets`. Ninguna otra.
- El LLM propone `reading_text`; el sistema valida y estructura. Si el LLM intenta llamar `propose_reading` con texto no falsable, la tool devuelve `null` y la salida se trata como chat.

### `confirm_reading(bet_id, result)`

El dato de oro.

```text
confirm_reading(bet_id, result∈{yes,partial,no})
  └─ INSERT bet_confirmations (append-only)
  └─ update patterns.belief (bayes: yes=0.85, partial=0.55, no=0.20)
  └─ update patterns.status (promoted/active/discarded)
  └─ retorna mensaje + lesson_key
```

## Dos huecos encontrados en el schema

El mapping expone dos tablas que faltan:

### 1. `content` (catalogo de lecciones, estatico)

```sql
CREATE TABLE content (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_key  TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    topics      TEXT[] NOT NULL,     -- 'ciclo','sueño','perimenopausia',...
    life_stages TEXT[],              -- 'peri_40_47','reproductive','post_dx'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

No es dato de usuaria; es contenido curado. Vive separado del health graph.

### 2. `scheduled_messages` (cola proactiva)

```sql
CREATE TABLE scheduled_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pseudonym   UUID NOT NULL,
    kind        TEXT NOT NULL,          -- 'check_in' | 'follow_up'
    payload     JSONB NOT NULL,
    send_at     TIMESTAMPTZ NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|cancelled
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Decision**: la confirmacion de un bet NO se guarda aqui. Se **deriva** de `bets` (query: `predicted_date <= today AND result IS NULL`). Evita doble contabilidad y mantiene la confirmacion pegada a su fuente de verdad. `scheduled_messages` solo lleva `check_in` y `follow_up` proactivos.

## Reglas de safety por tool

- Tools de escritura validan contra vocabularios controlados (`signal_type`, `event_type`, `direction`, `window_spec.kind`). Un valor fuera de lista se rechaza.
- `propose_reading` ejecuta Safety+Falsabilidad internamente; no confia en que el LLM "ya valido".
- `complete_lesson` exige `bet_id`: impide microlecciones genericas sin lectura verificada detras.
- Ninguna tool expone `users.id`, `whatsapp_phone` ni `email` al LLM. Solo `pseudonym` resuelto server-side.

## Siguiente paso

Diseñar el motor hibrido: inventario de fuentes validadas (priors), proceso de validacion, y como los `bets` acumulados entrenan la capa estadistica (likelihood). Es el bloque que convierte el stand-in en el activo real.
