# Diseño del motor híbrido: knowledge engine + aprendizaje estadístico

Status: Draft
Date: 2026-09-10
Owner: CEO + CTO
Relates: `2026-09-10-mvp-data-model-bets-schema.md`, `2026-09-10-mvp-evals.md`, `2026-09-10-mvp-agent-tools.md`

## Proposito

Definir el motor que reemplaza al LLM stand-in. Es hibrido porque combina dos fuentes de verdad que se necesitan mutuamente:

- **Knowledge engine**: evidencia curada desde fuentes validadas. Aporta los **priors** y las **restricciones de plausibilidad**.
- **Capa estadistica**: aprendizaje desde los `bets` acumulados (pares prediccion→resultado verificados). Aporta el **likelihood**.

La formula que gobierna todo es Bayes: `posterior ∝ prior × likelihood`.

```text
prior       (de la evidencia: que patrones son fisiologicamente plausibles)
likelihood  (de la confirmacion: que patrones se verifican en cuerpos reales)
```

Las fuentes solas son un libro de texto estatico. Los `bets` solos son correlacion sin restriccion. La combinacion es el moat.

---

## Componente 1: el knowledge engine

### Entrada: las fuentes

| Tipo | Que aporta | Ejemplo |
| --- | --- | --- |
| Guias clinicas / revisiones por pares | Ventanas fisiologicas confiables | Caida de energia en fase lutea (dias 22-26) |
| Epidemiologia poblacional | Rangos y prevalencia | Normas de longitud de ciclo, ventana perimenopausica 40-50 |
| Revisión de experto clinico | Sign-off y la linea roja | Que es educativo vs clinico |

### Proceso: conseguir → validar → transformar

```text
fuente
  └─ extraer claim (patron candidato)
       └─ graduar evidencia (meta_analisis > cohorte > experto > exploratorio)
            └─ mapear a template con prior + confianza
                 └─ sign-off clinico
                      └─ versionar ontologia (ontology_version)
```

### Salida: la ontologia de patrones (el activo de conocimiento)

Una tabla versionada y auditable de templates validos:

```sql
CREATE TABLE pattern_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ontology_version TEXT NOT NULL,        -- 'onto-0.1'
    variable        TEXT NOT NULL,         -- 'energy','mood','sleep','pain',...
    direction       TEXT NOT NULL,         -- 'drop','rise','spike'
    window_kind     TEXT NOT NULL,         -- 'cycle_days' | 'weekdays'
    window_spec     JSONB NOT NULL,        -- forma estricta (ver schema)
    condition_vocab TEXT[],                -- condiciones permitidas
    prior           NUMERIC NOT NULL,      -- plausibilidad desde evidencia (0..1)
    evidence_source TEXT NOT NULL,         -- cita
    evidence_level  TEXT NOT NULL,         -- 'meta_analysis'|'cohort'|'expert'|'exploratory'
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Ejemplo de templates

| variable | direction | window | prior | evidencia |
| --- | --- | --- | --- | --- |
| energy | drop | cycle_days 22-26 | 0.65 | luteal, bien documentado |
| mood | drop | cycle_days 24-28 | 0.60 | premenstrual |
| sleep | worse | cycle_days 24-28 | 0.55 | premenstrual |
| pain | rise | cycle_days 1-3 | 0.60 | menstrual |
| energy | drop | weekdays mon-wed | — | **no existe**: sin base hormonal, no es template |

Ese ultimo renglon es la clave: **el knowledge engine define el espacio de hipotesis**. El motor no explora correlaciones arbitrarias; explora solo los patrones que la evidencia dice que tienen sentido fisiologico. Un patron sin base hormonal no es candidato (salvo flag exploratorio).

### La linea roja (constraints, no solo texto)

El knowledge engine tambien codifica lo prohibido como reglas, no como recomendaciones:

- Nunca `variable` fuera del vocabulario controlado (sin "fertilidad", "enfermedad", "peso").
- Nunca `direction` con juicio ("engordas", "empeoras" → rechazado).
- Nunca un template que implique diagnostico o tratamiento.
- Todo template con `evidence_level='exploratory'` requiere flag y mayor umbral de especificidad para emitirse.

---

## Componente 2: la capa estadistica

### Per-usuario: Bayes sobre `patterns.belief`

Cada confirmacion actualiza la creencia de que el patron es real para ESA usuaria. El modelo honesto es una matriz de confusion (en vez del likelihood unico de 1.0):

```text
                    confirmacion real
                    yes     partial   no
patron real      | 0.80  |  0.15  | 0.05 |
patron no real   | 0.10  |  0.20  | 0.70 |
```

Actualizacion:

```text
belief_posterior = P(real | resultado)
                 = P(resultado | real) * belief_prior / P(resultado)
