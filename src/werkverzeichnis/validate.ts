import { slugify } from "./slugify";

/**
 * Why a new Inv. Nr. cannot be added to a tab that already holds `existing`, or null.
 *
 * The same two rules `catalog.ts` enforces at build time and `Form.gs` before writing:
 * a slug must be unique, and no slug may be a filename prefix of another, because
 * images are found by `<slug>-NN.<ext>`.
 */
export function invNrProblem(inv: string, existing: string[]): string | null {
  const slug = slugify(inv, { lower: true });
  const slugs = existing.filter(e => e && e.trim()).map(e => slugify(e, { lower: true }));
  for (const s of slugs) {
    if (s === slug) return `Inv. Nr. "${inv}" ergibt die URL "${slug}", die schon benutzt wird.`;
  }
  for (const s of slugs) {
    if (slug.startsWith(s + "-") || s.startsWith(slug + "-")) {
      const [short, long] = slug.length < s.length ? [slug, s] : [s, slug];
      return `"${short}" ist ein Dateiname-Präfix von "${long}" — die Bildzuordnung wäre mehrdeutig.`;
    }
  }
  return null;
}
