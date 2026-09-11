/**
 * `window_spec` estricto (PRD §9.3). El validador lo impone; la DB solo guarda.
 *
 * `kind` determina la interpretación de `start`/`end`:
 * - `cycle_days`: enteros 1..35 (días del ciclo).
 * - `weekdays`: abreviaturas de 3 letras ('mon'..'sun'), sin envolver (start <= end).
 */
import {
  isCondition,
  isWeekday,
  type Condition,
  type Weekday,
} from './vocabulary.js';

export interface CycleDaysWindow {
  kind: 'cycle_days';
  /** Día del ciclo, entero 1..35. */
  start: number;
  end: number;
  condition?: Condition;
}

export interface WeekdaysWindow {
  kind: 'weekdays';
  /** Abreviatura de 3 letras, 'mon'..'sun'. */
  start: Weekday;
  end: Weekday;
  condition?: Condition;
}

export type WindowSpec = CycleDaysWindow | WeekdaysWindow;

export type WindowValidationResult =
  | { ok: true; value: WindowSpec }
  | { ok: false; reason: string };

const WEEKDAY_INDEX: Record<Weekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export function validateWindowSpec(input: unknown): WindowValidationResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'window_spec must be an object' };
  }
  const raw = input as Record<string, unknown>;

  const { kind } = raw;
  if (kind !== 'cycle_days' && kind !== 'weekdays') {
    return { ok: false, reason: `invalid window kind: ${String(kind)}` };
  }

  let condition: Condition | undefined;
  if (raw.condition !== undefined) {
    if (typeof raw.condition !== 'string' || !isCondition(raw.condition)) {
      return { ok: false, reason: `invalid condition: ${String(raw.condition)}` };
    }
    condition = raw.condition as Condition;
  }

  if (kind === 'cycle_days') {
    const start = Number(raw.start);
    const end = Number(raw.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return { ok: false, reason: 'cycle_days start/end must be integers' };
    }
    if (start < 1 || end > 35 || start > end) {
      return { ok: false, reason: 'cycle_days must be within 1..35 and start <= end' };
    }
    return { ok: true, value: { kind, start, end, condition } };
  }

  const start = raw.start;
  const end = raw.end;
  if (typeof start !== 'string' || !isWeekday(start)) {
    return { ok: false, reason: `invalid weekday start: ${String(start)}` };
  }
  if (typeof end !== 'string' || !isWeekday(end)) {
    return { ok: false, reason: `invalid weekday end: ${String(end)}` };
  }
  if (WEEKDAY_INDEX[end] < WEEKDAY_INDEX[start]) {
    return { ok: false, reason: 'weekdays window cannot wrap (start must be <= end)' };
  }
  return {
    ok: true,
    value: { kind, start: start as Weekday, end: end as Weekday, condition },
  };
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Computa `predicted_date` — la fecha en la que Maura pregunta "¿pasó?".
 * Devuelve `null` cuando la ventana no es fechable sin más contexto
 * (p. ej. `cycle_days` sin ancla de ciclo).
 *
 * Heurísticas MVP (el motor v1 las refina):
 * - `weekdays`: próxima ocurrencia del día `end` (incluyendo hoy).
 * - `cycle_days`: ancla (último inicio de periodo = día 1) + (end-1) días; si ya
 *   pasó, rueda al siguiente ciclo (28 días por defecto).
 */
export function computePredictedDate(
  spec: WindowSpec,
  opts: { today?: Date; cycleAnchor?: Date },
): string | null {
  const today = startOfDayUTC(opts.today ?? new Date());

  if (spec.kind === 'weekdays') {
    const fromIdx = (today.getUTCDay() + 6) % 7; // lunes = 0
    const targetIdx = WEEKDAY_INDEX[spec.end];
    const delta = (targetIdx - fromIdx + 7) % 7;
    return toDateStr(addUTCDays(today, delta));
  }

  if (!opts.cycleAnchor) return null;
  const anchor = startOfDayUTC(opts.cycleAnchor);
  let predicted = addUTCDays(anchor, spec.end - 1);
  if (predicted.getTime() < today.getTime()) {
    predicted = addUTCDays(predicted, 28); // ciclo promedio por defecto
  }
  return toDateStr(predicted);
}
