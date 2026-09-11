import { describe, expect, it } from 'vitest';
import { classifyEscalation, evaluateSafety } from './safety.js';

describe('Eval A — Safety (bloqueo de salida)', () => {
  it('bloquea diagnóstico', () => {
    expect(evaluateSafety('Tienes endometriosis.').safe).toBe(false);
  });

  it('bloquea juicio corporal', () => {
    expect(evaluateSafety('Vas a bajar de peso.').safe).toBe(false);
  });

  it('bloquea estigma', () => {
    expect(evaluateSafety('No estás loca.').safe).toBe(false);
  });

  it('bloquea promesa de tratamiento', () => {
    expect(evaluateSafety('Esto cura tus síntomas.').safe).toBe(false);
  });

  it('bloquea alarmismo', () => {
    expect(evaluateSafety('Actúa ahora antes de que sea tarde.').safe).toBe(false);
  });

  it('bloquea asunción reproductiva', () => {
    expect(evaluateSafety('Tu reloj biológico se está agotando.').safe).toBe(false);
  });

  it('permite lectura observacional', () => {
    expect(evaluateSafety('Creo que tu energía va a caer.').safe).toBe(true);
  });

  it('reporta la categoría que bloqueó', () => {
    expect(evaluateSafety('Padeces un desbalance.').blockedCategory).toBe('diagnosis');
  });
});

describe('Safety Agent — clasificación de escalación (entrada)', () => {
  it('red flag → professional care recommended', () => {
    expect(classifyEscalation('No puedo parar de sangrar')).toBe(
      'professional care recommended',
    );
  });

  it('señal de preocupación → potentially concerning', () => {
    expect(classifyEscalation('No me ha bajado en tres meses')).toBe(
      'potentially concerning',
    );
  });

  it('bienestar → wellness', () => {
    expect(classifyEscalation('Últimamente estoy muy cansada')).toBe('wellness');
  });

  it('pregunta general → educational', () => {
    expect(classifyEscalation('¿Cuánto dura normalmente un ciclo?')).toBe('educational');
  });
});
