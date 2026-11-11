// Mark attendance: the code form next to what the portal has recorded today.

import { state, subscribe, loadToday } from '../lib/store.js';
import { freshness } from '../lib/ui.js';
import { markFormHtml, bindMarkForm, todayStatusHtml } from '../lib/widgets.js';

export default {
  mount(root) {
    root.innerHTML = `
      <div class="split">
        <section class="card" aria-labelledby="markFormTitle">
          <div class="card__header">
            <div>
              <h2 class="card__title" id="markFormTitle">Enter the class code</h2>
              <p class="card__sub">Submitted straight to the SRM portal on your session.</p>
            </div>
          </div>
          <div class="card__body">${markFormHtml()}</div>
        </section>

        <section class="card" aria-labelledby="markTodayTitle">
          <div class="card__header">
            <h2 class="card__title" id="markTodayTitle">Today's status</h2>
            <div data-region="fresh"></div>
          </div>
          <div class="card__body card__body--flush today-status" data-region="today"></div>
        </section>
      </div>`;

    const freshEl = root.querySelector('[data-region="fresh"]');
    const todayEl = root.querySelector('[data-region="today"]');

    const render = () => {
      freshEl.innerHTML = freshness(state.meta.today, { action: 'refresh-today', label: "Refresh today's status" });
      todayEl.innerHTML = todayStatusHtml({ retry: 'refresh-today' });
    };

    render();
    bindMarkForm(root);

    const off = subscribe((key) => { if (key === 'today') render(); });

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="refresh-today"]')) loadToday({ force: true }).catch(() => {});
    });

    // Always a fresh read on open: today's status changes through the day.
    loadToday({ force: true }).catch(() => {});

    return off;
  }
};
