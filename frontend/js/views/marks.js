/* Internal marks: one row per subject, expanding to the component-wise
   breakdown (Mid Sem, CLA 1-3, Lab Performance, …). Marks are often blank
   until SRM enters them, so blanks show as an em dash rather than 0. */

import { esc, plural } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { state, subscribe, loadMarks } from '../lib/store.js';
import {
  badge, emptyState, errorState, freshness, progressBar, renderKeepingFocus, skeletonBlocks
} from '../lib/ui.js';

// Which subjects are expanded — kept across refreshes and revisits.
const openCodes = new Set();

const hasMarks = (subject) => subject.marksObtained !== null && subject.maxMarks !== null;

const breakdownHtml = (subject) => {
  const components = Array.isArray(subject.components) ? subject.components : [];
  if (components.length === 0) {
    return '<p class="muted small acc__note">No component-wise breakdown available.</p>';
  }
  return `
    <div class="table-wrap">
      <table class="table table--compact">
        <thead><tr><th>Component</th><th class="is-num">Conducted</th><th class="is-num">Converted</th></tr></thead>
        <tbody>
          ${components.map((c) => `
            <tr>
              <td>${esc(c.name)}</td>
              <td class="is-num">${esc(c.conducted ?? '—')}</td>
              <td class="is-num">${esc(c.converted ?? '—')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
};

const subjectHtml = (subject, index) => {
  const key = subject.code || String(index);
  const isOpen = openCodes.has(key);
  const entered = hasMarks(subject);
  const pct = entered && subject.maxMarks > 0 ? (subject.marksObtained / subject.maxMarks) * 100 : 0;
  const panelId = `marksPanel${index}`;

  return `
    <li class="acc__item${isOpen ? ' is-open' : ''}">
      <button class="acc__head" type="button" data-toggle="${esc(key)}" data-fk="marks:${esc(key)}" aria-expanded="${isOpen}" aria-controls="${panelId}">
        <span class="acc__body">
          <span class="acc__title">${esc(subject.description)}</span>
          <span class="code">${esc(subject.code)}</span>
        </span>
        <span class="acc__score">
          ${entered
            ? `<span class="num"><strong>${esc(subject.marksObtained)}</strong><span class="muted"> / ${esc(subject.maxMarks)}</span></span>
               ${progressBar({ value: pct, small: true, label: `${subject.marksObtained} out of ${subject.maxMarks}` })}`
            : badge('Not entered')}
        </span>
        ${icon('chevron-down', 18, 'acc__caret')}
      </button>
      <div class="acc__panel" id="${panelId}" ${isOpen ? '' : 'hidden'}>${breakdownHtml(subject)}</div>
    </li>`;
};

export default {
  mount(root) {
    root.innerHTML = `
      <div class="page-toolbar">
        <p class="muted small" data-region="summary"></p>
        <div data-region="fresh"></div>
      </div>
      <section class="card" aria-label="Internal marks by subject" data-region="body"></section>`;

    const summaryEl = root.querySelector('[data-region="summary"]');
    const freshEl = root.querySelector('[data-region="fresh"]');
    const bodyEl = root.querySelector('[data-region="body"]');

    const render = () => {
      const subjects = state.marks;
      const meta = state.meta.marks;
      freshEl.innerHTML = freshness(meta);

      if (!Array.isArray(subjects)) {
        summaryEl.textContent = '';
        bodyEl.innerHTML = meta.status === 'error'
          ? errorState({ title: "Couldn't load internal marks", retry: 'refresh' })
          : skeletonBlocks(4);
        return;
      }

      if (subjects.length === 0) {
        summaryEl.textContent = '';
        bodyEl.innerHTML = emptyState({ iconName: 'clipboard', title: 'No internal marks yet', text: 'Marks appear here as soon as they are entered on the portal.' });
        return;
      }

      const entered = subjects.filter(hasMarks).length;
      summaryEl.textContent = `Marks entered for ${entered} of ${plural(subjects.length, 'subject')}. Select a subject for its breakdown.`;
      renderKeepingFocus(bodyEl, `<ul class="list acc">${subjects.map(subjectHtml).join('')}</ul>`);
    };

    render();

    const off = subscribe((key) => { if (key === 'marks') render(); });

    root.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const key = toggle.dataset.toggle;
        if (openCodes.has(key)) openCodes.delete(key); else openCodes.add(key);
        render();
        return;
      }
      if (e.target.closest('[data-action="refresh"]')) loadMarks().catch(() => {});
    });

    // Always live on open; whatever is on screen stays up until it lands.
    loadMarks().catch(() => {});

    return off;
  }
};
