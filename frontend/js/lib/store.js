/* Application state: who is signed in, the portal data, and every action that
   talks to the backend. Views read `state`, call the actions exported here,
   and re-render when subscribe() tells them a key changed.

   The auth and data flows are the ones the previous frontend used, endpoint
   for endpoint; only the plumbing around them is new. */

import { api, rawFetch, apiUrl, AuthError } from './api.js';
import * as store from './storage.js';

/* --------------------------------------------------------------------------
   STATE
   -------------------------------------------------------------------------- */
const RESOURCES = ['timetable', 'courses', 'attendance', 'marks', 'results', 'today', 'profile'];

/* meta[key]
     status      'idle' | 'loading' | 'ready' | 'error'   (ready = there is data to show)
     refreshing  a request is in flight while data is already on screen
     stale       data is a saved copy that the network has not confirmed
     failed      the most recent request failed
     expired     the saved copy is older than 30 minutes: fine to show, but
                 it must be refetched rather than trusted
     updatedAt   when the data on screen was fetched */
const blankMeta = () => ({ status: 'idle', refreshing: false, stale: false, failed: false, expired: false, updatedAt: null });

// Set once the profile has been asked for in this session, so startup does
// not fetch it a second time when the Profile page already did.
let profileRequested = false;

export const state = {
  sessionId: null,
  username: null,
  password: null,

  timetable: null,
  courses: [],
  attendance: null,
  marks: null,
  results: null,
  today: null,
  profile: null, // { fields: [{label, value}], photo: string | null }
  dayOrderHint: null, // today's day order remembered from an earlier load

  meta: Object.fromEntries(RESOURCES.map((key) => [key, blankMeta()]))
};

const listeners = new Set();

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const emit = (key) => {
  listeners.forEach((fn) => {
    try { fn(key); } catch (err) { console.error(err); }
  });
};

export const isSignedIn = () => !!(state.sessionId && state.username);

const loaded = (key) => (key === 'courses' ? state.courses.length > 0 : state[key] != null);

const begin = (key) => {
  Object.assign(state.meta[key], loaded(key)
    ? { status: 'ready', refreshing: true }
    : { status: 'loading', refreshing: false });
  emit(key);
};

const succeed = (key, updatedAt = Date.now()) => {
  Object.assign(state.meta[key], { status: 'ready', refreshing: false, stale: false, failed: false, expired: false, updatedAt });
  emit(key);
};

const fail = (key) => {
  Object.assign(state.meta[key], loaded(key)
    ? { status: 'ready', refreshing: false, stale: true, failed: true }
    : { status: 'error', refreshing: false, failed: true });
  emit(key);
};

// Data restored from the local cache: usable, but not confirmed by the network.
const restored = (key, updatedAt, fresh = true) => {
  Object.assign(state.meta[key], { status: 'ready', refreshing: false, stale: true, failed: false, expired: !fresh, updatedAt });
  emit(key);
};

const resetData = () => {
  state.timetable = null;
  state.courses = [];
  state.attendance = null;
  state.marks = null;
  state.results = null;
  state.today = null;
  state.profile = null;
  state.dayOrderHint = null;
  profileRequested = false;
  RESOURCES.forEach((key) => { state.meta[key] = blankMeta(); });
  Object.keys(inflight).forEach((key) => delete inflight[key]);
  RESOURCES.forEach(emit);
};

/* One request per resource at a time: a view asking for data that is already
   on its way shares the pending request instead of starting another. */
const inflight = {};

const once = (key, run) => {
  if (inflight[key]) return inflight[key];
  const owner = state.username;
  const promise = run(owner).finally(() => {
    if (inflight[key] === promise) delete inflight[key];
  });
  inflight[key] = promise;
  return promise;
};

// A response that lands after the student switched profile must be dropped.
const stillCurrent = (owner) => owner === state.username;

const getJson = async (path) => {
  const res = await api(path);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
};

/* --------------------------------------------------------------------------
   HOW DATA IS LOADED

   The backend talks to SRM one request at a time per session, and each of
   those takes around a second. So the order requests are sent in decides
   what the student sees first, and bundling several reports into one
   request means nothing shows until the slowest one is done.

   Three rules follow from that:
     1. One report per request, so each part of a page appears the moment
        its own data arrives.
     2. The page on screen asks first; everything else is fetched after it.
     3. Saved data is shown immediately — even an old copy — and replaced
        when the fresh copy lands.

   Each loader can be called three ways:
     ensureX()                      use what is in memory or saved on the
                                    device; only fetch if that is missing or
                                    older than 30 minutes
     ensureX({ revalidate: true })  keep showing what we have, and refetch
     ensureX({ force: true })       the student pressed Refresh
   -------------------------------------------------------------------------- */
