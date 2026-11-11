/* Thin fetch layer over the existing backend. No route, header or payload
   differs from what the previous frontend sent. */

const API_BASE = window.location.origin;

export class AuthError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'AuthError';
  }
}

let getSessionId = () => null;
let onUnauthorized = () => {};

export const configureApi = ({ sessionId, unauthorized }) => {
  getSessionId = sessionId;
  onUnauthorized = unauthorized;
};

// For calls that manage their own session header and their own 401 meaning
// (login, logout of another profile, session bootstrap, the photo ticket).
export const rawFetch = (path, options) => fetch(`${API_BASE}${path}`, options);

/* Authenticated request. SRM's upstream session can expire well before our
   own one does, and every portal route reports that as a 401 — so a 401 here
   raises the "session expired" flow and throws, and callers treat the pass as
   failed. Nothing re-authenticates automatically; that only happens when the
   student presses Reconnect. */
export const api = async (path, { method = 'GET', body } = {}) => {
  const headers = { 'X-Client-Session': getSessionId() || '' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    onUnauthorized();
    throw new AuthError();
  }

  return res;
};

export const apiUrl = (path) => (path.startsWith('http') ? path : `${API_BASE}${path}`);
