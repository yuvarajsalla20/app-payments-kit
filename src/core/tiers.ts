export const FREE = 'free';

/**
 * Tiers, lowest first, always starting with 'free': ['free', 'premium'] or ['free', 'plus', 'pro'].
 * A higher tier includes everything below it.
 */
export function normalizeTiers(tiers: readonly string[] | undefined): string[] {
  const list = (tiers?.length ? [...tiers] : [FREE, 'premium']).filter((t, i, a) => a.indexOf(t) === i);
  if (list[0] !== FREE) {
    const i = list.indexOf(FREE);
    if (i > 0) list.splice(i, 1);
    list.unshift(FREE);
  }
  if (list.length < 2) throw new Error('Name at least one paid tier, such as ["free", "premium"].');
  return list;
}

/** Position of a tier in the list; an unknown tier counts as free, so a typo never unlocks anything. */
export const rank = (tiers: readonly string[], tier: string | null | undefined): number => Math.max(0, tiers.indexOf(tier ?? FREE));

/** The higher of the given tiers. */
export const highest = (tiers: readonly string[], ...list: (string | null | undefined)[]): string =>
  list.reduce<string>((best, t) => (rank(tiers, t) > rank(tiers, best) ? (t as string) : best), FREE);