const isCurrent = (key) => loaded(key) && !state.meta[key].expired;

/* --------------------------------------------------------------------------
   TIMETABLE + COURSES
   -------------------------------------------------------------------------- */
const applyTimetable = (data, owner) => {
  state.timetable = data;
  if (Array.isArray(data.subjects) && data.subjects.length > 0) {
    state.courses = data.subjects;
    succeed('courses');
  }
  if (owner) store.writeLocalCache(`timetable:${owner}`, data);
  succeed('timetable');
};

const timetableHasDays = () =>
  !!(state.timetable && Array.isArray(state.timetable.schedule) && state.timetable.schedule.length > 0);

const restoreTimetable = (cached) => {
  state.timetable = cached.data;
  if (Array.isArray(cached.data.subjects)) state.courses = cached.data.subjects;
  restored('timetable', cached.timestamp, cached.fresh);
  if (state.courses.length > 0) restored('courses', cached.timestamp, cached.fresh);
};

export const ensureTimetable = async ({ force = false, revalidate = false } = {}) => {
  const refetch = force || revalidate;
  if (!refetch && timetableHasDays() && isCurrent('timetable')) return state.timetable;

  return once('timetable', async (owner) => {
    if (!refetch && !timetableHasDays()) {
      const cached = store.readLocalCache(`timetable:${owner}`);
      if (cached) {
        restoreTimetable(cached);
        if (cached.fresh) return state.timetable;
      }
    }

    begin('timetable');
    try {
      const data = await getJson('/api/timetable');
      if (stillCurrent(owner)) applyTimetable(data, owner);
      return data;
    } catch (err) {
      if (stillCurrent(owner)) fail('timetable');
      throw err;
    }
  });
};

export const ensureCourses = async () => {
  if (state.courses.length > 0) return state.courses;

  // The course list ships with the timetable; if that is already on its
  // way, wait for it rather than asking SRM for the same report twice.
  if (inflight.timetable) {
    try { await inflight.timetable; } catch (err) { /* fall through */ }
    if (state.courses.length > 0) return state.courses;
  }

  return once('courses', async (owner) => {
    begin('courses');
    try {
      const courses = await getJson('/api/courses');
      if (!stillCurrent(owner)) return courses;
      state.courses = Array.isArray(courses) ? courses : [];
      // An empty list is a real answer (nothing registered), not a failure.
      Object.assign(state.meta.courses, { status: 'ready', refreshing: false, stale: false, failed: false, expired: false, updatedAt: Date.now() });
      emit('courses');
      return state.courses;
    } catch (err) {
      if (err instanceof AuthError) {
        if (stillCurrent(owner)) fail('courses');
        throw err;
      }
      // Same fallback as before: the course list also ships with the timetable.
      try {
        await ensureTimetable();
        if (stillCurrent(owner)) {
          Object.assign(state.meta.courses, { status: 'ready', refreshing: false, failed: false });
          emit('courses');
        }
        return state.courses;
      } catch (inner) {
        if (stillCurrent(owner)) fail('courses');
        throw inner;
      }
    }
  });
};

/* --------------------------------------------------------------------------
   ATTENDANCE
   -------------------------------------------------------------------------- */
const applyAttendance = (subjects, owner) => {
  state.attendance = Array.isArray(subjects) ? subjects : [];
  if (owner) store.writeLocalCache(`attendance:${owner}`, state.attendance);
  succeed('attendance');
};

export const ensureAttendance = async ({ force = false, revalidate = false } = {}) => {
  const refetch = force || revalidate;
  const hasRows = Array.isArray(state.attendance) && state.attendance.length > 0;
  if (!refetch && hasRows && isCurrent('attendance')) return state.attendance;

  return once('attendance', async (owner) => {
    if (force) {
      // Known to be out of date (a class was just marked, or Refresh was pressed).
      store.removeLocalCache(`attendance:${owner}`);
    } else if (!revalidate && !hasRows) {
      const cached = store.readLocalCache(`attendance:${owner}`);
      if (cached) {
        state.attendance = cached.data;
        restored('attendance', cached.timestamp, cached.fresh);
        if (cached.fresh) return state.attendance;
      }
    }

    begin('attendance');
    try {
      const subjects = await getJson('/api/attendance');
      if (stillCurrent(owner)) applyAttendance(subjects, owner);
      return subjects;
    } catch (err) {
      if (stillCurrent(owner)) fail('attendance');
      throw err;
    }
  });
};

