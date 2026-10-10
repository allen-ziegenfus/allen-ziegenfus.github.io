/**
 * Was jede Rolle darf. Dieselbe Tabelle steht oben in firestore.rules, und nur
 * die setzt sie tatsächlich durch; diese Kopie entscheidet nur, was die
 * Oberfläche anzeigt. tools/rules_test.mjs prüft jede Rolle × Berechtigung gegen
 * die Regeln, so dass die beiden Kopien nicht unbemerkt auseinanderlaufen.
 *
 * Wer welche Rolle hat, sind Daten, kein Code: artists/{artist}.roles ordnet
 * einer E-Mail-Adresse eine dieser Rollen zu. Super-Admins (ein Custom Claim,
 * tools/super_admin.mjs) dürfen alles, bei allen Künstler:innen, und legen
 * Künstler:innen an.
 */
export const BERECHTIGUNGEN = {
  admin: ["lesen", "werke.bearbeiten", "werkgruppen.bearbeiten", "seiten.bearbeiten",
    "einstellungen.bearbeiten", "rollen.verwalten", "veroeffentlichen"],
  editor: ["lesen", "werke.bearbeiten"],
};

export const ROLLEN = Object.keys(BERECHTIGUNGEN);

export const ROLLEN_NAMEN = { admin: "Admin", editor: "Bearbeiter:in" };

/** `wer` ist { superAdmin, rolle } für eine Künstler:in. */
export function darf(wer, berechtigung) {
  return wer.superAdmin === true || (BERECHTIGUNGEN[wer.rolle] ?? []).includes(berechtigung);
}
