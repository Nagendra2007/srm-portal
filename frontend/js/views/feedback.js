/* Subject feedback: pick subjects, a rating and a comment, then submit on the
   student's own session. "Submit all" does the lot at once — a random comment,
   "Strongly agree", every pending subject — after one confirmation, because a
   submitted evaluation cannot be taken back. */

import { esc, plural } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { AuthError } from '../lib/api.js';
import { fetchFeedbackSubjects, fetchRandomFeedbackComment, submitFeedback } from '../lib/store.js';
import { alertBox, confirmDialog, emptyState, errorState, skeletonBlocks, toast } from '../lib/ui.js';

const RATINGS = [
  { value: '1', label: 'Strongly disagree' },
  { value: '2', label: 'Disagree' },
  { value: '3', label: 'Neutral' },
  { value: '4', label: 'Agree' },
  { value: '5', label: 'Strongly agree' }
];

const MAX_COMMENT = 500;

// Kept at module level so a half-written response survives leaving the page.
const fb = {
  subjects: [],
  selectedIds: [],
  rating: '5',
  comment: '',
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  busy: false,
  notice: null    // { ok, text } — result of the last submission
};

const ratingLabel = () => (RATINGS.find((r) => r.value === fb.rating) || RATINGS[4]).label;

const refreshData = async () => {
  const [subjects, comment] = await Promise.all([fetchFeedbackSubjects(), fetchRandomFeedbackComment()]);
  fb.subjects = subjects;
  fb.selectedIds = subjects.map((s) => s.id);
  if (!fb.comment) fb.comment = comment;
  fb.status = 'ready';
};

const formHtml = () => {
  const allSelected = fb.selectedIds.length === fb.subjects.length;

  return `
    ${fb.notice ? alertBox({ tone: fb.notice.ok ? 'success' : 'danger', iconName: fb.notice.ok ? 'check-circle' : 'alert-circle', text: fb.notice.text }) : ''}

    <div class="split split--even">
      <section class="card" aria-labelledby="fbSubjectsTitle">
        <div class="card__header">
          <div>
            <h2 class="card__title" id="fbSubjectsTitle">Subjects awaiting feedback</h2>
            <p class="card__sub" data-fb-count>${fb.selectedIds.length} of ${fb.subjects.length} selected</p>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" data-fb="toggleAll">${allSelected ? 'Deselect all' : 'Select all'}</button>
        </div>
        <ul class="list">
          ${fb.subjects.map((s) => `
            <li>
              <label class="row row--check">
                <input type="checkbox" data-fb-subject="${esc(s.id)}" ${fb.selectedIds.includes(s.id) ? 'checked' : ''}>
                <span class="row__body">
                  <span class="row__title">${esc(s.name)}</span>
                  ${s.faculty ? `<span class="row__sub">${esc(s.faculty)}</span>` : ''}
                </span>
              </label>
            </li>`).join('')}
        </ul>
        <p class="field__error fb-error" data-fb-error="subjects" hidden></p>
      </section>

      <div class="stack">
        <section class="card" aria-labelledby="fbResponseTitle">
          <div class="card__header">
            <div>
              <h2 class="card__title" id="fbResponseTitle">Your response</h2>
              <p class="card__sub">Applies to every selected subject.</p>
            </div>
          </div>
          <div class="card__body stack">
            <div class="field">
              <span class="label" id="fbRatingLabel">Rating</span>
              <div class="segmented segmented--block" role="radiogroup" aria-labelledby="fbRatingLabel">
                ${RATINGS.map((r) => `
                  <button class="segmented__btn" type="button" role="radio" data-fb-rating="${r.value}" aria-checked="${fb.rating === r.value}" aria-label="${r.value} — ${r.label}">${r.value}</button>`).join('')}
              </div>
              <div class="cluster cluster--between field__hint">
                <span>1 = Strongly disagree</span>
                <strong data-fb-rating-label>${fb.rating} — ${ratingLabel()}</strong>
              </div>
            </div>

            <div class="field">
              <div class="field__head">
                <label class="label" for="fbComment">Comment</label>
                <button class="link-btn" type="button" data-fb="random">${icon('shuffle', 16)}<span>Random comment</span></button>
              </div>
              <textarea class="textarea" id="fbComment" rows="4" maxlength="${MAX_COMMENT}" placeholder="Write a comment, or use Random comment">${esc(fb.comment)}</textarea>
              <div class="cluster cluster--between">
                <p class="field__error" data-fb-error="comment" hidden></p>
                <span class="field__hint num grow fb-count"><span data-fb-chars>${fb.comment.length}</span>/${MAX_COMMENT}</span>
              </div>
            </div>

            <button class="btn btn--primary btn--block" type="button" data-fb="submit"><span data-fb-submit-label>Submit feedback for ${plural(fb.selectedIds.length, 'subject')}</span></button>
          </div>
        </section>

        <section class="card" aria-labelledby="fbAllTitle">
          <div class="card__body quick-action">
            <span class="row__icon">${icon('zap')}</span>
            <div class="grow">
              <h2 class="card__title" id="fbAllTitle">Submit all at once</h2>
              <p class="card__sub">Rates every pending subject “Strongly agree” with a random comment.</p>
            </div>
            <button class="btn btn--secondary" type="button" data-fb="onetap"><span>Submit all ${fb.subjects.length}</span></button>
          </div>
        </section>
      </div>
    </div>`;
};