/* --------------------------------------------------------------------------
   TODAY'S ATTENDANCE STATUS  (day order, online attendance, per-hour status)
   Changes through the day, so it is never written to the local cache. A short
   in-memory window stops Home, Mark and Attendance > Today from each firing
   their own request when the student moves between them.

   The one thing that is remembered is today's day order: it decides which
   "Day N" of the timetable is today, and it cannot change within a day, so
   keeping it means a reload shows the right day's classes straight away.
   -------------------------------------------------------------------------- */
const TODAY_MAX_AGE_MS = 30 * 1000;

const rememberDayOrder = (owner, value) => {
  if (!value) return;
  state.dayOrderHint = value;
  store.local.set(`dayOrder:${owner}`, JSON.stringify({ day: new Date().toDateString(), dayOrder: value }));
};

const restoreDayOrder = (owner) => {
  try {
    const saved = JSON.parse(store.local.get(`dayOrder:${owner}`) || 'null');
    state.dayOrderHint = saved && saved.day === new Date().toDateString() ? saved.dayOrder : null;
  } catch (err) {
    state.dayOrderHint = null;
  }
};

// Today's day order as far as we know it: live if loaded, else remembered.
export const dayOrder = () => (state.today && state.today.dayOrder) || state.dayOrderHint || '';

export const loadToday = async ({ force = false } = {}) => {
  const meta = state.meta.today;
  if (!force && state.today && meta.updatedAt && Date.now() - meta.updatedAt < TODAY_MAX_AGE_MS) {
    return state.today;
  }

  return once('today', async (owner) => {
    begin('today');
    try {
      const data = await getJson('/api/att');
      if (stillCurrent(owner)) {
        state.today = data || {};
        rememberDayOrder(owner, state.today.dayOrder);
        succeed('today');
      }
      return data;
    } catch (err) {
      if (stillCurrent(owner)) fail('today');
      throw err;
    }
  });
};

// After marking: the cached attendance is known to be out of date.
export const refreshAllAttendance = () => Promise.allSettled([
  ensureAttendance({ force: true }),
  loadToday({ force: true })
]);

/* --------------------------------------------------------------------------
   INTERNAL MARKS
   Always fetched live when the page opens — marks change often right after
   they are entered, so a saved copy is not good enough. Whatever was on
   screen stays up until the fresh copy lands, and comes back (flagged as a
   saved copy) if the request fails.
   -------------------------------------------------------------------------- */
export const loadMarks = () => once('marks', async (owner) => {
  if (state.marks == null) {
    const cached = store.readLocalCache(`internalMarks:${owner}`);
    if (cached) {
      state.marks = cached.data;
      restored('marks', cached.timestamp, cached.fresh);
    }
  }

  begin('marks');
  try {
    const subjects = await getJson('/api/internal-marks');
    if (stillCurrent(owner)) {
      state.marks = Array.isArray(subjects) ? subjects : [];
      store.writeLocalCache(`internalMarks:${owner}`, state.marks);
      succeed('marks');
    }
    return subjects;
  } catch (err) {
    if (stillCurrent(owner)) fail('marks');
    throw err;
  }
});

/* --------------------------------------------------------------------------
   CURRENT SEMESTER RESULTS
   -------------------------------------------------------------------------- */
export const ensureResults = async ({ force = false } = {}) => {
  const hasSubjects = state.results && Array.isArray(state.results.subjects) && state.results.subjects.length > 0;
  if (!force && hasSubjects && isCurrent('results')) return state.results;

  return once('results', async (owner) => {
    if (!force && !hasSubjects) {
      const cached = store.readLocalCache(`currentResults:${owner}`);
      if (cached) {
        state.results = cached.data;
        restored('results', cached.timestamp, cached.fresh);
        if (cached.fresh) return state.results;
      }
    }

    begin('results');
    try {
      const data = await getJson('/api/current-semester-results');
      if (stillCurrent(owner)) {
        state.results = data || { title: '', subjects: [], sgpa: null };
        store.writeLocalCache(`currentResults:${owner}`, state.results);
        succeed('results');
      }
      return data;
    } catch (err) {
      if (stillCurrent(owner)) fail('results');
      throw err;
    }
  });
};

