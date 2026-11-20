// A company's own colors on the customer side (brand.json on the hub): the main
// color and the toolbar color. Everything else is worked out here so text stays
// readable. The status colors never change, so they always mean the same.

export interface Brand {
  /** Shown instead of "Margin": "Acme feedback", the welcome, the overview title. */
  name: string | null;
  /** The main color: buttons, links, focus, the selected tool. "#rrggbb". */
  color: string | null;
  /** The toolbar and the Feedback button. "#rrggbb". */
  toolbar: string | null;
  /** URL of the logo (on the hub), or null for the Margin mark. */
  logo: string | null;
}

export const NO_BRAND: Brand = { name: null, color: null, toolbar: null, logo: null };

type Rgb = [number, number, number];

/** "#abc" or "#aabbcc" (any case) to "#aabbcc", or null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return `#${h.toLowerCase()}`;
}

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** a mixed toward b by t (0..1). */
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** WCAG relative luminance. */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const INK = '#0e1016';
const WHITE = '#ffffff';

/** White or ink, whichever reads better on bg. */
export function textOn(bg: string): string {
  return contrast(WHITE, bg) >= contrast(INK, bg) ? WHITE : INK;
}

/** color, moved toward white or black until it has at least `min` contrast against bg. */
function readableOn(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color;
  const toward = luminance(bg) < 0.5 ? WHITE : INK;
  for (let t = 0.1; t <= 1; t += 0.1) {
    const c = mix(color, toward, t);
    if (contrast(c, bg) >= min) return c;
  }
  return toward;
}

/**
 * The CSS variables for a brand, by role. Callers map them onto their own variable
 * names (the overlay's --brm-*, the overview's). Empty for no colors: the Margin look.
 */
export function brandTokens(brand: Pick<Brand, 'color' | 'toolbar'>): Record<string, string> {
  const out: Record<string, string> = {};
  const accent = normalizeHex(brand.color);
  if (accent) {
    // On white, the main color must read as text and links: darken it when it is too light.
    const onWhite = readableOn(accent, WHITE, 3);
    out.accent = accent;
    out['accent-text'] = onWhite;
    out['accent-strong'] = mix(onWhite, INK, 0.18);
    out['accent-soft'] = mix(accent, WHITE, 0.88);
    out['on-accent'] = textOn(accent);
  }
  const toolbar = normalizeHex(brand.toolbar);
  if (toolbar) {
    const fg = textOn(toolbar);
    out.screen = toolbar;
    out['screen-2'] = mix(toolbar, fg, 0.12);
    out['on-screen'] = fg;
    out['on-screen-dim'] = mix(fg, toolbar, 0.35);
    // The selected tool on the toolbar: the main color if it stands out there, else a readable one.
    out.prompt = readableOn(accent ?? '#4cc38a', toolbar, 3);
  } else if (accent) {
    out.prompt = readableOn(accent, '#0e1016', 3);
  }
  return out;
}
