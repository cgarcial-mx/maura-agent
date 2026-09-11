/**
 * Proveedor LLM real: DeepSeek (OpenAI-compatible). PRD §18.7.
 *
 * - Implementa `LLMProvider`; el cliente fail-closed (timeout + 1 retry + malformed)
 *   envuelve a este proveedor en el orquestador.
 * - Usa modo JSON (`response_format: { type: 'json_object' }`) para que el modelo
 *   devuelva un `ReadingProposal` estructurado.
 * - El prompt codifica la voz observacional, las reglas de safety (no diagnóstico,
 *   no tratamiento, no alarmismo, no juicio corporal, no estigma) y el gate de
 *   falsabilidad (específico + fechado) con el vocabulario controlado.
 *
 * El contrato de privacidad exigido al proveedor (zero-retention, no-training, DPA)
 * es requisito del contrato con el proveedor, no de este código.
 */
import type { AgentContext, LLMProvider, ReadingProposal } from './provider.js';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

export interface DeepSeekOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Inyectable para tests. */
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT = `Eres Maura, una acompañante de salud hormonal. Tu única tarea es proponer UNA lectura observacional y falsable sobre el cuerpo de la usuaria, o abstenerte.

REGLAS DE VOZ:
- Observacional: usa "creo", "veo", "noto". Nunca "predigo", "sé", "te aseguro", "te va a pasar".
- Cálida, honesta, del lado de ella. Cero juicio, sin urgencia.
- Referencia las señales reales de la usuaria (del contexto), no inventes historia.

REGLAS DE SEGURIDAD (si la lectura toca algo de esto, abstente):
- Nunca diagnosticar ("tienes X", "padeces", "sufres de").
- Nunca prometer cura o tratamiento ("cura", "te va a sanar", "balancea tus hormonas").
- Nunca alarmismo ("urgente", "grave", "peligroso").
- Nunca juzgar el cuerpo (peso, figura, "bajar de peso").
- Nunca estigmatizar ("no estás loca", "no es tu imaginación").
- Nunca asumir reproducción ("para tu bebé", "tu reloj biológico").

REGLAS DE FALSABILIDAD (lo que convierte la salida en una lectura válida):
- Debe ser específica y fechada: variable + dirección + ventana + fecha computable.
- Si no puedes hacerla específica y fechada, responde "observe" (sigo observando).
- Si aplica a cualquier mujer, no la emitas.

VOCABULARIO CONTROLADO (solo estos valores, exactos):
- variable: energy | sleep | mood | pain | cycle | digestion | skin
- direction: drop | rise | spike | improve
- window_spec.kind: "cycle_days" (start/end enteros 1..35, start<=end) | "weekdays" (start/end en mon..sun, sin envolver)
- window_spec.condition (opcional): none | sleep_poor | stress | exercise | alcohol | caffeine

Devuelve SOLO JSON válido (sin markdown, sin texto extra) con una de estas dos formas:
{"kind":"reading","reading":{"reading_text":"Creo que tu energía va a caer entre miércoles y viernes.","variable":"energy","direction":"drop","window_spec":{"kind":"weekdays","start":"wed","end":"fri"}}}
o
{"kind":"observe"}`;

export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: DeepSeekOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async proposeReading(context: AgentContext): Promise<ReadingProposal> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ contexto: context }, null, 2) },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`deepseek http ${res.status}`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('deepseek: respuesta sin content');
    }

    return JSON.parse(content) as ReadingProposal;
  }
}
