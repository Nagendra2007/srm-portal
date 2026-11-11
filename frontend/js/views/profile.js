// Profile: who is signed in, their portal details, and device-level settings.

import { esc, getInitials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { state, subscribe, loadProfile, ensureProfile } from '../lib/store.js';
import { getDisplayName } from '../lib/storage.js';
import {
  ACCENTS, avatar, badge, emptyState, errorState, freshness, getAccent, getTheme,
  renderKeepingFocus, setAccent, setTheme, skeletonRows
} from '../lib/ui.js';
import { accountsListHtml } from '../lib/widgets.js';

const DISCLAIMER = 'An independent, unofficial companion tool built by a student for students. It is not affiliated with or endorsed by SRM AP University. Your data is fetched live from the official portal using your own session and is not stored.';

const headHtml = () => {
  const name = getDisplayName(state.username);
  const photo = state.profile ? state.profile.photo : null;
  return `
    ${avatar({ photo, initials: getInitials(name), large: true })}
    <div class="grow">
      <h2 class="profile-head__name">${esc(name)}</h2>
      <p class="muted code">${esc(state.username)}</p>
    </div>
    ${badge('Active student', 'success')}`;
};

const detailsHtml = () => {
  const profile = state.profile;
  const meta = state.meta.profile;

  if (!profile) {
    return meta.status === 'error'
      ? errorState({ title: "Couldn't load your profile", text: 'Check your connection, or try logging in again.', retry: 'refresh' })
      : skeletonRows(6);
  }
  if (profile.fields.length === 0) {
    return emptyState({ iconName: 'user', title: 'No profile data found', text: 'The portal returned an empty profile.' });
  }

  return `
    <dl class="dl">
      ${profile.fields.map((field) => `
        <div class="dl__item">
          <dt>${esc(field.label)}</dt>
          <dd>${esc(field.value)}</dd>
        </div>`).join('')}
    </dl>`;
};

const themeHtml = () => {
  const theme = getTheme();
  return `
    <button class="segmented__btn" type="button" data-set-theme="light" aria-pressed="${theme === 'light'}">${icon('sun', 16)} Light</button>
    <button class="segmented__btn" type="button" data-set-theme="dark" aria-pressed="${theme === 'dark'}">${icon('moon', 16)} Dark</button>`;
};

const accentHtml = () => {
  const current = getAccent();
  return ACCENTS.map((accent) => `
    <button class="swatch" type="button" role="radio" data-set-accent="${accent.id}" data-fk="accent:${accent.id}" aria-checked="${accent.id === current}" aria-label="${accent.label}" title="${accent.label}">
      <span class="swatch__dot" style="--swatch:${accent.swatch}">${icon('check', 16)}</span>
    </button>`).join('');
};

export default {
  mount(root) {
    root.innerHTML = `
      <div class="split split--wide-first">
        <div class="stack">
          <section class="card profile-head" aria-label="Signed-in student" data-region="head"></section>

          <section class="card" aria-labelledby="profileDetailsTitle">
            <div class="card__header">
              <h2 class="card__title" id="profileDetailsTitle">Student details</h2>
              <div data-region="fresh"></div>
            </div>
            <div data-region="details"></div>
          </section>
        </div>

        <div class="stack">
          <section class="card" aria-labelledby="profileSavedTitle">
            <div class="card__header">
              <div>
                <h2 class="card__title" id="profileSavedTitle">Saved profiles</h2>
                <p class="card__sub">Switch without signing in again.</p>
              </div>
              <button class="btn btn--secondary btn--sm" type="button" data-action="add-profile">${icon('plus', 16)}<span>Add</span></button>
            </div>
            <div data-accounts-list>${accountsListHtml()}</div>
          </section>

          <section class="card" aria-labelledby="profileThemeTitle">
            <div class="card__header">
              <div>
                <h2 class="card__title" id="profileThemeTitle">Appearance</h2>
                <p class="card__sub">Applies on this device.</p>
              </div>
            </div>
            <div class="card__body stack">
              <div class="setting">
                <span class="label grow" id="profileThemeLabel">Theme</span>
                <div class="segmented" role="group" aria-labelledby="profileThemeLabel" data-region="theme"></div>
              </div>
              <div class="setting">
                <span class="label grow" id="profileAccentLabel">Accent colour</span>
                <div class="swatches" role="radiogroup" aria-labelledby="profileAccentLabel" data-region="accent"></div>
              </div>
            </div>
          </section>

          <section class="card" aria-labelledby="profileSessionTitle">
            <div class="card__body setting">
              <div class="grow">
                <h2 class="card__title" id="profileSessionTitle">Session</h2>
                <p class="card__sub">Signs this profile out. It stays in your saved profiles.</p>
              </div>
              <button class="btn btn--danger-ghost" type="button" data-action="logout">${icon('logout', 18)}<span>Log out</span></button>
            </div>
          </section>

          <p class="muted small">${DISCLAIMER}</p>
        </div>
      </div>`;

    const region = (name) => root.querySelector(`[data-region="${name}"]`);

    const renderProfile = () => {
      region('head').innerHTML = headHtml();
      region('fresh').innerHTML = freshness(state.meta.profile);
      region('details').innerHTML = detailsHtml();
    };
    const renderTheme = () => { region('theme').innerHTML = themeHtml(); };
    const renderAccent = () => { renderKeepingFocus(region('accent'), accentHtml()); };

    renderProfile();
    renderTheme();
    renderAccent();

    const off = subscribe((key) => {
      if (key === 'profile' || key === 'accounts') renderProfile();
    });
    document.addEventListener('themechange', renderTheme);

    root.addEventListener('click', (e) => {
      const theme = e.target.closest('[data-set-theme]');
      if (theme) {
        setTheme(theme.dataset.setTheme);
        return;
      }
      const accent = e.target.closest('[data-set-accent]');
      if (accent) {
        setAccent(accent.dataset.setAccent);
        renderAccent();
        return;
      }
      if (e.target.closest('[data-action="refresh"]')) loadProfile();
    });

    // This page is about the profile, so ask for it now rather than waiting
    // for the background sync to reach it. If it was already fetched this
    // session nothing is sent — unless that attempt failed, then try again.
    if (!state.profile && state.meta.profile.status === 'error') loadProfile();
    else ensureProfile();

    return () => {
      off();
      document.removeEventListener('themechange', renderTheme);
    };
  }
};
