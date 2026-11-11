/* Home: what is happening now, the code box, today's classes, and where
   attendance stands — in the order a student actually needs them. */

import { esc, firstName, plural } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { state, subscribe, ensureTimetable, ensureAttendance, loadToday, dayOrder } from '../lib/store.js';
import { getDisplayName } from '../lib/storage.js';
import {
  buildSubjectMap, findToday, normalizeDay, liveStatus, trimFreeEdges, formatDuration,
  hasSchedule, weekdayName
} from '../lib/schedule.js';
import { badge, emptyState, errorState, progressBar, skeletonRows } from '../lib/ui.js';
import { markFormHtml, bindMarkForm, agendaHtml } from '../lib/widgets.js';
import { MIN_ATTENDANCE, classesNeeded, classesCanSkip, summarize } from '../lib/attendance-math.js';

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const todaySlots = () => {
  const today = findToday(state.timetable, dayOrder());
  const slots = today ? normalizeDay(today, buildSubjectMap(state.timetable)) : [];
  return { today, slots };
};

const slotMeta = (slot) => `
  <div class="now__meta">
    ${slot.time ? `<span>${icon('clock', 16)}${esc(slot.time)}</span>` : ''}
    ${slot.room ? `<span>${icon('pin', 16)}${esc(slot.room)}</span>` : ''}
    ${slot.code ? `<span class="code">${esc(slot.code)}</span>` : ''}
  </div>`;

/* --------------------------------------------------------------------------
   NOW
   -------------------------------------------------------------------------- */
const nowHtml = () => {
  if (!hasSchedule(state.timetable)) {
    if (state.meta.timetable.status === 'error') {
      return errorState({ title: "Couldn't load your timetable", retry: 'retry-timetable', compact: true });
    }
    if (state.timetable && state.meta.timetable.status === 'ready' && !state.meta.timetable.refreshing) {
      return emptyState({ iconName: 'calendar', title: 'No timetable yet', text: 'The portal has not published a timetable for you.', compact: true });
    }
    return skeletonRows(3);
  }

  const { slots } = todaySlots();
  const live = liveStatus(slots);
  const { current, next } = live;

  if (live.classes.length === 0) {
    return `
      <div class="now">
        <p class="now__status"><span class="dot"></span>${esc(weekdayName())}</p>
        <h2 class="now__title">No classes today</h2>
        <p class="muted">Nothing is scheduled for today.</p>
      </div>`;
  }

  if (current && !current.isFree) {
    const length = current.endMin - current.startMin;
    const elapsed = live.minutes - current.startMin;
    const left = current.endMin - live.minutes;
    return `
      <div class="now">
        <p class="now__status now__status--live"><span class="dot dot--success"></span>In class now · Period ${esc(current.period)}</p>
        <h2 class="now__title">${esc(current.title)}</h2>
        ${slotMeta(current)}
        <div class="now__progress">
          ${progressBar({ value: (elapsed / length) * 100, tone: 'success', small: true, label: `${formatDuration(left)} left` })}
          <span class="small muted num">${esc(formatDuration(left))} left</span>
        </div>
        ${next ? `
          <div class="now__next">
            <span class="now__next-label">Next</span>
            <span class="now__next-body">
              <strong>${esc(next.title)}</strong>
              <span class="muted small num">${esc(next.startText || next.time)}${next.room ? ` · ${esc(next.room)}` : ''}</span>
            </span>
          </div>` : `
          <div class="now__next"><span class="muted small">This is your last class today.</span></div>`}
      </div>`;
  }

  if (next) {
    const wait = next.startMin - live.minutes;
    const label = current && current.isFree ? 'Free period' : (live.classes.some((s) => s.endMin != null && s.endMin <= live.minutes) ? 'Break' : 'Up next');
    return `
      <div class="now">
        <p class="now__status"><span class="dot dot--accent"></span>${label} · next class in ${esc(formatDuration(wait))}</p>
        <h2 class="now__title">${esc(next.title)}</h2>
        ${slotMeta(next)}
      </div>`;
  }

  return `
    <div class="now">
      <p class="now__status"><span class="dot"></span>Done for today</p>
      <h2 class="now__title">No more classes today</h2>
      <p class="muted">${plural(live.classes.length, 'class', 'classes')} on today's timetable, all finished.</p>
    </div>`;
};

/* --------------------------------------------------------------------------
   TODAY'S CLASSES
   -------------------------------------------------------------------------- */
const markedByHour = () => {
  const map = new Map();
  const periods = state.today && Array.isArray(state.today.periods) ? state.today.periods : [];
  periods.forEach((p) => {
    const hour = parseInt(p.hour, 10);
    if (!Number.isNaN(hour)) map.set(hour, p.status);
  });
  return map;
};

