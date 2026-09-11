import { describe, expect, it } from 'vitest';
import { bayesUpdate, deriveStatus } from './bayes.js';

describe('bayesUpdate (likelihood yes=0.85 / partial=0.55 / no=0.20)', () => {
  it('yes sube la creencia', () => {
    expect(bayesUpdate(0.5, 'yes')).toBeCloseTo(0.85, 6);
  });

  it('no baja la creencia', () => {
    expect(bayesUpdate(0.5, 'no')).toBeCloseTo(0.2, 6);
  });

  it('partial sube ligeramente', () => {
    expect(bayesUpdate(0.5, 'partial')).toBeCloseTo(0.55, 6);
  });

  it('es monotónica: dos "yes" suben más que uno', () => {
    const once = bayesUpdate(0.5, 'yes');
    const twice = bayesUpdate(once, 'yes');
    expect(twice).toBeGreaterThan(once);
  });

  it('respeta el rango [0,1]', () => {
    expect(bayesUpdate(0.99, 'yes')).toBeLessThanOrEqual(1);
    expect(bayesUpdate(0.01, 'no')).toBeGreaterThanOrEqual(0);
  });
});

describe('deriveStatus (umbrales >0.75 promoted / <0.30 discarded)', () => {
  it('promoted', () => {
    expect(deriveStatus(0.8)).toBe('promoted');
  });
  it('discarded', () => {
    expect(deriveStatus(0.2)).toBe('discarded');
  });
  it('active en medio', () => {
    expect(deriveStatus(0.5)).toBe('active');
  });
  it('límites exactos son active', () => {
    expect(deriveStatus(0.75)).toBe('active');
    expect(deriveStatus(0.3)).toBe('active');
  });
});
