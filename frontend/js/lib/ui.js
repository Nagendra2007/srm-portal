/* Shared UI building blocks. Views compose these instead of writing their own
   markup for buttons-with-state, dialogs, toasts, empty states and so on. */

import { esc, clockTime } from './dom.js';
import { icon } from './icons.js';
import { local } from './storage.js';

/* --------------------------------------------------------------------------
   THEME
   -------------------------------------------------------------------------- */
const THEME_COLORS = { light: '#ffffff', dark: '#151920' };

export const getTheme = () => document.documentElement.getAttribute('data-theme') || 'dark';

export const setTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  local.set('theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.dark);
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
};

export const toggleTheme = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark');

/* Accent colour. Blue is the default and needs no attribute; the others set
   <html data-accent>. The colours themselves live in system.css. */
export const ACCENTS = [
  { id: 'blue', label: 'Blue', swatch: '#1d4ed8' },
  { id: 'teal', label: 'Teal', swatch: '#0e7490' },
  { id: 'violet', label: 'Violet', swatch: '#6d28d9' },
  { id: 'graphite', label: 'Graphite', swatch: '#4b5563' }
];

export const getAccent = () => {
  const value = document.documentElement.getAttribute('data-accent');
  return ACCENTS.some((accent) => accent.id === value) ? value : 'blue';
};

export const setAccent = (id) => {
  const accent = ACCENTS.some((a) => a.id === id) ? id : 'blue';
  if (accent === 'blue') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', accent);
  local.set('accent', accent);
};

// Shows the icon for the theme you would switch TO.
export const themeToggleButton = (extraClass = '') => `
  <button class="btn btn--ghost btn--icon theme-toggle ${extraClass}" type="button" data-action="toggle-theme" aria-label="Switch between light and dark theme" title="Switch theme">
    <span class="theme-toggle__to-light">${icon('sun')}</span>
    <span class="theme-toggle__to-dark">${icon('moon')}</span>
  </button>`;

/* --------------------------------------------------------------------------
   TOASTS
   -------------------------------------------------------------------------- */
const TOAST_ICONS = { success: 'check-circle', danger: 'alert-circle', info: 'info' };

export const toast = (message, { type = 'info', duration = 5000 } = {}) => {
  const region = document.getElementById('toasts');
  if (!region) return;

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  el.innerHTML = `
    ${icon(TOAST_ICONS[type] || 'info', 18)}
    <span class="toast__msg">${esc(message)}</span>
    <button class="toast__close" type="button" aria-label="Dismiss">${icon('x', 16)}</button>`;

  const dismiss = () => el.remove();
  el.querySelector('.toast__close').addEventListener('click', dismiss);
  region.appendChild(el);
  while (region.children.length > 3) region.firstElementChild.remove();
  if (duration > 0) setTimeout(dismiss, duration);
};

/* --------------------------------------------------------------------------
   DIALOGS
   Native <dialog>: focus trapping, Escape and the inert background come from
   the browser. `variant` picks the presentation:
     ''                 centred modal
     'dialog--sheet'    centred on desktop, bottom sheet on phones
     'dialog--popover'  anchored under the top bar, bottom sheet on phones
   -------------------------------------------------------------------------- */
export const openDialog = ({
  title,
  body = '',
  footer = '',
  variant = 'dialog--sheet',
  dismissible = true,
  flush = false,
  onClose
}) => {
  const dialog = document.createElement('dialog');
  dialog.className = `dialog ${variant}`;
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `
    <div class="dialog__header">
      <h2 class="dialog__title" id="${titleId}">${esc(title)}</h2>
      ${dismissible ? `<button class="btn btn--ghost btn--icon btn--sm" type="button" data-dialog-close aria-label="Close">${icon('x')}</button>` : ''}
    </div>
    <div class="dialog__body${flush ? ' dialog__body--flush' : ''}">${body}</div>
    ${footer ? `<div class="dialog__footer">${footer}</div>` : ''}`;

  const close = () => { if (dialog.open) dialog.close(); };

  dialog.addEventListener('cancel', (e) => { if (!dismissible) e.preventDefault(); });
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-dialog-close]')) { close(); return; }
    // A click that lands on the <dialog> itself is a click on the backdrop.
    if (dismissible && e.target === dialog) close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onClose) onClose();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  return { el: dialog, close };
};

export const confirmDialog = ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) =>
  new Promise((resolve) => {
    let confirmed = false;
    const dlg = openDialog({
      title,
      body: `<p>${esc(message)}</p>`,
      footer: `
        <button class="btn btn--secondary" type="button" data-dialog-close>${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm>${esc(confirmLabel)}</button>`,
      onClose: () => resolve(confirmed)
    });
    dlg.el.querySelector('[data-confirm]').addEventListener('click', () => {
      confirmed = true;
      dlg.close();
    });
  });

/* --------------------------------------------------------------------------
   STATES
   -------------------------------------------------------------------------- */
export const emptyState = ({ iconName = 'inbox', title, text = '', action = '', compact = false }) => `
  <div class="state${compact ? ' state--compact' : ''}">
    <span class="state__icon">${icon(iconName, 22)}</span>
    <p class="state__title">${esc(title)}</p>
    ${text ? `<p class="state__text">${esc(text)}</p>` : ''}
    ${action}
  </div>`;

