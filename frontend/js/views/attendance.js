/* Attendance: every subject with its margin, a per-subject planner, an
   all-subjects "what if", and today's recorded status.

   View state lives at module level so a background data refresh — or leaving
   the page and coming back — never resets what the student had open. */

import { esc, plural } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { state, subscribe, ensureAttendance, refreshAllAttendance, loadToday } from '../lib/store.js';
import {
  MIN_ATTENDANCE, attendancePct, fmtPct, classesCanSkip, classesNeeded, summarize
} from '../lib/attendance-math.js';
import {
  badge, emptyState, errorState, freshness, progressBar, renderKeepingFocus, skeletonBlocks, stepper
} from '../lib/ui.js';
import { todayStatusHtml } from '../lib/widgets.js';

const TABS = [
  { id: 'subjects', label: 'Subjects' },
  { id: 'whatif', label: 'What if' },
  { id: 'today', label: 'Today' }
];

const SORTS = [
  { id: 'default', label: 'Portal order' },
  { id: 'low', label: 'Lowest first' },
  { id: 'high', label: 'Highest first' }
];

const view = {
  tab: 'subjects',
  sort: 'default',
  whatIf: { attend: 0, miss: 0 },
  planner: null // null | { code, mode: 'bunk' | 'future', n }
};

const sortedSubjects = () => {
  const list = [...state.attendance];
  if (view.sort === 'low') list.sort((a, b) => a.attendancePercent - b.attendancePercent);
  if (view.sort === 'high') list.sort((a, b) => b.attendancePercent - a.attendancePercent);
  return list;
};

/* --------------------------------------------------------------------------
   SUBJECTS
   -------------------------------------------------------------------------- */
const plannerHtml = (subject) => {
  const planner = view.planner;
  const isBunk = planner.mode === 'bunk';
  const present = subject.present + (isBunk ? 0 : planner.n);
  const total = subject.total + planner.n;
  const projected = attendancePct(present, total);
  const isSafe = projected >= MIN_ATTENDANCE;

  let hint;
  if (isBunk) {
    const maxSkip = classesCanSkip(subject.present, subject.total);
    hint = maxSkip > 0
      ? `You can skip up to ${plural(maxSkip, 'class', 'classes')} and stay at ${MIN_ATTENDANCE}%.`
      : `No room to skip — you are at or below ${MIN_ATTENDANCE}%.`;
  } else {
    const needed = classesNeeded(subject.present, subject.total);
    hint = needed > 0
      ? `Attend the next ${plural(needed, 'class', 'classes')} in a row to reach ${MIN_ATTENDANCE}%.`
      : `You are already above ${MIN_ATTENDANCE}%.`;
  }

  const stepLabel = isBunk ? 'Classes to skip' : 'Classes to attend';

  return `
    <div class="att-plan">
      <div class="segmented" role="group" aria-label="Planner mode">
        <button class="segmented__btn" type="button" data-plan-mode="bunk" data-fk="mode:bunk" aria-pressed="${isBunk}">Skip classes</button>
        <button class="segmented__btn" type="button" data-plan-mode="future" data-fk="mode:future" aria-pressed="${!isBunk}">Attend classes</button>
      </div>
      <div class="att-plan__control">
        <span class="label">${stepLabel}</span>
        ${stepper({ field: 'planner', value: planner.n, label: stepLabel })}
      </div>
      <div class="att-plan__result">
        <span class="muted small">Attendance becomes</span>
        ${badge(fmtPct(projected), isSafe ? 'success' : 'danger', 'badge--lg')}
      </div>
      <p class="field__hint att-plan__hint">${esc(hint)}</p>
    </div>`;
};