/* --------------------------------------------------------------------------
   STARTUP
   hydrate() runs before the first page is drawn and fills state from what
   is saved on the device, so a returning student sees their data at once.
   syncAll() runs after the page on screen has sent its own requests, and
   brings everything else up to date behind it.
   -------------------------------------------------------------------------- */
export const hydrate = () => {
  const username = state.username;

  const timetable = store.readLocalCache(`timetable:${username}`);
  if (timetable) restoreTimetable(timetable);

  const attendance = store.readLocalCache(`attendance:${username}`);
  if (attendance) {
    state.attendance = attendance.data;
    restored('attendance', attendance.timestamp, attendance.fresh);
  }

  const marks = store.readLocalCache(`internalMarks:${username}`);
  if (marks) {
    state.marks = marks.data;
    restored('marks', marks.timestamp, marks.fresh);
  }

  const results = store.readLocalCache(`currentResults:${username}`);
  if (results) {
    state.results = results.data;
    restored('results', results.timestamp, results.fresh);
  }

  restoreProfile(username);
  restoreDayOrder(username);
};

export const syncAll = () => {
  // Shared with whatever the current page already asked for (see once()).
  const core = [
    ensureTimetable({ revalidate: true }),
    ensureAttendance({ revalidate: true })
  ];
  core.forEach((request) => request.catch(() => {}));

  // The profile is two SRM requests and only feeds the name and photo, so
  // it goes last instead of holding up the timetable and attendance.
  return Promise.allSettled(core).then(() => (isSignedIn() ? ensureProfile() : undefined));
};

// Fetches the profile once per session; later callers share that result.
// (The Profile page calls this first thing, so there it is not left to last.)
export const ensureProfile = () => (profileRequested ? (inflight.profile || Promise.resolve()) : loadProfile());

/* --------------------------------------------------------------------------
   PROFILE
   /api/profile returns an HTML fragment: an optional <img> (a short-lived
   photo ticket) followed by SRM's profile table.
   -------------------------------------------------------------------------- */
const splitPhotoAndTable = (html) => {
  const match = html.match(/<img[^>]*>/i);
  return {
    photoTag: match ? match[0] : '',
    tableHtml: html.replace(/<img[^>]*>/i, '')
  };
};

const photoSrc = (photoTag) => {
  const match = (photoTag || '').match(/src="([^"]+)"/i);
  return match ? match[1] : '';
};

/* Values are read as text, never as markup: the fragment comes from a
   third-party page and is only ever displayed. Line breaks are kept. */
const cellText = (cell) => {
  const clone = cell.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return clone.textContent.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
};

const parseProfileFields = (tableHtml) => {
  const doc = new DOMParser().parseFromString(tableHtml || '', 'text/html');
  const fields = [];
  doc.querySelectorAll('tr').forEach((row) => {
    const cells = Array.from(row.querySelectorAll('td'))
      .filter((cell) => cell.textContent.trim() !== '' && cell.textContent.trim() !== ':');
    if (cells.length < 2) return;
    const label = cells[0].textContent.trim().replace(/\s*:$/, '');
    const value = cells.slice(1).map(cellText).join(' ').trim();
    if (label && value) fields.push({ label, value });
  });
  return fields;
};

const fetchAsDataUrl = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    return null;
  }
};

const findStudentName = (fields) => {
  const exact = fields.find((f) => f.label.toLowerCase() === 'student name');
  if (exact) return exact.value;
  const loose = fields.find((f) => {
    const label = f.label.toLowerCase();
    return label.includes('name') && !label.includes('father') && !label.includes('mother');
  });
  return loose ? loose.value : '';
};

// Shows the saved profile (name, details, photo) without touching the network.
const restoreProfile = (owner) => {
  const cached = store.readCachedProfile(owner);
  if (!cached) return;

  const fields = parseProfileFields(cached.tableHtml);
  if (fields.length === 0) {
    store.removeLocalCache(`profile:${owner}`);
    return;
  }

  state.profile = { fields, photo: cached.base64Photo || photoSrc(cached.photoTag) || null };
  restored('profile', cached.fetchedAt);
};

