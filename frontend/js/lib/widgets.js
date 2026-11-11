/* Larger shared pieces that appear on more than one page: the attendance
   code form, today's attendance status, and the saved-profiles list. */

import { esc, getInitials, plural } from './dom.js';
import { icon } from './icons.js';
import { state, markAttendance } from './store.js';
import { getSavedAccounts } from './storage.js';
import { alertBox, avatar, badge, emptyState, errorState, skeletonRows } from './ui.js';

/* --------------------------------------------------------------------------
   ATTENDANCE CODE FORM
   Seven single-character boxes: one letter, then six digits. Separate boxes
   keep the phone keyboard on letters for the first character and on digits
   for the rest.
   -------------------------------------------------------------------------- */
const CODE_LENGTH = 7;

export const markFormHtml = () => {
  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => (i === 0
    ? '<input class="code-box" type="text" maxlength="1" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="A" aria-label="Character 1 of 7, a letter">'
    : `<input class="code-box" type="text" maxlength="1" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="Character ${i + 1} of 7, a digit">`
  )).join('');

  return `
    <form class="code-form" data-code-form novalidate>
      <fieldset class="code-form__field">
        <legend class="label">Attendance code</legend>
        <div class="code-boxes" data-code-boxes>${boxes}</div>
        <p class="field__hint code-form__hint">One letter followed by six digits.</p>
      </fieldset>
      <div data-code-status></div>
      <button class="btn btn--primary btn--block" type="submit">${icon('check-circle', 18)}<span>Mark attendance</span></button>
    </form>`;
};

const cleanChar = (char, index) => char.replace(index === 0 ? /[^a-zA-Z]/g : /[^0-9]/g, '').toUpperCase();