const subjectHtml = (subject) => {
  const isGood = subject.attendancePercent >= MIN_ATTENDANCE;
  const tone = isGood ? 'success' : 'danger';
  const needed = classesNeeded(subject.present, subject.total);
  const isOpen = !!view.planner && view.planner.code === subject.code;

  const margin = isGood
    ? (subject.canSkip > 0 ? `Can skip ${subject.canSkip}` : 'No skips left')
    : `Attend next ${needed}`;

  return `
    <li class="att-item${isOpen ? ' is-open' : ''}" data-code="${esc(subject.code)}">
      <div class="att-item__row">
        <div class="att-item__subject">
          <span class="att-item__name">${esc(subject.description)}</span>
          <span class="code">${esc(subject.code)}</span>
        </div>
        <div class="att-item__meter">
          ${progressBar({ value: subject.attendancePercent, tone, mark: MIN_ATTENDANCE, label: `${subject.attendancePercent}% attendance, minimum ${MIN_ATTENDANCE}%` })}
        </div>
        <div class="att-item__pct">${badge(`${subject.attendancePercent}%`, tone, 'badge--lg')}</div>
        <dl class="att-item__nums num">
          <div><dt>Present</dt><dd>${esc(subject.present)}</dd></div>
          <div><dt>Absent</dt><dd>${esc(subject.absent)}</dd></div>
          <div><dt>Total</dt><dd>${esc(subject.total)}</dd></div>
        </dl>
        <div class="att-item__margin">
          <span class="dot dot--${tone}"></span><span>${esc(margin)}</span>
        </div>
        <div class="att-item__action">
          <button class="btn btn--secondary btn--sm" type="button" data-plan data-fk="plan:${esc(subject.code)}" aria-expanded="${isOpen}">
            ${icon('sliders', 16)}<span>Plan</span>
          </button>
        </div>
      </div>
      ${isOpen ? plannerHtml(subject) : ''}
    </li>`;
};

const summaryHtml = (subjects) => {
  const summary = summarize(subjects);
  const ok = summary.overall >= MIN_ATTENDANCE;
  return `
    <section class="card att-overview" aria-label="Overall attendance">
      <div class="att-summary">
        <div class="att-summary__head">
          <span class="att-summary__pct num">${summary.overall.toFixed(1)}%</span>
          <span class="muted small">overall · ${summary.present} of ${summary.total} classes attended</span>
        </div>
        ${progressBar({ value: summary.overall, tone: ok ? 'success' : 'danger', mark: MIN_ATTENDANCE, label: `Overall attendance ${summary.overall.toFixed(1)}%, minimum ${MIN_ATTENDANCE}%` })}
        <div class="att-summary__legend small">
          ${summary.below > 0 ? `<span><span class="dot dot--danger"></span>${plural(summary.below, 'subject')} below ${MIN_ATTENDANCE}%</span>` : ''}
          <span><span class="dot dot--success"></span>${plural(summary.safe, 'subject')} at or above ${MIN_ATTENDANCE}%</span>
          <span class="muted">The marker shows the ${MIN_ATTENDANCE}% minimum.</span>
        </div>
      </div>
    </section>`;
};