const todayHtml = () => {
  if (!hasSchedule(state.timetable)) {
    return state.meta.timetable.status === 'error'
      ? emptyState({ iconName: 'calendar', title: 'Timetable unavailable', compact: true })
      : skeletonRows(4);
  }

  const { slots } = todaySlots();
  const visible = trimFreeEdges(slots);
  if (visible.length === 0) {
    return emptyState({ iconName: 'coffee', title: 'No classes today', text: 'Open the timetable to see the rest of the week.', compact: true });
  }

  return agendaHtml(visible, { live: liveStatus(slots), marked: markedByHour() });
};

const todaySubHtml = () => {
  const { today, slots } = todaySlots();
  if (!today) return '';
  const count = slots.filter((s) => !s.isFree).length;
  return `${esc(today.day)} · ${plural(count, 'class', 'classes')}`;
};

/* --------------------------------------------------------------------------
   ATTENDANCE SUMMARY
   -------------------------------------------------------------------------- */
const attendanceHtml = () => {
  const subjects = state.attendance;
  const meta = state.meta.attendance;

  if (!Array.isArray(subjects)) {
    return meta.status === 'error'
      ? errorState({ title: "Couldn't load attendance", retry: 'retry-attendance', compact: true })
      : skeletonRows(4);
  }
  if (subjects.length === 0) {
    return emptyState({ iconName: 'chart', title: 'No attendance data yet', compact: true });
  }

  const summary = summarize(subjects);
  const overallOk = summary.overall >= MIN_ATTENDANCE;

  const atRisk = subjects
    .filter((s) => s.attendancePercent < MIN_ATTENDANCE)
    .sort((a, b) => a.attendancePercent - b.attendancePercent);

  let listTitle;
  let rows;

  if (atRisk.length > 0) {
    listTitle = 'Needs attention';
    rows = atRisk.slice(0, 4).map((s) => {
      const needed = classesNeeded(s.present, s.total);
      return `
        <li class="row">
          <span class="row__body">
            <span class="row__title truncate">${esc(s.description)}</span>
            <span class="row__sub">Attend the next ${plural(needed, 'class', 'classes')} to reach ${MIN_ATTENDANCE}%</span>
          </span>
          <span class="row__end">${badge(`${s.attendancePercent}%`, 'danger')}</span>
        </li>`;
    });
  } else {
    listTitle = 'Smallest margin';
    rows = [...subjects]
      .sort((a, b) => classesCanSkip(a.present, a.total) - classesCanSkip(b.present, b.total))
      .slice(0, 3)
      .map((s) => {
        const skip = classesCanSkip(s.present, s.total);
        return `
          <li class="row">
            <span class="row__body">
              <span class="row__title truncate">${esc(s.description)}</span>
              <span class="row__sub">${skip > 0 ? `Can miss ${plural(skip, 'more class', 'more classes')}` : 'No room to miss a class'}</span>
            </span>
            <span class="row__end">${badge(`${s.attendancePercent}%`, 'success')}</span>
          </li>`;
      });
  }

  return `
    <div class="att-summary">
      <div class="att-summary__head">
        <span class="att-summary__pct num">${summary.overall.toFixed(1)}%</span>
        <span class="muted small">overall · ${summary.present} of ${summary.total} classes attended</span>
      </div>
      ${progressBar({ value: summary.overall, tone: overallOk ? 'success' : 'danger', mark: MIN_ATTENDANCE, label: `Overall attendance ${summary.overall.toFixed(1)}%, minimum ${MIN_ATTENDANCE}%` })}
      <div class="att-summary__legend small">
        ${summary.below > 0
          ? `<span><span class="dot dot--danger"></span>${plural(summary.below, 'subject')} below ${MIN_ATTENDANCE}%</span>`
          : ''}
        <span><span class="dot dot--success"></span>${plural(summary.safe, 'subject')} at or above ${MIN_ATTENDANCE}%</span>
      </div>
    </div>
    <p class="section-label section-label--inset">${listTitle}</p>
    <ul class="list">${rows.join('')}</ul>`;
};

/* --------------------------------------------------------------------------
   SHORTCUTS
   -------------------------------------------------------------------------- */
const linksHtml = () => {
  const sgpa = state.results && state.results.sgpa;
  const courseCount = state.courses.length;
  const items = [
    { id: 'marks', iconName: 'clipboard', title: 'Internal marks', sub: 'Component-wise scores for this term' },
    { id: 'results', iconName: 'award', title: 'Results', sub: sgpa ? `Current semester · SGPA ${sgpa}` : 'Current semester grades and SGPA' },
    { id: 'courses', iconName: 'book', title: 'Courses & faculty', sub: courseCount ? `${plural(courseCount, 'registered subject')}` : 'Faculty and rooms for each subject' },
    { id: 'feedback', iconName: 'message', title: 'Feedback', sub: 'Subject-wise course evaluation' }
  ];

  return `
    <ul class="list">
      ${items.map((item) => `
        <li>
          <a class="row" href="#/${item.id}">
            <span class="row__icon">${icon(item.iconName)}</span>
            <span class="row__body">
              <span class="row__title">${item.title}</span>
              <span class="row__sub truncate">${esc(item.sub)}</span>
            </span>
            <span class="row__end">${icon('chevron-right', 18)}</span>
          </a>
        </li>`).join('')}
    </ul>`;
};

