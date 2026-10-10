/**
 * What the browser remembers about the editor, shared by /bearbeiten/, the
 * "Bearbeiten" link on work pages and the footer: the Google access token and
 * its expiry, in sessionStorage, so moving between pages in one tab doesn't mean
 * signing in again. Gone when the tab closes, and useless after an hour.
 *
 * Storage can be unavailable (private windows, blocked site data), so every access
 * is wrapped and failure just means "not remembered".
 */

// Also read by the footer script in Layout.astro — keep the key and shape in step.
const TOKEN = "werkverzeichnis.token";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export function saveToken(res) {
  try {
    sessionStorage.setItem(TOKEN, JSON.stringify({
      access_token: res.access_token,
      scope: res.scope,
      expires_at: Date.now() + Number(res.expires_in) * 1000,
    }));
  } catch {}
}

/** Name, email and picture from userinfo, for the footer to show who is signed in. */
export function saveProfile(me) {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN));
    if (!t) return;
    t.profile = { email: me.email, name: me.name, picture: me.picture };
    sessionStorage.setItem(TOKEN, JSON.stringify(t));
  } catch {}
}

/** The stored token if it has at least a minute left, otherwise undefined. */
export function loadToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN));
    if (t && t.expires_at - Date.now() > 60_000) return t;
  } catch {}
  return undefined;
}

export function clearToken() {
  try { sessionStorage.removeItem(TOKEN); } catch {}
}
