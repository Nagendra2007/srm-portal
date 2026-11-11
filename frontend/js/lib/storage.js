/* Browser persistence: credentials, per-profile sessions, saved profiles and
   the local data cache.

   Every key name and value shape here is unchanged from the previous
   frontend, so anyone who was signed in before this rewrite stays signed in
   and keeps their saved profiles. */

const safe = (storage) => ({
  get(key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { storage.setItem(key, value); } catch (e) { /* quota / private mode */ }
  },
  remove(key) {
    try { storage.removeItem(key); } catch (e) { /* ignore */ }
  }
});

const pick = (name) => {
  try { return window[name]; } catch (e) { return null; }
};

const memory = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
};

export const local = safe(pick('localStorage') || memory());
export const session = safe(pick('sessionStorage') || memory());

/* --------------------------------------------------------------------------
   CREDENTIALS
   Behaviour carried over as-is: with this flag on, the password is kept in
   localStorage as well as sessionStorage so "Reconnect" and profile switching
   keep working after the tab is closed. Turning it off limits passwords to
   the lifetime of the tab.
   -------------------------------------------------------------------------- */
export const PERSIST_PASSWORD_ON_DISK = true;

export const setStoredPassword = (password) => {
  session.set('password', password);
  if (PERSIST_PASSWORD_ON_DISK) local.set('password', password);
};

export const clearStoredPassword = () => {
  session.remove('password');
  local.remove('password');
};

export const getStoredPassword = () => local.get('password') || session.get('password') || '';
export const getStoredUsername = () => local.get('username') || session.get('username') || '';
export const getStoredSessionId = () => local.get('sessionId') || session.get('sessionId') || '';

const accountSecretKey = (username) => `accountSecret:${username}`;

export const setAccountSecret = (username, password) => {
  if (!username || !password) return;
  session.set(accountSecretKey(username), password);
  if (PERSIST_PASSWORD_ON_DISK) local.set(accountSecretKey(username), password);
};

export const getAccountSecret = (username) => {
  if (!username) return '';
  return session.get(accountSecretKey(username)) ||
    (PERSIST_PASSWORD_ON_DISK ? local.get(accountSecretKey(username)) : '') || '';
};

export const clearAccountSecret = (username) => {
  if (!username) return;
  session.remove(accountSecretKey(username));
  local.remove(accountSecretKey(username));
};

/* One-time cleanup for the PERSIST_PASSWORD_ON_DISK = false configuration. */
(function purgeLegacyPlaintextPasswords() {
  if (PERSIST_PASSWORD_ON_DISK) return;
  local.remove('password');
  try {
    const accounts = JSON.parse(local.get('savedAccounts') || '[]');
    if (Array.isArray(accounts) && accounts.some((a) => a && a.password)) {
      local.set('savedAccounts', JSON.stringify(
        accounts.map(({ username, displayName }) => ({ username, displayName }))
      ));
    }
  } catch (e) { /* ignore */ }
})();

/* --------------------------------------------------------------------------
   PER-PROFILE BACKEND SESSIONS
   Each saved profile keeps the session it last logged in with, so switching
   profiles can pick that session back up instead of logging in to SRM again.
   -------------------------------------------------------------------------- */
const getAccountSessions = () => {
  try {
    const parsed = JSON.parse(local.get('accountSessions') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) { return {}; }
};

export const getAccountSession = (username) => {
  const id = username ? getAccountSessions()[username] : '';
  return typeof id === 'string' ? id : '';
};

export const setAccountSession = (username, id) => {
  if (!username || !id) return;
  const sessions = getAccountSessions();
  sessions[username] = id;
  local.set('accountSessions', JSON.stringify(sessions));
};

export const clearAccountSession = (username) => {
  if (!username) return;
  const sessions = getAccountSessions();
  delete sessions[username];
  local.set('accountSessions', JSON.stringify(sessions));
};

/* --------------------------------------------------------------------------
   SAVED PROFILES
   -------------------------------------------------------------------------- */
export const getSavedAccounts = () => {
  try {
    const parsed = JSON.parse(local.get('savedAccounts') || '[]');
    return Array.isArray(parsed) ? parsed.filter((a) => a && a.username) : [];
  } catch (e) { return []; }
};

const saveSavedAccounts = (accounts) => local.set('savedAccounts', JSON.stringify(accounts));

// Called on every successful login, and again once the student's name is
// known. The password is only written when a fresh one is passed in.
export const upsertSavedAccount = (username, password, displayName) => {
  const accounts = getSavedAccounts();
  const existing = accounts.find((a) => a.username === username);
  if (existing) {
    if (displayName) existing.displayName = displayName;
    delete existing.password; // strip any value written by a much older build
  } else {
    accounts.push({ username, displayName: displayName || username });
  }
  saveSavedAccounts(accounts);
  setAccountSecret(username, password);
};

export const removeSavedAccount = (username) => {
  saveSavedAccounts(getSavedAccounts().filter((a) => a.username !== username));
  clearAccountSecret(username);
};

export const getDisplayName = (username) => {
  const account = getSavedAccounts().find((a) => a.username === username);
  return (account && (account.displayName || account.username)) || username || 'Student';
};

/* --------------------------------------------------------------------------
   LOCAL DATA CACHE
   Two ages matter. For 30 minutes a saved copy is trusted as-is (no request
   needed, same as before). After that it is still shown — a student opening
   the app should see their last-known timetable and attendance immediately,
   not a blank screen — but it is marked as an old copy and refetched. After
   a week it is dropped.
   -------------------------------------------------------------------------- */
export const CACHE_FRESH_MS = 30 * 60 * 1000;
export const CACHE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const DATA_KEYS = ['profile', 'timetable', 'attendance', 'internalMarks', 'currentResults', 'dayOrder'];

// Returns { data, timestamp, fresh } or null when missing or too old to show.
export const readLocalCache = (key) => {
  try {
    const raw = local.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.data == null) return null;
    const age = Date.now() - parsed.timestamp;
    if (!(age <= CACHE_KEEP_MS)) return null;
    return { data: parsed.data, timestamp: parsed.timestamp, fresh: age <= CACHE_FRESH_MS };
  } catch (e) {
    return null;
  }
};

export const writeLocalCache = (key, data) => {
  local.set(key, JSON.stringify({ data, timestamp: Date.now() }));
};

export const removeLocalCache = (key) => local.remove(key);

export const clearUserCaches = (username) => {
  if (!username) return;
  DATA_KEYS.forEach((name) => local.remove(`${name}:${username}`));
};

export const readCachedProfile = (username) => {
  const raw = local.get(`profile:${username}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Always refetched in the background, so an older copy is fine to show.
    if (!parsed || !(Date.now() - parsed.fetchedAt <= CACHE_KEEP_MS)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
};

export const writeCachedProfile = (username, tableHtml, photoTag, base64Photo = null) => {
  const current = readCachedProfile(username) || {};
  local.set(`profile:${username}`, JSON.stringify({
    tableHtml,
    photoTag,
    base64Photo: base64Photo || current.base64Photo || null,
    fetchedAt: Date.now()
  }));
};
