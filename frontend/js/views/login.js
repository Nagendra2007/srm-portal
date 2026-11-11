// Sign-in screen. Also used for "Add profile", where it can be cancelled.

import { esc, getInitials } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { performLogin } from '../lib/store.js';
import { getSavedAccounts, local } from '../lib/storage.js';
import { alertBox, themeToggleButton } from '../lib/ui.js';

const DISCLAIMER = 'An independent, unofficial companion tool built by a student for students. It is not affiliated with or endorsed by SRM AP University. Your data is fetched live from the official portal using your own session and is not stored.';

const brand = () => `
  <span class="brand">
    <img class="brand__mark brand__mark--light" src="assets/logo-light.png" width="36" height="36" alt="">
    <img class="brand__mark brand__mark--dark" src="assets/logo-dark.png" width="36" height="36" alt="">
    <span class="brand__text">
      <span class="brand__name">SRM SYNC</span>
      <span class="brand__sub">Alternative Portal</span>
    </span>
  </span>`;

const POINTS = [
  { iconName: 'check-circle', title: 'Mark attendance in seconds', text: 'Enter the class code from the first screen you see.' },
  { iconName: 'chart', title: 'Know where you stand', text: 'Per-subject attendance with skip and catch-up planning.' },
  { iconName: 'calendar', title: 'Today at a glance', text: 'Current class, next class, marks and results in one place.' }
];

export const mountLogin = (root, { message = '', username = '', canCancel = false, onSuccess, onCancel }) => {
  const rememberedUsername = canCancel ? '' : (local.get('username') || '');
  const initialUsername = username || rememberedUsername;
  const saved = getSavedAccounts();

  root.innerHTML = `
    <div class="auth__layout">
      <aside class="auth__aside">
        ${brand()}
        <div class="auth__pitch">
          <h2 class="auth__headline">Your SRM AP student portal, without the friction.</h2>
          <ul class="auth__points">
            ${POINTS.map((p) => `
              <li class="auth__point">
                <span class="row__icon">${icon(p.iconName)}</span>
                <span><strong>${p.title}</strong><span class="muted">${p.text}</span></span>
              </li>`).join('')}
          </ul>
        </div>
        <p class="auth__note">${DISCLAIMER}</p>
      </aside>

      <main class="auth__main">
        <div class="auth__bar">
          <span class="auth__bar-brand">${brand()}</span>
          ${themeToggleButton()}
        </div>

        <div class="auth__panel">
          ${canCancel ? `<button class="link-btn auth__back" type="button" data-cancel>${icon('arrow-left', 16)}<span>Back to dashboard</span></button>` : ''}
          <p class="eyebrow">SRM Sync 2.0</p>
          <h1 class="auth__title">${canCancel ? 'Add a profile' : 'Welcome back'}</h1>
          <p class="auth__lead">Sign in with your SRM AP student portal account.</p>

          <form class="auth__form" id="loginForm" novalidate>
            <div data-login-status>${message ? alertBox({ tone: 'danger', iconName: 'alert-circle', text: message }) : ''}</div>

            <div class="field">
              <label class="label" for="username">Registration number</label>
              <input class="input" id="username" name="username" type="text" placeholder="AP2XXXXXXXXXXXX" autocomplete="username" autocapitalize="characters" spellcheck="false" maxlength="64" value="${esc(initialUsername)}" required>
              <p class="field__error" data-error-for="username" hidden></p>
            </div>

            <div class="field">
              <label class="label" for="password">Password</label>
              <span class="input-wrap input-wrap--action">
                <input class="input" id="password" name="password" type="password" placeholder="Your portal password" autocomplete="current-password" maxlength="256" required>
                <button class="input-wrap__action" type="button" data-toggle-password aria-label="Show password" aria-pressed="false">${icon('eye')}</button>
              </span>
              <p class="field__error" data-error-for="password" hidden></p>
            </div>

            <label class="check">
              <input id="rememberMe" type="checkbox" ${rememberedUsername ? 'checked' : ''}>
              <span>Remember me on this device</span>
            </label>

            <button class="btn btn--primary btn--lg btn--block" id="loginBtn" type="submit"><span>Sign in</span></button>
            <p class="field__hint auth__wait" data-login-wait hidden>Signing in to the SRM portal. This can take a few seconds.</p>
          </form>

          ${saved.length > 0 ? `
            <div class="auth__saved">
              <p class="section-label">Saved profiles</p>
              <div class="cluster">
                ${saved.map((a) => `
                  <button class="chip" type="button" data-fill-username="${esc(a.username)}">
                    <span class="avatar avatar--xs">${esc(getInitials(a.displayName || a.username))}</span>
                    <span class="truncate">${esc(a.displayName || a.username)}</span>
                  </button>`).join('')}
              </div>
            </div>` : ''}

          <p class="auth__note auth__note--inline">${DISCLAIMER}</p>
        </div>
      </main>
    </div>`;

  const form = root.querySelector('#loginForm');
  const usernameInput = root.querySelector('#username');
  const passwordInput = root.querySelector('#password');
  const rememberInput = root.querySelector('#rememberMe');
  const submitBtn = root.querySelector('#loginBtn');
  const statusEl = root.querySelector('[data-login-status]');
  const waitEl = root.querySelector('[data-login-wait]');

  const setFieldError = (input, text) => {
    const el = root.querySelector(`[data-error-for="${input.id}"]`);
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    el.hidden = !text;
    el.textContent = text || '';
  };

  [usernameInput, passwordInput].forEach((input) => {
    input.addEventListener('input', () => setFieldError(input, ''));
  });

  root.querySelector('[data-toggle-password]').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const reveal = passwordInput.type === 'password';
    passwordInput.type = reveal ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(reveal));
    btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    btn.innerHTML = icon(reveal ? 'eye-off' : 'eye');
  });

  root.addEventListener('click', (e) => {
    const fill = e.target.closest('[data-fill-username]');
    if (fill) {
      usernameInput.value = fill.dataset.fillUsername;
      setFieldError(usernameInput, '');
      passwordInput.focus();
      return;
    }
    if (e.target.closest('[data-cancel]') && onCancel) onCancel();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const user = usernameInput.value.trim();
    const pass = passwordInput.value;

    setFieldError(usernameInput, user ? '' : 'Enter your registration number.');
    setFieldError(passwordInput, pass ? '' : 'Enter your password.');
    if (!user) { usernameInput.focus(); return; }
    if (!pass) { passwordInput.focus(); return; }

    statusEl.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    waitEl.hidden = false;

    try {
      await performLogin(user, pass, { remember: rememberInput.checked });
      onSuccess(user);
    } catch (err) {
      statusEl.innerHTML = alertBox({
        tone: 'danger',
        iconName: 'alert-circle',
        text: err.message || 'Login verification failed'
      });
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      waitEl.hidden = true;
    }
  });

  // Only when the student explicitly asked for the form: focusing on every
  // page load would pop the phone keyboard open over the screen.
  if (canCancel) usernameInput.focus({ preventScroll: true });
  else if (username) passwordInput.focus({ preventScroll: true });
};
