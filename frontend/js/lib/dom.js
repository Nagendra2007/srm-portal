// Small DOM and formatting helpers shared by every module.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/* Every view builds markup with template strings and assigns it through
   innerHTML, so every interpolated value that did not originate in this
   codebase must go through esc(). */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// "10:42 AM" for today, "9 Nov, 10:42 AM" for any other day — a saved copy
// from last week must not read as if it were from this morning.
export const clockTime = (timestamp) => {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
};

export const getInitials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// "NAGENDRA AMBATI" -> "Nagendra". Falls back to the raw value for reg numbers.
export const firstName = (name) => {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!first || /\d/.test(first)) return first;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
};

export const debounce = (fn, wait = 150) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};
