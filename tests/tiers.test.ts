import { describe, expect, it } from 'vitest';
import { highest, normalizeTiers, rank } from '../src/core/tiers';

describe('tiers', () => {
  it('defaults to free and premium, and always starts with free', () => {
    expect(normalizeTiers(undefined)).toEqual(['free', 'premium']);
    expect(normalizeTiers(['plus', 'free', 'pro'])).toEqual(['free', 'plus', 'pro']);
    expect(normalizeTiers(['plus', 'pro'])).toEqual(['free', 'plus', 'pro']);
  });
  it('needs at least one paid tier', () => {
    expect(() => normalizeTiers(['free'])).toThrow();
  });
  it('ranks unknown tiers as free, so a typo unlocks nothing', () => {
    const t = ['free', 'plus', 'pro'];
    expect(rank(t, 'pro')).toBe(2);
    expect(rank(t, 'gold')).toBe(0);
    expect(highest(t, 'plus', null, 'pro', 'gold')).toBe('pro');
    expect(highest(t)).toBe('free');
  });
});