export const loadProfile = () => once('profile', async (owner) => {
  profileRequested = true;
  if (state.profile == null) restoreProfile(owner);

  begin('profile');
  try {
    const res = await api('/api/profile');
    if (!res.ok) throw new Error(`Request failed (${res.status})`);

    const { photoTag, tableHtml } = splitPhotoAndTable(await res.text());
    const fields = parseProfileFields(tableHtml);
    if (!stillCurrent(owner)) return;

    if (fields.length === 0) {
      // Nothing parseable came back. Keep a saved copy if there is one.
      if (state.profile) fail('profile');
      else {
        state.profile = { fields: [], photo: null };
        succeed('profile');
      }
      return;
    }

    // Keep the photo already on screen until the new one has downloaded,
    // rather than swapping to the ticket URL and back.
    const src = photoSrc(photoTag);
    state.profile = { fields, photo: (state.profile && state.profile.photo) || src || null };
    succeed('profile');

    const name = findStudentName(fields);
    if (name) {
      store.upsertSavedAccount(owner, null, name);
      emit('accounts');
    }

    // The ticket URL expires in minutes, so keep the photo itself.
    const base64Photo = src ? await fetchAsDataUrl(apiUrl(src)) : null;
    if (!stillCurrent(owner)) return;
    if (base64Photo || src) {
      state.profile = { fields, photo: base64Photo || src };
      emit('profile');
    }
    store.writeCachedProfile(owner, tableHtml, photoTag, base64Photo);
  } catch (err) {
    if (stillCurrent(owner)) fail('profile');
  }
});

/* --------------------------------------------------------------------------
   MARK ATTENDANCE
   Result kinds:
     success  SRM confirmed the code
     rejected SRM answered and said no (wrong / expired code)
     unknown  no usable answer — the student must check today's status
     auth     session expired; the reconnect dialog is already showing
   -------------------------------------------------------------------------- */
const UNCONFIRMED = "Unable to confirm attendance. Please check today's attendance status before trying again.";

export const markAttendance = async (acode) => {
  const unknown = () => {
    refreshAllAttendance();
    return { kind: 'unknown', message: UNCONFIRMED };
  };

  let res;
  try {
    res = await api('/api/mark-attendance', { method: 'POST', body: { acode } });
  } catch (err) {
    if (err instanceof AuthError) return { kind: 'auth', message: '' };
    return unknown();
  }

  if (!res.ok) return unknown();

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return unknown();
  }

  if (data && (data.resultstatus === '1' || data.resultstatus === 1)) {
    refreshAllAttendance();
    return { kind: 'success', message: data.result || 'Attendance marked successfully!' };
  }
  if (data && (data.resultstatus === '0' || data.resultstatus === 0)) {
    return { kind: 'rejected', message: data.result || 'Attendance marking failed' };
  }
  return unknown();
};

/* --------------------------------------------------------------------------
   FEEDBACK
   -------------------------------------------------------------------------- */
export const fetchFeedbackSubjects = async () => {
  const res = await api('/api/feedback/subjects');
  if (!res.ok) throw new Error('Failed to load subjects');
  const data = await res.json();
  return Array.isArray(data.subjects) ? data.subjects : [];
};

export const fetchRandomFeedbackComment = async () => {
  try {
    const res = await rawFetch('/api/feedback/comment', {
      headers: { 'X-Client-Session': state.sessionId || '' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.comment) return data.comment;
    }
  } catch (err) { /* caller falls back */ }
  return '';
};

export const submitFeedback = async (optionNo, comment, selectedSubjectIds) => {
  const res = await api('/api/feedback/submit', {
    method: 'POST',
    body: { comment, optionNo, selectedSubjectIds }
  });
  let data = {};
  try { data = await res.json(); } catch (err) { /* ignore */ }
  if (!res.ok) throw new Error(data.message || 'Feedback submission failed');
  return data;
};

/* --------------------------------------------------------------------------
   AUTH
   -------------------------------------------------------------------------- */
const placeholderSessionId = () => `sess_${Date.now().toString(36)}`;

const friendlyNetworkError = (err) =>
  (err instanceof TypeError
    ? new Error("Can't reach the server. Check your connection and try again.")
    : err);

// An anonymous backend session, created up front so the captcha solver is
// warm by the time the student has typed a password.
export const initSession = async () => {
  try {
    const res = await rawFetch('/api/session');
    const data = await res.json();
    if (!state.username) {
      state.sessionId = data.sessionId || res.headers.get('x-client-session') || placeholderSessionId();
    }
  } catch (err) {
    if (!state.username) state.sessionId = placeholderSessionId();
  }
};

// Returns true when a stored session was picked back up.
export const restoreSession = () => {
  const storedSessionId = store.getStoredSessionId();
  const storedUsername = store.getStoredUsername();

  if (!storedSessionId || !storedUsername) return false;

  state.sessionId = storedSessionId;
  state.username = storedUsername;
  state.password = store.getStoredPassword() || null;
  return true;
};

/* The one place that logs in — used by the sign-in form, by profile
   switching and by Reconnect, so the three can never drift apart. */
export const performLogin = async (username, password, { remember = false, sessionHeader } = {}) => {
  const headerSession = sessionHeader !== undefined
    ? (sessionHeader || placeholderSessionId())
    : (state.sessionId || placeholderSessionId());

  let res;
  try {
    res = await rawFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Session': headerSession },
      body: JSON.stringify({ username, password })
    });
  } catch (err) {
    throw friendlyNetworkError(err);
  }

  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    data = { success: true };
  }

  if (!res.ok || data.success === false) {
    throw new Error(data.message || 'Login verification failed');
  }

  const switchingUser = state.username !== username;

  state.sessionId = data.sessionId || headerSession;
  state.username = username;
  state.password = password;

  store.session.set('sessionId', state.sessionId);
  store.session.set('username', username);
  store.setStoredPassword(password);

  if (remember) {
    store.local.set('sessionId', state.sessionId);
    store.local.set('username', username);
  } else {
    store.local.remove('sessionId');
    store.local.remove('username');
    store.clearStoredPassword();
    store.setStoredPassword(password);
  }

  store.upsertSavedAccount(username, password);
  store.setAccountSession(username, state.sessionId);

  // Never show one student's data under another student's name.
  if (switchingUser) resetData();
  emit('accounts');

  return data;
};