/* --------------------------------------------------------------------------
   VIEW
   -------------------------------------------------------------------------- */
export default {
  mount(root) {
    root.innerHTML = `
      <header class="page-intro">
        <h2 class="page-intro__title" data-greeting></h2>
        <p class="page-intro__sub" data-dateline></p>
      </header>

      <div class="home-grid">
        <div class="home-main">
          <section class="card home-now" aria-label="Current class">
            <div class="card__body" data-region="now"></div>
          </section>

          <section class="card home-today" aria-labelledby="homeTodayTitle">
            <div class="card__header">
              <div>
                <h2 class="card__title" id="homeTodayTitle">Today's classes</h2>
                <p class="card__sub" data-region="today-sub"></p>
              </div>
              <a class="link-btn" href="#/timetable">Full timetable${icon('arrow-right', 16)}</a>
            </div>
            <div class="card__body card__body--flush" data-region="today"></div>
          </section>
        </div>

        <div class="home-side">
          <section class="card home-mark" aria-labelledby="homeMarkTitle">
            <div class="card__header">
              <h2 class="card__title" id="homeMarkTitle">Mark attendance</h2>
              <a class="link-btn" href="#/mark">Today's status${icon('arrow-right', 16)}</a>
            </div>
            <div class="card__body">${markFormHtml()}</div>
          </section>

          <section class="card home-att" aria-labelledby="homeAttTitle">
            <div class="card__header">
              <h2 class="card__title" id="homeAttTitle">Attendance</h2>
              <a class="link-btn" href="#/attendance">All subjects${icon('arrow-right', 16)}</a>
            </div>
            <div class="card__body card__body--flush" data-region="attendance"></div>
          </section>

          <section class="card home-links" aria-labelledby="homeLinksTitle">
            <div class="card__header">
              <h2 class="card__title" id="homeLinksTitle">Academics</h2>
            </div>
            <div class="card__body card__body--flush" data-region="links"></div>
          </section>
        </div>
      </div>`;

    const region = (name) => root.querySelector(`[data-region="${name}"]`);

    const renderIntro = () => {
      // Until the profile has loaded once, the only "name" is the register
      // number, which makes a poor greeting.
      const displayName = getDisplayName(state.username);
      const name = displayName === state.username ? '' : firstName(displayName);
      root.querySelector('[data-greeting]').textContent = `${greeting()}${name ? `, ${name}` : ''}`;
      const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      const order = dayOrder();
      root.querySelector('[data-dateline]').textContent = order ? `${date} · Day order ${order}` : date;
    };

    const renderSchedule = () => {
      region('now').innerHTML = nowHtml();
      region('today').innerHTML = todayHtml();
      region('today-sub').innerHTML = hasSchedule(state.timetable) ? todaySubHtml() : '';
    };

    const renderAttendance = () => { region('attendance').innerHTML = attendanceHtml(); };
    const renderLinks = () => { region('links').innerHTML = linksHtml(); };

    renderIntro();
    renderSchedule();
    renderAttendance();
    renderLinks();
    bindMarkForm(root);

    const off = subscribe((key) => {
      if (key === 'timetable') renderSchedule();
      if (key === 'today') { renderIntro(); renderSchedule(); }
      if (key === 'attendance') renderAttendance();
      if (key === 'courses' || key === 'results') renderLinks();
      if (key === 'accounts') renderIntro();
    });

    // Class boundaries: re-check the clock twice a minute.
    const timer = setInterval(() => { renderIntro(); renderSchedule(); }, 30 * 1000);

    root.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'retry-timetable') ensureTimetable({ force: true }).catch(() => {});
      if (action.dataset.action === 'retry-attendance') ensureAttendance({ force: true }).catch(() => {});
    });

    /* Timetable and attendance are what this page is for, so they go first.
       Today's status (two SRM requests the first time) only adds the
       present/absent badges, so it waits until those two are in. */
    const core = [ensureTimetable(), ensureAttendance()];
    core.forEach((request) => request.catch(() => {}));
    Promise.allSettled(core).then(() => {
      if (root.isConnected) loadToday().catch(() => {});
    });

    return () => {
      off();
      clearInterval(timer);
    };
  }
};
