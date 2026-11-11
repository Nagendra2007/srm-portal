// Courses & faculty: searchable list of registered subjects.

import { esc, plural, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { state, subscribe, ensureCourses } from '../lib/store.js';
import { emptyState, errorState, skeletonBlocks } from '../lib/ui.js';

const field = (course, ...keys) => {
  for (const key of keys) {
    const value = course[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const matches = (course, query) => [
  field(course, 'courseCode', 'code'),
  field(course, 'courseTitle', 'title'),
  field(course, 'facultyName', 'faculty'),
  field(course, 'roomNo', 'room')
].some((value) => value.toLowerCase().includes(query));

export default {
  mount(root) {
    let query = '';

    root.innerHTML = `
      <section class="card" aria-label="Registered courses">
        <div class="card__header card__header--toolbar">
          <label class="input-wrap input-wrap--icon grow">
            <span class="input-wrap__icon">${icon('search', 18)}</span>
            <input class="input" type="search" data-search placeholder="Search courses or faculty" autocomplete="off" aria-label="Search courses">
          </label>
          <span class="muted small is-nowrap" data-region="count" aria-live="polite"></span>
        </div>
        <div data-region="body"></div>
      </section>`;

    const countEl = root.querySelector('[data-region="count"]');
    const bodyEl = root.querySelector('[data-region="body"]');
    const searchEl = root.querySelector('[data-search]');

    const render = () => {
      const courses = state.courses;
      const meta = state.meta.courses;

      if (courses.length === 0) {
        countEl.textContent = '';
        if (meta.status === 'error') {
          bodyEl.innerHTML = errorState({ title: "Couldn't load your courses", retry: 'retry' });
        } else if (meta.status === 'ready') {
          bodyEl.innerHTML = emptyState({ iconName: 'book', title: 'No course records found', text: 'The portal has no registered subjects for this term.' });
        } else {
          bodyEl.innerHTML = skeletonBlocks(4);
        }
        return;
      }

      const q = query.trim().toLowerCase();
      const filtered = q ? courses.filter((course) => matches(course, q)) : courses;
      countEl.textContent = q
        ? `${filtered.length} of ${plural(courses.length, 'subject')}`
        : plural(courses.length, 'subject');

      if (filtered.length === 0) {
        bodyEl.innerHTML = emptyState({
          iconName: 'search',
          title: 'No matching courses',
          text: `Nothing matches "${query.trim()}". Try a course code, a faculty name or a room.`,
          action: '<button class="btn btn--secondary btn--sm" type="button" data-action="clear-search">Clear search</button>'
        });
        return;
      }

      bodyEl.innerHTML = `
        <div class="table-wrap">
          <table class="table table--stack">
            <thead>
              <tr><th>Course</th><th>L-T-P-C</th><th>Faculty</th><th>Room</th></tr>
            </thead>
            <tbody>
              ${filtered.map((course) => {
                const code = field(course, 'courseCode', 'code');
                const title = field(course, 'courseTitle', 'title') || 'Untitled course';
                const ltpc = field(course, 'ltpc');
                const faculty = field(course, 'facultyName', 'faculty');
                const room = field(course, 'roomNo', 'room');
                return `
                  <tr>
                    <td class="cell-primary">
                      <span class="cell-title">${esc(title)}</span>
                      <span class="cell-sub code">${esc(code)}</span>
                    </td>
                    <td class="is-nowrap num" data-label="L-T-P-C">${esc(ltpc)}</td>
                    <td data-label="Faculty">${faculty ? esc(faculty) : '<span class="muted">Not assigned</span>'}</td>
                    <td data-label="Room">${room ? esc(room) : '<span class="muted">Not assigned</span>'}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    };

    render();

    const off = subscribe((key) => {
      if (key === 'courses' || key === 'timetable') render();
    });

    searchEl.addEventListener('input', debounce(() => {
      query = searchEl.value;
      render();
    }, 80));

    root.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'clear-search') {
        searchEl.value = '';
        query = '';
        render();
        searchEl.focus();
      }
      if (action.dataset.action === 'retry') ensureCourses().catch(() => {});
    });

    ensureCourses().catch(() => {});

    return off;
  }
};
