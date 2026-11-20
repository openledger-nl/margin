// Thread folder names, made the way Ledger makes them (ids::slugify in Ledger): lowercase ASCII letters and digits
// are kept, any other run of characters becomes one "-", no leading or trailing "-", and "thread" when nothing is left.

export function slugify(input: string, fallback = 'thread'): string {
  let slug = '';
  let pendingDash = false;
  for (const c of input.trim().toLowerCase()) {
    if (/^[a-z0-9]$/.test(c)) {
      if (pendingDash && slug !== '') slug += '-';
      pendingDash = false;
      slug += c;
    } else {
      pendingDash = true;
    }
  }
  return slug === '' ? fallback : slug;
}

/** The first of `base`, `base-2`, `base-3`… that `taken` says is free. */
export function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}
