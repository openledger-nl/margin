/**
 * Preact 11 no longer adds "px" to numbers in style objects, so positions
 * go through this helper.
 */
export function px(style: Record<string, number | string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'number' ? `${Math.round(v * 100) / 100}px` : v;
  }
  return out;
}
