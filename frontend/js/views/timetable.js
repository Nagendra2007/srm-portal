/* Timetable: one day as a time-ordered list, or the whole week as a grid
   (stacked day by day on phones). */

import { esc, plural } from '../lib/dom.js';
import { state, subscribe, ensureTimetable, loadToday, dayOrder } from '../lib/store.js';
import {
  buildSubjectMap, countClasses, findToday, hasSchedule, liveStatus, normalizeDay, trimFreeEdges
} from '../lib/schedule.js';
import { badge, emptyState, errorState, freshness, renderKeepingFocus, skeletonBlocks } from '../lib/ui.js';
import { agendaHtml } from '../lib/widgets.js';

const view = {
  mode: 'day',  // 'day' | 'week'
  day: null     // null = today (or the first day when today has no classes)
};

const markedByHour = () => {
  const map = new Map();
  const periods = state.today && Array.isArray(state.today.periods) ? state.today.periods : [];
  periods.forEach((p) => {
    const hour = parseInt(p.hour, 10);
    if (!Number.isNaN(hour)) map.set(hour, p.status);
  });
  return map;
};

const dayRange = (slots) => {
  const classes = slots.filter((s) => !s.isFree && s.startText);
  if (classes.length === 0) return '';
  return `${classes[0].startText} – ${classes[classes.length - 1].endText}`;
};

/* --------------------------------------------------------------------------
   DAY
   -------------------------------------------------------------------------- */
const dayHtml = (schedule, subjectMap, today) => {
  const selectedName = schedule.some((s) => s.day === view.day)
    ? view.day
    : (today ? today.day : schedule[0].day);
  const selected = schedule.find((s) => s.day === selectedName);
  const isToday = !!today && today.day === selectedName;

  const slots = normalizeDay(selected, subjectMap);
  const visible = trimFreeEdges(slots);
  const count = countClasses(slots);
  const range = dayRange(slots);

  const tabs = schedule.map((s) => {
    const todayTab = !!today && today.day === s.day;
    return `
      <button class="tab" type="button" role="tab" data-day="${esc(s.day)}" data-fk="day:${esc(s.day)}" aria-selected="${s.day === selectedName}">
        ${esc(s.day)}${todayTab ? '<span class="dot dot--accent" title="Today"></span><span class="sr-only">(today)</span>' : ''}
      </button>`;
  }).join('');

  return `
    <section class="card">
      <div class="tabs tabs--inset" role="tablist" aria-label="Day">${tabs}</div>
      <div class="card__header">
        <div>
          <h2 class="card__title">${esc(selectedName)}${isToday ? ` ${badge('Today', 'accent')}` : ''}</h2>
          <p class="card__sub">${plural(count, 'class', 'classes')}${range ? ` · ${esc(range)}` : ''}</p>
        </div>
      </div>
      ${visible.length > 0
        ? agendaHtml(visible, isToday ? { live: liveStatus(slots), marked: markedByHour() } : {})
        : emptyState({ iconName: 'coffee', title: 'No classes', text: `Nothing is scheduled for ${selectedName}.`, compact: true })}
    </section>`;
};

/* --------------------------------------------------------------------------
   WEEK
   -------------------------------------------------------------------------- */
