/**
 * What each role may do. The same table is at the top of firestore.rules, which
 * is what actually enforces it; this copy only decides what the UI shows.
 * tools/rules_test.mjs checks every role × permission against the deployed rules,
 * so the two copies cannot drift apart unnoticed.
 *
 * Who has which role is data, not code: artists/{artist}.roles maps an email to
 * one of these roles. Super-admins (a custom claim, tools/super_admin.mjs) may
 * do everything, for every artist, and create artists.
 */
export const PERMISSIONS = {
  admin: ["read", "works.edit", "werkgruppen.edit", "settings.edit", "roles.manage"],
  editor: ["read", "works.edit"],
};

export const ROLES = Object.keys(PERMISSIONS);

export const ROLE_LABELS = { admin: "Admin", editor: "Bearbeiter:in" };

/** `who` is { superAdmin, role } for one artist. */
export function can(who, permission) {
  return who.superAdmin === true || (PERMISSIONS[who.role] ?? []).includes(permission);
}
