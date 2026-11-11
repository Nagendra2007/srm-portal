// Current semester results: SGPA up top, then grade and result per subject.

import { esc } from '../lib/dom.js';
import { state, subscribe, ensureResults } from '../lib/store.js';
import { badge, emptyState, errorState, freshness, skeletonBlocks } from '../lib/ui.js';

const isPass = (subject) => /pass/i.test(subject.result || '');

const summaryHtml = (data) => {
  const subjects = data.subjects;
  const credits = subjects.reduce((sum, s) => {
    const value = parseFloat(s.credit);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const passed = subjects.filter(isPass).length;

  return `
    <section class="card result-summary" aria-label="Semester summary">
      <div class="result-summary__figure">
        <span class="muted small">SGPA</span>
        <span class="result-summary__value num">${data.sgpa ? esc(data.sgpa) : '—'}</span>
        ${data.sgpa ? '' : '<span class="muted small">Not published yet</span>'}
      </div>
      <dl class="stat-row">
        <div><dt>Subjects</dt><dd class="num">${subjects.length}</dd></div>
        <div><dt>Credits</dt><dd class="num">${credits > 0 ? esc(credits) : '—'}</dd></div>
        <div><dt>Passed</dt><dd class="num">${passed} of ${subjects.length}</dd></div>
      </dl>
    </section>`;
};

const tableHtml = (subjects) => `
  <section class="card" aria-label="Results by subject">
    <div class="table-wrap">
      <table class="table table--stack">
        <thead>
          <tr><th>Course</th><th>Semester</th><th class="is-num">Credits</th><th>Grade</th><th>Result</th></tr>
        </thead>
        <tbody>
          ${subjects.map((s) => {
            const pass = isPass(s);
            return `
              <tr>
                <td class="cell-primary">
                  <span class="cell-title">${esc(s.description)}</span>
                  <span class="cell-sub code">${esc(s.code)}</span>
                </td>
                <td data-label="Semester">${esc(s.semester)}</td>
                <td class="is-num" data-label="Credits">${esc(s.credit)}</td>
                <td data-label="Grade"><strong>${esc(s.grade)}</strong></td>
                <td data-label="Result">${badge(s.result || '—', pass ? 'success' : 'danger')}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </section>`;

export default {
  mount(root) {
    root.innerHTML = `
      <div class="page-toolbar">
        <p class="muted small" data-region="title"></p>
        <div data-region="fresh"></div>
      </div>
      <div class="stack" data-region="body"></div>`;

    const titleEl = root.querySelector('[data-region="title"]');
    const freshEl = root.querySelector('[data-region="fresh"]');
    const bodyEl = root.querySelector('[data-region="body"]');

    const render = () => {
      const data = state.results;
      const meta = state.meta.results;
      freshEl.innerHTML = freshness(meta);
      titleEl.textContent = (data && data.title) || '';

      if (!data) {
        bodyEl.innerHTML = `<section class="card">${meta.status === 'error'
          ? errorState({ title: "Couldn't load results", retry: 'refresh' })
          : skeletonBlocks(4)}</section>`;
        return;
      }

      const subjects = Array.isArray(data.subjects) ? data.subjects : [];
      if (subjects.length === 0) {
        bodyEl.innerHTML = `<section class="card">${emptyState({ iconName: 'award', title: 'No results published yet', text: 'Current semester results appear here once the portal publishes them.' })}</section>`;
        return;
      }

      bodyEl.innerHTML = summaryHtml({ ...data, subjects }) + tableHtml(subjects);
    };

    render();

    const off = subscribe((key) => { if (key === 'results') render(); });

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="refresh"]')) ensureResults({ force: true }).catch(() => {});
    });

    ensureResults().catch(() => {});

    return off;
  }
};