/* Re-authenticates with the saved credentials. Only ever called from the
   "Reconnect" button on the session-expired dialog. */
let reconnectInFlight = null;

export const isReconnecting = () => !!reconnectInFlight;

export const reconnectSession = () => {
  if (reconnectInFlight) return reconnectInFlight;

  reconnectInFlight = (async () => {
    const username = state.username || store.getStoredUsername();
    const password = state.password || store.getStoredPassword();

    if (!username || !password) {
      throw new Error('Saved credentials not found. Please log in again.');
    }

    // The expired session id is sent along on purpose so the backend drops
    // it as it creates the new one.
    await performLogin(username, password, { remember: true });
  })().finally(() => { reconnectInFlight = null; });

  return reconnectInFlight;
};

/* Signs the active profile out and clears its cached data. The saved
   profiles list is deliberately left alone — a profile only leaves that list
   when the student removes it. */
export const performLogout = async () => {
  const username = state.username || store.getStoredUsername();

  if (state.sessionId) {
    rawFetch('/api/logout', {
      method: 'POST',
      headers: { 'X-Client-Session': state.sessionId }
    }).catch(() => {});
  }

  store.session.remove('sessionId');
  store.session.remove('username');
  store.local.remove('sessionId');
  store.local.remove('username');
  store.clearStoredPassword();

  if (username) {
    store.clearAccountSession(username);
    store.clearUserCaches(username);
  }

  state.sessionId = null;
  state.username = null;
  state.password = null;
  resetData();
  emit('accounts');

  await initSession();
};

// Removes a saved profile that is not the active one.
export const forgetAccount = (username) => {
  store.removeSavedAccount(username);
  store.clearUserCaches(username);

  // End that profile's kept-alive backend session too.
  const keptSessionId = store.getAccountSession(username);
  if (keptSessionId && keptSessionId !== state.sessionId) {
    rawFetch('/api/logout', {
      method: 'POST',
      headers: { 'X-Client-Session': keptSessionId }
    }).catch(() => {});
  }
  store.clearAccountSession(username);
  emit('accounts');
};

/* Switches to another saved profile.
     'reload'   the caller should reload: storage now points at the new profile
     'password' no saved password for that profile — it has to sign in again
   Throws when a fresh login was needed and SRM rejected it. */
export const switchAccount = async (username) => {
  const password = store.getAccountSecret(username);
  if (!password) return 'password';

  // That profile still has a session from its last login — pick it back up
  // rather than logging in to SRM again. If it has since expired, the first
  // request after the reload gets a 401 and the reconnect dialog takes over.
  const keptSessionId = store.getAccountSession(username);
  if (keptSessionId) {
    store.session.set('sessionId', keptSessionId);
    store.session.set('username', username);
    store.local.set('sessionId', keptSessionId);
    store.local.set('username', username);
    store.setStoredPassword(password);
    return 'reload';
  }

  // The active profile's session id is not sent, so the backend leaves that
  // session alive for switching back.
  await performLogin(username, password, { remember: true, sessionHeader: null });
  return 'reload';
};