export const errorState = ({ title, text = 'Check your connection and try again.', retry = 'retry', compact = false }) => `
  <div class="state state--error${compact ? ' state--compact' : ''}" role="alert">
    <span class="state__icon">${icon('alert-circle', 22)}</span>
    <p class="state__title">${esc(title)}</p>
    <p class="state__text">${esc(text)}</p>
    ${retry ? `<button class="btn btn--secondary btn--sm" type="button" data-action="${esc(retry)}">${icon('refresh', 16)}<span>Try again</span></button>` : ''}
  </div>`;

export const skeletonRows = (rows = 4) => `
  <div class="skeleton-stack" aria-busy="true" aria-label="Loading">
    <span class="skeleton skeleton--title"></span>
    ${Array.from({ length: rows }, (_, i) => `<span class="skeleton" style="width:${[92, 78, 86, 64, 72][i % 5]}%"></span>`).join('')}
  </div>`;

export const skeletonBlocks = (rows = 3) => `
  <div class="skeleton-stack" aria-busy="true" aria-label="Loading">
    ${Array.from({ length: rows }, () => '<span class="skeleton skeleton--block"></span>').join('')}
  </div>`;

/* --------------------------------------------------------------------------
   SMALL PIECES
   -------------------------------------------------------------------------- */
export const badge = (text, tone = '', extra = '') =>
  `<span class="badge${tone ? ` badge--${tone}` : ''}${extra ? ` ${extra}` : ''}">${esc(text)}</span>`;

export const alertBox = ({ tone = '', iconName = 'info', title = '', text = '' }) => `
  <div class="alert${tone ? ` alert--${tone}` : ''}" role="${tone === 'danger' ? 'alert' : 'status'}">
    ${icon(iconName, 18)}
    <div class="alert__body">
      ${title ? `<span class="alert__title">${esc(title)}</span>` : ''}
      ${text ? `<span>${esc(text)}</span>` : ''}
    </div>
  </div>`;

export const progressBar = ({ value, tone = '', mark = null, small = false, label = '' }) => {
  const width = Math.min(100, Math.max(0, Number(value) || 0));
  return `
    <div class="progress${tone ? ` progress--${tone}` : ''}${small ? ' progress--sm' : ''}" role="img" aria-label="${esc(label || `${width.toFixed(0)}%`)}">
      <span class="progress__fill" style="width:${width}%"></span>
      ${mark != null ? `<span class="progress__mark" style="left:calc(${mark}% - 1px)"></span>` : ''}
    </div>`;
};

export const stepper = ({ field, value, label }) => `
  <div class="stepper" role="group" aria-label="${esc(label)}">
    <button class="stepper__btn" type="button" data-step="${esc(field)}" data-delta="-1" data-fk="step:${esc(field)}:-1" aria-label="Decrease ${esc(label)}">${icon('minus', 18)}</button>
    <span class="stepper__value" aria-live="polite">${esc(value)}</span>
    <button class="stepper__btn" type="button" data-step="${esc(field)}" data-delta="1" data-fk="step:${esc(field)}:1" aria-label="Increase ${esc(label)}">${icon('plus', 18)}</button>
  </div>`;

export const avatar = ({ photo, initials, large = false }) => `
  <span class="avatar${large ? ' avatar--lg' : ''}" data-initials="${esc(initials)}">${
    photo ? `<img src="${esc(photo)}" alt="" data-avatar-img>` : esc(initials)
  }</span>`;

// A photo ticket that has expired just falls back to initials.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-avatar-img')) return;
  const holder = img.parentElement;
  if (holder) holder.textContent = holder.dataset.initials || '';
}, true);

/* Views re-render a region by replacing its markup. Controls that should keep
   keyboard focus across that carry a data-fk key; this restores focus to the
   element with the same key afterwards. */
export const renderKeepingFocus = (container, html) => {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.getAttribute('data-fk') : null;
  container.innerHTML = html;
  if (key) {
    const next = container.querySelector(`[data-fk="${CSS.escape(key)}"]`);
    if (next) next.focus({ preventScroll: true });
  }
};

/* Freshness line + refresh button used at the top of every data page:
   "Updated 10:42", "Updating…", or a warning when only a saved copy is
   available. */
export const freshness = (meta, { action = 'refresh', label = 'Refresh' } = {}) => {
  let text = '';
  let tone = '';

  if (meta.refreshing || meta.status === 'loading') {
    text = 'Updating…';
  } else if (meta.failed && meta.stale && meta.updatedAt) {
    text = `Couldn't refresh. Showing the copy saved at ${clockTime(meta.updatedAt)}.`;
    tone = 'warning';
  } else if (meta.stale && meta.updatedAt) {
    text = `Saved copy from ${clockTime(meta.updatedAt)}`;
  } else if (meta.updatedAt) {
    text = `Updated ${clockTime(meta.updatedAt)}`;
  }

  const busy = meta.refreshing || meta.status === 'loading';
  return `
    <div class="freshness${tone ? ` freshness--${tone}` : ''}">
      <span class="freshness__text" aria-live="polite">${esc(text)}</span>
      <button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="${esc(action)}" aria-label="${esc(label)}" title="${esc(label)}" ${busy ? 'disabled' : ''}>
        ${icon('refresh', 18, busy ? 'is-spinning' : '')}
      </button>
    </div>`;
};