export default {
  mount(root) {
    const render = () => {
      if (fb.status === 'error') {
        root.innerHTML = `<section class="card">${errorState({ title: "Couldn't load feedback", retry: 'reload' })}</section>`;
        return;
      }
      if (fb.status !== 'ready') {
        root.innerHTML = `<section class="card">${skeletonBlocks(4)}</section>`;
        return;
      }
      if (fb.subjects.length === 0) {
        root.innerHTML = `
          ${fb.notice ? alertBox({ tone: fb.notice.ok ? 'success' : 'danger', iconName: fb.notice.ok ? 'check-circle' : 'alert-circle', text: fb.notice.text }) : ''}
          <section class="card">${emptyState({
            iconName: 'message',
            title: 'Nothing awaiting feedback',
            text: 'No subjects are awaiting feedback — it may already be submitted.',
            action: `<button class="btn btn--secondary btn--sm" type="button" data-action="reload">${icon('refresh', 16)}<span>Reload</span></button>`
          })}</section>`;
        return;
      }
      root.innerHTML = formHtml();
    };

    const load = async () => {
      fb.status = 'loading';
      render();
      try {
        await refreshData();
      } catch (err) {
        fb.status = 'error';
      }
      if (root.isConnected) render();
    };

    const setError = (name, text) => {
      const el = root.querySelector(`[data-fb-error="${name}"]`);
      if (!el) return;
      el.hidden = !text;
      el.textContent = text || '';
      if (name === 'comment') {
        const textarea = root.querySelector('#fbComment');
        if (textarea) textarea.setAttribute('aria-invalid', text ? 'true' : 'false');
      }
    };

    // Counts and labels that depend on the selection, without a full re-render
    // (which would drop focus from the checkbox or textarea in use).
    const syncSelection = () => {
      const count = root.querySelector('[data-fb-count]');
      if (count) count.textContent = `${fb.selectedIds.length} of ${fb.subjects.length} selected`;
      const label = root.querySelector('[data-fb-submit-label]');
      if (label) label.textContent = `Submit feedback for ${plural(fb.selectedIds.length, 'subject')}`;
      const toggle = root.querySelector('[data-fb="toggleAll"]');
      if (toggle) toggle.textContent = fb.selectedIds.length === fb.subjects.length ? 'Deselect all' : 'Select all';
      if (fb.selectedIds.length > 0) setError('subjects', '');
    };

    const send = async (button, { rating, comment, ids }) => {
      if (!comment || comment.trim().length <= 10) {
        setError('comment', 'Add a comment longer than 10 characters, or use Random comment.');
        return;
      }
      if (ids.length === 0) {
        setError('subjects', 'Select at least one subject.');
        return;
      }

      fb.busy = true;
      button.disabled = true;
      button.classList.add('is-loading');

      try {
        const data = await submitFeedback(rating, comment, ids);
        const ok = data.success !== false;
        const text = data.message || (ok ? 'Feedback submitted' : 'Feedback submission failed');

        // Reload what is still pending, then show the result on the fresh view.
        fb.comment = '';
        try {
          await refreshData();
        } catch (err) {
          fb.status = 'error';
        }
        fb.notice = { ok, text };
        toast(text, { type: ok ? 'success' : 'danger' });
        if (root.isConnected) render();
      } catch (err) {
        if (!(err instanceof AuthError)) {
          fb.notice = { ok: false, text: err.message || 'Feedback submission failed' };
          if (root.isConnected) render();
        } else if (button.isConnected) {
          button.disabled = false;
          button.classList.remove('is-loading');
        }
      } finally {
        fb.busy = false;
      }
    };

    root.addEventListener('input', (e) => {
      if (e.target.id !== 'fbComment') return;
      fb.comment = e.target.value;
      const chars = root.querySelector('[data-fb-chars]');
      if (chars) chars.textContent = String(fb.comment.length);
      setError('comment', '');
    });

    root.addEventListener('change', (e) => {
      const box = e.target.closest('[data-fb-subject]');
      if (!box) return;
      const id = box.dataset.fbSubject;
      if (box.checked) {
        if (!fb.selectedIds.includes(id)) fb.selectedIds.push(id);
      } else {
        fb.selectedIds = fb.selectedIds.filter((x) => x !== id);
      }
      syncSelection();
    });

    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="reload"]')) {
        fb.comment = '';
        fb.notice = null;
        load();
        return;
      }

      const rating = e.target.closest('[data-fb-rating]');
      if (rating) {
        fb.rating = rating.dataset.fbRating;
        root.querySelectorAll('[data-fb-rating]').forEach((btn) =>
          btn.setAttribute('aria-checked', String(btn.dataset.fbRating === fb.rating)));
        const label = root.querySelector('[data-fb-rating-label]');
        if (label) label.textContent = `${fb.rating} — ${ratingLabel()}`;
        return;
      }

      const el = e.target.closest('[data-fb]');
      if (!el || fb.busy) return;
      const kind = el.dataset.fb;

      if (kind === 'toggleAll') {
        const all = fb.selectedIds.length === fb.subjects.length;
        fb.selectedIds = all ? [] : fb.subjects.map((s) => s.id);
        root.querySelectorAll('[data-fb-subject]').forEach((box) => { box.checked = !all; });
        syncSelection();
        return;
      }

      if (kind === 'random') {
        const comment = await fetchRandomFeedbackComment();
        if (!comment) {
          toast("Couldn't fetch a comment. Try again.", { type: 'danger' });
          return;
        }
        fb.comment = comment;
        const textarea = root.querySelector('#fbComment');
        const chars = root.querySelector('[data-fb-chars]');
        if (textarea) textarea.value = comment;
        if (chars) chars.textContent = String(comment.length);
        setError('comment', '');
        return;
      }

      if (kind === 'submit') {
        send(el, { rating: fb.rating, comment: fb.comment, ids: fb.selectedIds });
        return;
      }

      if (kind === 'onetap') {
        const total = fb.subjects.length;
        const ok = await confirmDialog({
          title: `Submit feedback for all ${plural(total, 'subject')}?`,
          message: 'Every pending subject is rated “Strongly agree” with a random comment. Submitted feedback cannot be changed.',
          confirmLabel: 'Submit all'
        });
        if (!ok || fb.busy || !el.isConnected) return;

        const fresh = await fetchRandomFeedbackComment();
        send(el, {
          rating: '5',
          comment: fresh || fb.comment,
          ids: fb.subjects.map((s) => s.id)
        });
      }
    });

    if (fb.status === 'ready') render();
    else load();

    return () => {};
  }
};