const subjectsHtml = () => {
  const subjects = sortedSubjects();
  return `
    ${summaryHtml(state.attendance)}
    <section class="card" aria-labelledby="attSubjectsTitle">
      <div class="card__header">
        <div>
          <h2 class="card__title" id="attSubjectsTitle">Subjects</h2>
          <p class="card__sub">${plural(subjects.length, 'subject')} · minimum ${MIN_ATTENDANCE}%</p>
        </div>
        <label class="sort-control">
          <span class="muted small">Sort</span>
          <select class="select select--sm" data-sort data-fk="sort" aria-label="Sort subjects">
            ${SORTS.map((s) => `<option value="${s.id}" ${view.sort === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="att-list">
        <div class="att-list__head" aria-hidden="true">
          <span>Subject</span><span>Attendance</span><span></span>
          <span class="is-num">Present</span><span class="is-num">Absent</span><span class="is-num">Total</span>
          <span>Margin</span><span></span>
        </div>
        <ul class="list">${subjects.map(subjectHtml).join('')}</ul>
      </div>
    </section>`;
};

/* --------------------------------------------------------------------------
   WHAT IF
   -------------------------------------------------------------------------- */
const whatIfHtml = () => {
  const { attend, miss } = view.whatIf;
  const rows = sortedSubjects().map((subject) => {
    const projected = attendancePct(subject.present + attend, subject.total + attend + miss);
    const ok = projected >= MIN_ATTENDANCE;
    return `
      <tr>
        <td><span class="cell-title">${esc(subject.description)}</span><span class="cell-sub code">${esc(subject.code)}</span></td>
        <td class="is-num muted">${esc(subject.attendancePercent)}%</td>
        <td class="is-num">${badge(fmtPct(projected), ok ? 'success' : 'danger')}</td>
      </tr>`;
  }).join('');

  return `
    <section class="card" aria-labelledby="whatIfTitle">
      <div class="card__header">
        <div>
          <h2 class="card__title" id="whatIfTitle">What if, in every subject</h2>
          <p class="card__sub">Projected against the ${MIN_ATTENDANCE}% minimum. Nothing here is submitted.</p>
        </div>
      </div>
      <div class="card__body whatif">
        <div class="whatif__control">
          <span class="label">Classes I attend next</span>
          ${stepper({ field: 'attend', value: attend, label: 'classes to attend' })}
        </div>
        <div class="whatif__control">
          <span class="label">Classes I miss next</span>
          ${stepper({ field: 'miss', value: miss, label: 'classes to miss' })}
        </div>
      </div>
      <div class="table-wrap">
        <table class="table table--compact">
          <thead><tr><th>Subject</th><th class="is-num">Now</th><th class="is-num">Projected</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
};

/* --------------------------------------------------------------------------
   TODAY
   -------------------------------------------------------------------------- */
const todayHtml = () => `
  <section class="card" aria-labelledby="attTodayTitle">
    <div class="card__header">
      <div>
        <h2 class="card__title" id="attTodayTitle">Today's attendance</h2>
        <p class="card__sub">What the SRM portal has recorded so far today.</p>
      </div>
    </div>
    <div class="card__body card__body--flush today-status">${todayStatusHtml({ retry: 'refresh' })}</div>
  </section>`;

/* --------------------------------------------------------------------------
   VIEW
   -------------------------------------------------------------------------- */
const bodyHtml = () => {
  if (view.tab === 'today') return todayHtml();

  const subjects = state.attendance;
  const meta = state.meta.attendance;

  if (!Array.isArray(subjects)) {
    return meta.status === 'error'
      ? `<section class="card">${errorState({ title: "Couldn't load attendance", retry: 'refresh' })}</section>`
      : `<section class="card">${skeletonBlocks(4)}</section>`;
  }
  if (subjects.length === 0) {
    return `<section class="card">${emptyState({ iconName: 'chart', title: 'No attendance data found', text: 'The portal has not recorded any attendance for this term yet.' })}</section>`;
  }

  return view.tab === 'whatif' ? whatIfHtml() : subjectsHtml();
};

export default {
  mount(root) {
    root.innerHTML = `
      <div class="page-toolbar page-toolbar--tabs">
        <div class="tabs" role="tablist" aria-label="Attendance views" data-region="tabs"></div>
        <div data-region="fresh"></div>
      </div>
      <div class="stack" data-region="body" role="tabpanel"></div>`;

    const tabsEl = root.querySelector('[data-region="tabs"]');
    const freshEl = root.querySelector('[data-region="fresh"]');
    const bodyEl = root.querySelector('[data-region="body"]');

    const render = () => {
      renderKeepingFocus(tabsEl, TABS.map((tab) => `
        <button class="tab" type="button" role="tab" data-tab="${tab.id}" data-fk="tab:${tab.id}" aria-selected="${view.tab === tab.id}">${tab.label}</button>`).join(''));
      freshEl.innerHTML = freshness(view.tab === 'today' ? state.meta.today : state.meta.attendance);
      renderKeepingFocus(bodyEl, bodyHtml());
    };

    const refresh = () => {
      if (view.tab === 'today') loadToday({ force: true }).catch(() => {});
      else refreshAllAttendance();
    };

    render();

    const off = subscribe((key) => {
      if (key === 'attendance' || key === 'today') render();
    });

    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        if (view.tab === tab.dataset.tab) return;
        view.tab = tab.dataset.tab;
        render();
        // Always a fresh read on open: today's status changes through the day.
        if (view.tab === 'today') loadToday({ force: true }).catch(() => {});
        return;
      }

      if (e.target.closest('[data-action="refresh"]')) {
        refresh();
        return;
      }

      const plan = e.target.closest('[data-plan]');
      if (plan) {
        const code = plan.closest('.att-item').dataset.code;
        view.planner = view.planner && view.planner.code === code ? null : { code, mode: 'bunk', n: 1 };
        render();
        return;
      }

      const mode = e.target.closest('[data-plan-mode]');
      if (mode && view.planner) {
        if (view.planner.mode !== mode.dataset.planMode) {
          view.planner = { ...view.planner, mode: mode.dataset.planMode, n: 1 };
          render();
        }
        return;
      }

      const step = e.target.closest('[data-step]');
      if (step) {
        const delta = Number(step.dataset.delta);
        const clamp = (value) => Math.max(0, Math.min(99, value + delta));
        const field = step.dataset.step;
        if (field === 'planner' && view.planner) view.planner.n = clamp(view.planner.n);
        else if (field === 'attend' || field === 'miss') view.whatIf[field] = clamp(view.whatIf[field]);
        render();
      }
    });

    root.addEventListener('change', (e) => {
      const sort = e.target.closest('[data-sort]');
      if (!sort) return;
      view.sort = sort.value;
      render();
    });

    ensureAttendance().catch(() => {});
    if (view.tab === 'today') loadToday({ force: true }).catch(() => {});

    return off;
  }
};