```

Umbrales (heredados de 1.0, a calibrar):

```text
belief > 0.75  → promoted   (entra al Mapa vivo)
belief < 0.30  → discarded  ("descartamos una hipotesis")
en medio       → active
```

### Poblacional: el grafo causal (Fase 4)

Agrega los pares verificados anonimos por template:

```text
por (variable, direction, window_kind, window_spec):
    n             = # confirmaciones
    confirm_rate  = yes / n
    intervalo     = confianza (Wilson, no solo proporcion)
```

Este es el activo licenciable: "que patron predice que, confirmado en N mujeres". Informa el cold-start de una usuaria nueva ("mujeres con tu patron"), pero la confirmacion individual siempre manda.

---

## La funcion decidir

```text
generar_lectura(signals, history, ontology):
    candidatos = []
    for template in ontology.templates where template.matches(signals):
        prior       = template.prior
        belief      = bayes(prior, confirmaciones de history para ese template)
        specificity = computar(template, signals)   # gate anti-generico
        if specificity >= UMBRAL and belief plausible:
            candidatos.append((template, belief, specificity))
    if not candidatos:
        return None                                  # prefiere no leer
    best = argmax(belief * specificity)
    return structured_prediction(best)               # el LLM SOLO redacta esto
```

El motor decide el contenido (que patron, que ventana, que fecha, con que creencia). El LLM lo redacta a la voz de Maura. Se restaura la regla de 1.0: **el motor decide, el LLM redacta.**

---

## Fases

| Fase | Que existe | Quien decide |
| --- | --- | --- |
| **MVP (ahora)** | LLM stand-in + ontologia como contexto/constraint | El LLM, restringido al espacio de templates |
| **Motor v1** | knowledge engine + Bayes per-usuario | El motor (determinista); el LLM redacta |
| **Motor v2** | + grafo causal poblacional | El motor, con cold-start poblacional |

Incluso en el MVP, la ontologia ya debe **construirse en paralelo** (aunque incompleta): es la que restringe que patrones puede proponer el LLM. Sin ella, el LLM inventa patrones arbitrarios y los `bets` del MVP valen menos.

---

## Forward-compat y el gotcha de sesgo de seleccion

Los `bets` del MVP son consumibles por el motor porque guardan `variable + direction + window_spec + predicted_date + result + engine_version`. La estructura ya esta.

**Pero hay un gotcha**: el LLM eligio que lecturas emitir segun su propio modelo interno. Los `bets` acumulados durante el MVP **no son una muestra aleatoria** de patron→resultado; estan sesgados hacia los patrones que el LLM considero probables. Si el motor se entrena directo sobre ellos, hereda el sesgo del LLM.

Mitigacion:

1. Marcar los `bets` por `generator` y analizar `llm-mvp` separado de `motor-v1`.
2. Tratar los `bets` de MVP como dato **exploratorio**, no como ground truth limpio para inferencia poblacional.
3. Cuando exista el motor, que explore **sistematicamente el espacio completo de templates** (no solo los que el LLM favorecio), para generar datos poblacionales no sesgados hacia adelante.

Esto es lo que separa un motor honesto de uno que confirma los prejuicios del stand-in.

---

## Metricas y evals del motor

- **Tasa de confirmacion por template**: `yes / n`, con N y intervalo. Es la senal que reemplaza a los evals de rubrica.
- **Calibracion**: para lecturas emitidas con `belief ≈ 0.7`, ¿~70% se confirman? Si no, el prior o la matriz de confusion estan mal calibrados.
- **Cobertura de exploracion**: % del espacio de templates que el motor ha testeado (vs el que solo el LLM favorecio).
- **Discriminacion**: ¿la creencia separa patrones que se confirman de los que no? (AUC sobre pares verificados).
- **Comparacion `llm-mvp` vs `motor-v1`**: misma tasa de confirmacion, mismo periodo. El dia del cambio, es el eval de la transicion.

## Open questions

1. Inventario de fuentes concreto: que guias y que literatura entran en la ontologia v1 (la lista exacta define el primer lote de templates).
2. Quien firma el sign-off clinico: un asesor medico externo, un advisory board, o una combinacion.
3. Umbrales finales de belief (0.75/0.30) y specificity, y la matriz de confusion (0.80/0.15/0.05). Se calibran con datos reales, no con opinion.
4. Cadencia de versionado de la ontologia (`ontology_version`) y su rollback.

## Siguiente paso

Este es el ultimo bloque de diseño del paquete MVP. El paquete completo queda: **schema → evals → tools → motor**. El siguiente paso natural es un PRD consolidado en `prds/ready/` que una repo de implementacion pueda construir, o un handoff de ejecucion con el orden de arranque.
