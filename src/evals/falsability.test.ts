import { describe, expect, it } from 'vitest';
import { evaluateFalsability } from './falsability.js';

// 2026-09-11 es viernes (verificado).
const today = new Date('2026-09-11T00:00:00.000Z');

describe('Eval B — Falsabilidad (bet vs chat)', () => {
  it('acepta lectura weekday válida (energy drop wed-fri)', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'Creo que tu energía va a caer entre miércoles y viernes.',
        variable: 'energy',
        direction: 'drop',
        window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
      },
      { today },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.variable).toBe('energy');
      expect(r.predictedDate).toBe('2026-09-11'); // hoy es viernes
    }
  });

  it('acepta cycle_days con ancla de ciclo', () => {
    const anchor = new Date('2026-09-01T00:00:00.000Z');
    const r = evaluateFalsability(
      {
        reading_text: 'Creo que tu energía cae entre los días 22 y 26 de tu ciclo.',
        variable: 'energy',
        direction: 'drop',
        window_spec: { kind: 'cycle_days', start: 22, end: 26 },
      },
      { today, cycleAnchor: anchor },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.predictedDate).toBe('2026-09-26');
  });

  it('la condición concreta sube la especificidad', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'Creo que tu energía cae los días 22 a 26 cuando dormiste mal.',
        variable: 'energy',
        direction: 'drop',
        window_spec: {
          kind: 'cycle_days',
          start: 22,
          end: 26,
          condition: 'sleep_poor',
        },
      },
      { today, cycleAnchor: new Date('2026-09-01T00:00:00.000Z') },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.specificity).toBeGreaterThanOrEqual(0.55);
  });

  it('rechaza variable fuera de vocabulario', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'Creo que tu peso va a bajar.',
        variable: 'weight',
        direction: 'drop',
        window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
      },
      { today },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_variable');
  });

  it('rechaza dirección fuera de vocabulario', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'x',
        variable: 'energy',
        direction: 'worsen',
        window_spec: { kind: 'weekdays', start: 'wed', end: 'fri' },
      },
      { today },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_direction');
  });

  it('rechaza window_spec inválido (kind desconocido)', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'x',
        variable: 'energy',
        direction: 'drop',
        window_spec: { kind: 'month', start: 1, end: 2 },
      },
      { today },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_window');
  });

  it('rechaza cycle_days sin ancla (no fechable)', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'x',
        variable: 'energy',
        direction: 'drop',
        window_spec: { kind: 'cycle_days', start: 22, end: 26 },
      },
      { today },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_predicted_date');
  });

  it('rechaza lectura genérica por baja especificidad', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'Tu energía varía según el día.',
        variable: 'energy',
        direction: 'improve',
        window_spec: { kind: 'weekdays', start: 'mon', end: 'sun' },
      },
      { today },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_specific_enough');
  });

  it('rechaza ventana weekday que envuelve (fri → mon)', () => {
    const r = evaluateFalsability(
      {
        reading_text: 'x',
        variable: 'energy',
        direction: 'drop',
        window_spec: { kind: 'weekdays', start: 'fri', end: 'mon' },
      },
      { today },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_window');
  });

  it('rechaza campo faltante', () => {
    const r = evaluateFalsability(
      { reading_text: '', variable: 'energy', direction: 'drop', window_spec: {} },
      { today },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_field');
  });
});
