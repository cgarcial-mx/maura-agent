# Decision: El MVP es un agente en WhatsApp (sin app); el motor se construye a largo plazo con un LLM como stand-in

Status: Accepted
Date: 2026-09-10
Owner: CEO + CTO

## Context

Maura 2.0 pivota de "app de tracking/coach" (1.0) a una plataforma agéntica multicanal: el producto es la inteligencia (agente + memoria + safety), y los canales (WhatsApp, web, móvil, voz) son interfaces.

El motor de inferencia bayesiana de 1.0 (lectura falsable con fecha → confirmación → creencia → tabla `bets` append-only → grafo causal) sigue siendo el activo defendible. Pero no se puede construir de entrada: requiere fuentes validadas y ground truth verificado que todavía no existen.

## Decision

1. El MVP no incluye app. Es el agente integrado a WhatsApp (y web). La app móvil llega después como interfaz enriquecida, no como producto central.
2. Durante el MVP, un LLM actúa como stand-in del motor: consume contexto, usa tools y produce respuestas validadas por evals. El motor no decide todavía.
3. El feedback que se pide a la usuaria se guarda con forma de `bets` desde el día 1 (lectura específica + fecha + confirmación sí/más o menos/no), para que cada conversación llene la tabla que el futuro motor consumirá. Se distingue `engine_version: "llm-mvp"` vs `"motor-v1"`.
4. El motor se construye a largo plazo como híbrido: (a) knowledge engine curado desde fuentes validadas (literatura médica, guías clínicas) que aporta priors y restricciones de plausibilidad, y (b) aprendizaje estadístico desde los pares verificados acumulados en `bets`.

## Alternatives Considered

- Construir el motor primero: se construye sobre aire (sin fuentes ni ground truth); retrasa el lanzamiento.
- LLM sin disciplina de confirmación (feedback difuso tipo "¿te fue útil?"): se llega al motor con cero pares verificados utilizables.
- Vender el MVP como MCP o conexión agéntica a agentes de empresas: el comprador B2B2C no compra un protocolo, compra soporte para su población (ver Follow-Ups).

## Consequences

- La app deja de ser el producto; el agente y la capa multicanal lo son.
- El lenguaje público se mantiene observacional ("Mapa vivo", "lectura", "cuando se repita lo nombramos"), coherente con la decisión 2026-07-07. La verificación interna (¿acertó?) persiste aunque no se hable de "predicción" en la UI.
- Todo dato de confirmación debe nacer falsable (específico + fechado) o no se guarda: se impone con constraint de schema + un eval dedicado (heredero del claim-linter).
- El moat se pospone con la tubería lista: se lanza el agente ya, y el activo se llena desde la primera confirmación.

## Follow-Ups

- Definir el schema `bets`-shaped del MVP (lectura + variable + dirección + ventana + fecha + resultado + engine_version).
- Definir evals: calidad, seguridad (no diagnóstico) y falsabilidad (específico + fechado).
- Resolver B2B2C: vender "Maura en tu canal" (instancia co-branded) antes que MCP o conexión agéntica; decidir protocolo (A2A preferible a MCP por autoridad del Safety Agent) cuando haya un cliente con agente real.
- Diseñar el motor (híbrido): inventario de fuentes, proceso de validación, y cómo los `bets` entrenan la capa estadística.
