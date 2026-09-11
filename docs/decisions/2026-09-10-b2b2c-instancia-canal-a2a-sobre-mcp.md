# Decision: El B2B2C vende una instancia de canal, no un protocolo; cuando exista un agente de empresa, preferir A2A sobre MCP

Status: Accepted
Date: 2026-09-10
Owner: CEO + CTO

## Context

Con el MVP como agente en WhatsApp (sin app), la vía B2B2C empieza a venderse a organizaciones (clínicas, empresas, aseguradoras, plataformas de salud). Surgió la duda de si el entregable era un MCP server o una conexión agéntica hacia el agente de la empresa.

## Decision

1. El MVP B2B2C vende una instancia de canal: el núcleo de Maura (agente + safety + health graph) desplegado en el canal de la organización (WhatsApp Business propio, portal de empleados/pacientes) con su identidad y su población. No se vende un protocolo ni se exige que la organización tenga un agente.
2. Cuando un cliente con agente real aparezca, se expone a Maura como agente peer (A2A), no como herramienta (MCP).
3. "Maura Core ≠ Channel" se mantiene como principio: MCP/A2A son superficies baratas de añadir después, no el producto del día 1.

## Alternatives Considered

- Vender un MCP server desde el inicio: le habla a un comprador (equipo de ML de la organización) que no existe en las cuentas objetivo; además convierte a Maura en herramienta subordinada y cede la decisión de escalación a un LLM ajeno no construido para salud.
- Vender conexión agéntica desde el inicio: exige que la organización ya tenga un agente, dependencia que frena la venta temprana.

## Consequences

- La propuesta de venta es "soporte de salud para tu población", no "una API" ni "un MCP".
- En salud, la autoridad de escalación permanece en el Safety Agent de Maura, sin importar quién hospede la conversación.
- La capa de tools del agente se diseña desde ya para parecerse a lo que expondría un MCP, de modo que añadir MCP/A2A después sea incremental.

## Follow-Ups

- Definir la oferta B2B2C MVP: componentes, branding, aislamiento de datos por organización y precio por contrato.
- Especificar el contrato A2A (peer) cuando surja el primer cliente con agente real: frontera de autoridad, escalación y ownership de los datos.
- Revisar el informe de seguridad (CSO) cuando se exponga Maura a terceros, en particular la frontera del Safety Agent.