const weekHtml = (schedule, subjectMap, today) => {
  const days = schedule.map((s) => ({ name: s.day, slots: normalizeDay(s, subjectMap) }));
  const rowCount = Math.max(...days.map((d) => d.slots.length));

  // Drop rows that are free on every day at the start and end of the grid.
  let first = 0;
  let last = rowCount - 1;
  const rowIsEmpty = (i) => days.every((d) => !d.slots[i] || d.slots[i].isFree);
  while (first < last && rowIsEmpty(first)) first += 1;
  while (last > first && rowIsEmpty(last)) last -= 1;

  const rows = [];
  for (let i = first; i <= last; i += 1) {
    const sample = days.map((d) => d.slots[i]).find(Boolean);
    const time = sample
      ? (sample.startText ? `${sample.startText} – ${sample.endText}` : sample.time)
      : '';
    rows.push(`
      <tr>
        <th scope="row" class="week__period">
          <span class="week__period-num">P${esc(sample ? sample.period : i + 1)}</span>
          <span class="week__period-time num">${esc(time)}</span>
        </th>
        ${days.map((d) => {
          const slot = d.slots[i];
          const todayCol = !!today && today.day === d.name;
          if (!slot || slot.isFree) return `<td class="week__cell is-free${todayCol ? ' is-today' : ''}"><span class="sr-only">Free</span></td>`;
          return `
            <td class="week__cell${todayCol ? ' is-today' : ''}">
              <span class="week__title">${esc(slot.title)}</span>
              <span class="week__sub"><span class="code">${esc(slot.code)}</span>${slot.room ? ` · ${esc(slot.room)}` : ''}</span>
            </td>`;
        }).join('')}
      </tr>`);
  }

  const grid = `
    <section class="card from-md">
      <div class="table-wrap">
        <table class="table week">
          <thead>
            <tr>
              <th scope="col">Period</th>
              ${days.map((d) => `<th scope="col" class="${today && today.day === d.name ? 'is-today' : ''}">${esc(d.name)}${today && today.day === d.name ? ' · Today' : ''}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </section>`;

  const stacked = `
    <div class="stack until-md">
      ${days.map((d) => {
        const visible = trimFreeEdges(d.slots);
        const isToday = !!today && today.day === d.name;
        return `
          <section class="card">
            <div class="card__header">
              <div>
                <h2 class="card__title">${esc(d.name)}${isToday ? ` ${badge('Today', 'accent')}` : ''}</h2>
                <p class="card__sub">${plural(countClasses(d.slots), 'class', 'classes')}${dayRange(d.slots) ? ` · ${esc(dayRange(d.slots))}` : ''}</p>
              </div>
            </div>
            ${visible.length > 0
              ? agendaHtml(visible.filter((s) => !s.isFree))
              : emptyState({ iconName: 'coffee', title: 'No classes', compact: true })}
          </section>`;
      }).join('')}
    </div>`;

  return grid + stacked;
};

/* --------------------------------------------------------------------------
   VIEW
   -------------------------------------------------------------------------- */
const bodyHtml = () => {
  const meta = state.meta.timetable;

  if (!hasSchedule(state.timetable)) {
    if (meta.status === 'error') {
      return `<section class="card">${errorState({ title: "Couldn't load the timetable", retry: 'refresh' })}</section>`;
    }
    if (state.timetable && meta.status === 'ready' && !meta.refreshing) {
      return `<section class="card">${emptyState({ iconName: 'calendar', title: 'No timetable data found', text: 'The portal has not published a timetable for you yet.' })}</section>`;
    }
    return `<section class="card">${skeletonBlocks(4)}</section>`;
  }

  const schedule = state.timetable.schedule;
  const subjectMap = buildSubjectMap(state.timetable);
  const today = findToday(state.timetable, dayOrder());

  return view.mode === 'week'
    ? weekHtml(schedule, subjectMap, today)
    : dayHtml(schedule, subjectMap, today);
};

export default {
  mount(root) {
    root.innerHTML = `
      <div class="page-toolbar">
        <div class="segmented" role="group" aria-label="Timetable view" data-region="mode"></div>
        <div data-region="fresh"></div>
      </div>
      <div class="stack" data-region="body"></div>`;

    const modeEl = root.querySelector('[data-region="mode"]');
    const freshEl = root.querySelector('[data-region="fresh"]');
    const bodyEl = root.querySelector('[data-region="body"]');

    const render = () => {
      renderKeepingFocus(modeEl, `
        <button class="segmented__btn" type="button" data-mode="day" data-fk="mode:day" aria-pressed="${view.mode === 'day'}">Day</button>
        <button class="segmented__btn" type="button" data-mode="week" data-fk="mode:week" aria-pressed="${view.mode === 'week'}">Week</button>`);
      freshEl.innerHTML = freshness(state.meta.timetable);
      renderKeepingFocus(bodyEl, bodyHtml());
    };

    render();

    const off = subscribe((key) => {
      if (key === 'timetable' || key === 'today') render();
    });

    // Keeps the "Now" marker on today's list in step with the clock.
    const timer = setInterval(render, 30 * 1000);

    root.addEventListener('click', (e) => {
      const mode = e.target.closest('[data-mode]');
      if (mode) {
        view.mode = mode.dataset.mode;
        render();
        return;
      }

      const day = e.target.closest('[data-day]');
      if (day) {
        view.day = day.dataset.day;
        render();
        return;
      }

      if (e.target.closest('[data-action="refresh"]')) {
        ensureTimetable({ force: true }).catch(() => {});
      }
    });

    const timetableRequest = ensureTimetable();
    timetableRequest.catch(() => {});
    // The portal's day order decides which "Day N" is today.
    Promise.allSettled([timetableRequest]).then(() => {
      if (root.isConnected) loadToday().catch(() => {});
    });

    return () => {
      off();
      clearInterval(timer);
    };
  }
};