export const bindMarkForm = (root) => {
  const form = root.querySelector('[data-code-form]');
  if (!form) return;

  const wrap = form.querySelector('[data-code-boxes]');
  const boxes = Array.from(form.querySelectorAll('.code-box'));
  const statusEl = form.querySelector('[data-code-status]');
  const submitBtn = form.querySelector('button[type="submit"]');

  const clearStatus = () => {
    statusEl.innerHTML = '';
    wrap.classList.remove('is-error', 'is-success');
  };

  const showStatus = (message, isError) => {
    statusEl.innerHTML = alertBox({
      tone: isError ? 'danger' : 'success',
      iconName: isError ? 'alert-circle' : 'check-circle',
      text: message
    });
    wrap.classList.toggle('is-error', isError);
    wrap.classList.toggle('is-success', !isError);
  };

  boxes.forEach((box, index) => {
    box.addEventListener('focus', () => box.select());

    box.addEventListener('input', () => {
      box.value = cleanChar(box.value, index);
      clearStatus();
      if (box.value && index < boxes.length - 1) boxes[index + 1].focus();
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        boxes[index - 1].focus();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        boxes[index - 1].focus();
      } else if (e.key === 'ArrowRight' && index < boxes.length - 1) {
        e.preventDefault();
        boxes[index + 1].focus();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase();
      pasted.split('').forEach((char, i) => {
        if (boxes[i]) boxes[i].value = cleanChar(char, i);
      });
      clearStatus();
      const lastFilled = Math.min(pasted.length, boxes.length) - 1;
      if (lastFilled >= 0) boxes[lastFilled].focus();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const acode = boxes.map((box) => box.value).join('');
    if (acode.length !== CODE_LENGTH) {
      showStatus('Please enter all 7 characters of the code', true);
      const firstEmpty = boxes.find((box) => !box.value);
      if (firstEmpty) firstEmpty.focus();
      return;
    }

    clearStatus();
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');

    const result = await markAttendance(acode);

    submitBtn.disabled = false;
    submitBtn.classList.remove('is-loading');
    if (!form.isConnected || result.kind === 'auth') return;

    if (result.kind === 'success') {
      showStatus(result.message, false);
      boxes.forEach((box) => { box.value = ''; });
    } else {
      showStatus(result.message, true);
    }
  });
};

/* --------------------------------------------------------------------------
   TODAY'S ATTENDANCE STATUS
   -------------------------------------------------------------------------- */
export const periodStatus = (status) => {
  if (status === 'P') return { label: 'Present', tone: 'success' };
  if (status === 'A') return { label: 'Absent', tone: 'danger' };
  return { label: status || '—', tone: '' };
};

export const todayStatusHtml = ({ retry = 'refresh-today' } = {}) => {
  const today = state.today;
  const meta = state.meta.today;

  if (!today) {
    if (meta.status === 'error') {
      return errorState({ title: "Couldn't load today's attendance", retry, compact: true });
    }
    return skeletonRows(3);
  }

  const { dayOrder, onlineAttendance, periods } = today;
  const hasOnline = Array.isArray(onlineAttendance) && onlineAttendance.length > 0;
  const hasPeriods = Array.isArray(periods) && periods.length > 0;

  if (!hasPeriods && !hasOnline && !dayOrder) {
    return emptyState({
      iconName: 'clock',
      title: 'Nothing recorded yet',
      text: 'No attendance activity has been recorded for today.',
      compact: true
    });
  }

  let html = '';

  if (dayOrder) {
    html += `<div class="today-status__meta"><span class="muted small">Day order</span>${badge(dayOrder, 'accent')}</div>`;
  }

  if (hasOnline) {
    html += `
      <p class="section-label">Online attendance</p>
      <ul class="list">
        ${onlineAttendance.map((line) => `<li class="row"><span class="row__body">${esc(line)}</span></li>`).join('')}
      </ul>`;
  }

  if (hasPeriods) {
    html += `
      <p class="section-label">Marked today · ${plural(periods.length, 'hour')}</p>
      <ul class="list">
        ${periods.map((p) => {
          const status = periodStatus(p.status);
          return `
            <li class="row">
              <span class="hour-chip num">${esc(p.hour)}</span>
              <span class="row__body"><span class="row__title">${esc(p.subject)}</span></span>
              <span class="row__end">${badge(status.label, status.tone)}</span>
            </li>`;
        }).join('')}
      </ul>`;
  }

  return html;
};

/* --------------------------------------------------------------------------
   AGENDA
   One day's periods as a time-ordered list. `live` (from liveStatus) marks
   the current and next class; `marked` maps hour -> today's attendance status.
   -------------------------------------------------------------------------- */
export const agendaHtml = (slots, { live = null, marked = null } = {}) => `
  <ol class="agenda">
    ${slots.map((slot) => {
      const isNow = !!live && live.current === slot;
      const isNext = !!live && live.next === slot && !(live.current && !live.current.isFree);
      const isPast = !!live && slot.endMin != null && slot.endMin <= live.minutes;

      let end = '';
      const status = marked && !slot.isFree ? marked.get(parseInt(slot.period, 10)) : undefined;
      if (status !== undefined) {
        const s = periodStatus(status);
        end = badge(s.label, s.tone);
      } else if (isNow && !slot.isFree) {
        end = badge('Now', 'accent');
      } else if (isNext) {
        end = badge('Next');
      }

      const time = slot.startText
        ? `<span>${esc(slot.startText)}</span><span class="agenda__time-end">${esc(slot.endText)}</span>`
        : `<span>${esc(slot.time || `P${slot.period}`)}</span>`;

      return `
        <li class="agenda__item${isNow ? ' is-now' : ''}${isPast ? ' is-past' : ''}${slot.isFree ? ' is-free' : ''}">
          <div class="agenda__time num">${time}</div>
          <div class="agenda__body">
            ${slot.isFree
              ? '<span class="agenda__sub">Free period</span>'
              : `<span class="agenda__title">${esc(slot.title)}</span>
                 <span class="agenda__sub">${slot.code ? `<span class="code">${esc(slot.code)}</span>` : ''}${slot.room ? `<span>${icon('pin', 14)}${esc(slot.room)}</span>` : ''}<span class="agenda__period">Period ${esc(slot.period)}</span></span>`}
          </div>
          <div class="agenda__end">${end}</div>
        </li>`;
    }).join('')}
  </ol>`;

/* --------------------------------------------------------------------------
   SAVED PROFILES
   Rendered in the account menu and on the Profile page. The click handling
   for these data-attributes lives in shell.js.
   -------------------------------------------------------------------------- */
export const accountsListHtml = () => {
  const accounts = getSavedAccounts();

  if (accounts.length === 0) {
    return '<p class="muted small accounts__empty">No saved profiles yet.</p>';
  }

  return `
    <ul class="list accounts">
      ${accounts.map((account) => {
        const isActive = account.username === state.username;
        const name = account.displayName || account.username;
        const photo = isActive && state.profile ? state.profile.photo : null;
        return `
          <li class="accounts__item">
            <button class="row accounts__main" type="button" data-switch-account="${esc(account.username)}" ${isActive ? 'aria-current="true"' : ''}>
              ${avatar({ photo, initials: getInitials(name) })}
              <span class="row__body">
                <span class="row__title truncate">${esc(name)}</span>
                <span class="row__sub truncate">${esc(account.username)}</span>
              </span>
              ${isActive ? badge('Active', 'success') : ''}
            </button>
            <button class="btn btn--ghost btn--icon btn--sm accounts__remove" type="button" data-remove-account="${esc(account.username)}" aria-label="Remove ${esc(name)} from this device" title="Remove from this device">${icon('trash', 18)}</button>
          </li>`;
      }).join('')}
    </ul>`;
};
