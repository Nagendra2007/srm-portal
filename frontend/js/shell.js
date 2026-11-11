/* App shell: navigation, routing, the account menu, and the global flows that
   are not tied to one page (sign-in, sign-out, profile switching, session
   expiry). */

import { esc, firstName, getInitials } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { configureApi } from './lib/api.js';
import { getDisplayName, getAccountSecret } from './lib/storage.js';
import {
  state, subscribe, isSignedIn, restoreSession, initSession, performLogout, forgetAccount,
  switchAccount, reconnectSession, isReconnecting, hydrate, syncAll
} from './lib/store.js';
import { avatar, confirmDialog, openDialog, themeToggleButton, toast, toggleTheme, alertBox } from './lib/ui.js';
import { accountsListHtml } from './lib/widgets.js';
import { mountLogin } from './views/login.js';

import home from './views/home.js';
import mark from './views/mark.js';
import attendance from './views/attendance.js';
import timetable from './views/timetable.js';
import courses from './views/courses.js';
import marks from './views/marks.js';
import results from './views/results.js';
import feedback from './views/feedback.js';
import profile from './views/profile.js';

/* --------------------------------------------------------------------------
   ROUTES
   One table drives the sidebar, the phone tab bar, the "More" sheet and the
   router, so the three navigation surfaces cannot disagree.
   -------------------------------------------------------------------------- */
const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', group: '', view: home },
  { id: 'mark', label: 'Mark attendance', short: 'Mark', icon: 'check-circle', group: 'Daily', view: mark },
  { id: 'attendance', label: 'Attendance', icon: 'chart', group: 'Daily', view: attendance },
  { id: 'timetable', label: 'Timetable', icon: 'calendar', group: 'Daily', view: timetable },
  { id: 'courses', label: 'Courses & faculty', short: 'Courses', icon: 'book', group: 'Academics', view: courses },
  { id: 'marks', label: 'Internal marks', short: 'Marks', icon: 'clipboard', group: 'Academics', view: marks },
  { id: 'results', label: 'Results', icon: 'award', group: 'Academics', view: results },
  { id: 'feedback', label: 'Feedback', icon: 'message', group: 'Academics', view: feedback },
  { id: 'profile', label: 'Profile', icon: 'user', group: 'Account', view: profile }
];

// Phone tab bar: the four most-used destinations, one tap away.
const TAB_IDS = ['home', 'attendance', 'mark', 'timetable'];
const MORE_ROUTES = ROUTES.filter((route) => !TAB_IDS.includes(route.id));

const routeById = (id) => ROUTES.find((route) => route.id === id);

const els = {};
let cleanupView = null;
let currentRoute = null;
let authOpen = false;

/* --------------------------------------------------------------------------
   CHROME
   -------------------------------------------------------------------------- */
const brandMarks = (size) => `
  <img class="brand__mark brand__mark--light" src="assets/logo-light.png" width="${size}" height="${size}" alt="">
  <img class="brand__mark brand__mark--dark" src="assets/logo-dark.png" width="${size}" height="${size}" alt="">`;

const renderSidebar = () => {
  const groups = [];
  ROUTES.forEach((route) => {
    let group = groups.find((g) => g.name === route.group);
    if (!group) {
      group = { name: route.group, items: [] };
      groups.push(group);
    }
    group.items.push(route);
  });

  els.sidebar.innerHTML = `
    <a class="sidebar__brand brand" href="#/home" aria-label="SRM SYNC home">
      ${brandMarks(32)}
      <span class="brand__text">
        <span class="brand__name">SRM SYNC</span>
        <span class="brand__sub">Alternative Portal</span>
      </span>
    </a>
    <nav class="sidebar__nav" aria-label="Sections">
      ${groups.map((group) => `
        <div class="sidebar__group">
          ${group.name ? `<p class="sidebar__heading">${group.name}</p>` : ''}
          ${group.items.map((route) => `
            <a class="nav-item" href="#/${route.id}" data-route="${route.id}">
              ${icon(route.icon)}
              <span class="nav-item__label">${route.label}</span>
              <span class="nav-item__short">${route.short || route.label}</span>
            </a>`).join('')}
        </div>`).join('')}
    </nav>
    <p class="sidebar__foot">Unofficial companion. Not affiliated with SRM AP University.</p>`;
};

const renderTopbar = () => {
  els.topbar.innerHTML = `
    <div class="topbar__start">
      <a class="topbar__brand" href="#/home" aria-label="SRM SYNC home">${brandMarks(30)}</a>
      <h1 class="topbar__title" id="pageTitle"></h1>
    </div>
    <div class="topbar__end">
      <a class="btn btn--primary btn--sm topbar__mark" href="#/mark">${icon('check-circle', 18)}<span>Mark attendance</span></a>
      ${themeToggleButton()}
      <button class="account-btn" type="button" data-action="open-account" aria-haspopup="dialog" aria-label="Account and saved profiles">
        <span data-account-avatar></span>
        <span class="account-btn__name truncate" data-account-name></span>
        ${icon('chevron-down', 16, 'account-btn__caret')}
      </button>
    </div>`;
};

const renderTabbar = () => {
  const tabs = TAB_IDS.map(routeById);
  els.tabbar.innerHTML = `
    ${tabs.map((route) => `
      <a class="tabbar__item${route.id === 'mark' ? ' tabbar__item--primary' : ''}" href="#/${route.id}" data-route="${route.id}">
        <span class="tabbar__icon">${icon(route.icon, 22)}</span>
        <span class="tabbar__label">${route.short || route.label}</span>
      </a>`).join('')}
    <button class="tabbar__item" type="button" data-action="open-more" data-more-tab aria-haspopup="dialog">
      <span class="tabbar__icon">${icon('grid', 22)}</span>
      <span class="tabbar__label">More</span>
    </button>`;
};

const activeName = () => getDisplayName(state.username);

const updateAccountChrome = () => {
  const name = activeName();
  const photo = state.profile ? state.profile.photo : null;
  document.querySelectorAll('[data-account-avatar]').forEach((el) => {
    el.innerHTML = avatar({ photo, initials: getInitials(name) });
  });
  document.querySelectorAll('[data-account-name]').forEach((el) => {
    el.textContent = firstName(name);
  });
  document.querySelectorAll('[data-accounts-list]').forEach((el) => {
    el.innerHTML = accountsListHtml();
  });
};

const updateNavState = () => {
  const id = currentRoute ? currentRoute.id : '';
  document.querySelectorAll('[data-route]').forEach((link) => {
    if (link.dataset.route === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const moreTab = document.querySelector('[data-more-tab]');
  if (moreTab) moreTab.classList.toggle('is-active', MORE_ROUTES.some((route) => route.id === id));

  const title = document.getElementById('pageTitle');
  if (title) title.textContent = currentRoute ? currentRoute.label : '';
  document.title = currentRoute && currentRoute.id !== 'home' ? `${currentRoute.label} · SRM SYNC` : 'SRM SYNC';
  els.shell.dataset.route = id;
};

/* --------------------------------------------------------------------------
   ROUTER
   -------------------------------------------------------------------------- */
const currentHashId = () => window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];

const closeDialogs = () => {
  document.querySelectorAll('dialog[open]:not([data-persistent])').forEach((dialog) => dialog.close());
};

const renderRoute = () => {
  if (!isSignedIn() || authOpen) return;

  const route = routeById(currentHashId());
  if (!route) {
    window.history.replaceState(null, '', '#/home');
    renderRoute();
    return;
  }

  closeDialogs();
  if (cleanupView) {
    try { cleanupView(); } catch (err) { console.error(err); }
    cleanupView = null;
  }

  currentRoute = route;
  const page = document.createElement('div');
  page.className = `page page--${route.id}`;
  els.view.replaceChildren(page);
  updateNavState();
  window.scrollTo(0, 0);

  try {
    cleanupView = route.view.mount(page) || null;
  } catch (err) {
    console.error(err);
    page.innerHTML = alertBox({
      tone: 'danger',
      iconName: 'alert-circle',
      title: 'This page could not be displayed',
      text: 'Reload the page to try again.'
    });
  }
};

export const navigate = (id) => {
  if (currentHashId() === id) renderRoute();
  else window.location.hash = `#/${id}`;
};

/* --------------------------------------------------------------------------
   SIGN-IN / APP SWITCHING
   -------------------------------------------------------------------------- */
const showApp = () => {
  authOpen = false;
  els.auth.hidden = true;
  els.auth.innerHTML = '';
  els.shell.hidden = false;
  updateAccountChrome();
  renderRoute();
};

/* Order matters, because the backend reaches SRM one request at a time:
     1. hydrate()  fill the screen from what is saved on this device
     2. showApp()  the page on screen sends its own requests first
     3. syncAll()  everything else is brought up to date behind it */
const enterApp = () => {
  hydrate();
  showApp();
  syncAll();
};

const showAuth = ({ message = '', username = '', canCancel = false } = {}) => {
  authOpen = true;
  closeDialogs();
  if (cleanupView) {
    try { cleanupView(); } catch (err) { console.error(err); }
    cleanupView = null;
  }
  els.view.replaceChildren();
  els.shell.hidden = true;
  els.auth.hidden = false;
  document.title = 'Sign in · SRM SYNC';
  window.scrollTo(0, 0);

  mountLogin(els.auth, {
    message,
    username,
    canCancel,
    onCancel: showApp,
    onSuccess: () => {
      window.history.replaceState(null, '', '#/home');
      enterApp();
    }
  });
};

const logout = () => {
  // performLogout clears state synchronously, then warms a fresh anonymous
  // session in the background — no need to hold the sign-in screen for that.
  const pending = performLogout();
  showAuth();
  return pending;
};

/* --------------------------------------------------------------------------
   ACCOUNT MENU + MORE SHEET
   -------------------------------------------------------------------------- */
const openAccountMenu = () => {
  const name = activeName();
  openDialog({
    title: 'Profiles',
    variant: 'dialog--popover',
    flush: true,
    body: `
      <div class="menu">
        <div data-accounts-list>${accountsListHtml()}</div>
        <div class="menu__actions">
          <button class="row" type="button" data-action="add-profile">
            <span class="row__icon">${icon('plus')}</span>
            <span class="row__body"><span class="row__title">Add profile</span></span>
          </button>
          <a class="row" href="#/profile" data-dialog-close>
            <span class="row__icon">${icon('user')}</span>
            <span class="row__body"><span class="row__title">View profile</span><span class="row__sub truncate">${esc(name)}</span></span>
          </a>
          <button class="row row--danger" type="button" data-action="logout">
            <span class="row__icon">${icon('logout')}</span>
            <span class="row__body"><span class="row__title">Log out</span></span>
          </button>
        </div>
      </div>`
  });
};

const openMoreSheet = () => {
  const id = currentRoute ? currentRoute.id : '';
  openDialog({
    title: 'More',
    variant: 'dialog--sheet',
    flush: true,
    body: `
      <div class="menu">
        <ul class="list">
          ${MORE_ROUTES.map((route) => `
            <li>
              <a class="row" href="#/${route.id}" data-dialog-close ${route.id === id ? 'aria-current="page"' : ''}>
                <span class="row__icon">${icon(route.icon)}</span>
                <span class="row__body"><span class="row__title">${route.label}</span></span>
                <span class="row__end">${icon('chevron-right', 18)}</span>
              </a>
            </li>`).join('')}
        </ul>
      </div>`
  });
};

/* --------------------------------------------------------------------------
   PROFILE SWITCHING
   -------------------------------------------------------------------------- */
const handleSwitch = async (username) => {
  closeDialogs();
  if (username === state.username) return;

  const name = getDisplayName(username);

  if (!getAccountSecret(username)) {
    showAuth({
      message: 'Saved password missing — please log in again',
      username,
      canCancel: isSignedIn()
    });
    return;
  }

  const overlay = openDialog({
    title: 'Switching profile',
    variant: '',
    dismissible: false,
    body: `
      <div class="busy">
        <span class="busy__spinner" aria-hidden="true"></span>
        <p>Loading ${esc(name)}'s dashboard…</p>
      </div>`
  });
  overlay.el.setAttribute('data-persistent', '');

  try {
    await switchAccount(username);

    /* A full reload rebuilds every page from the new profile's stored
       session, so nothing from the previous profile can linger on screen. */
    window.history.replaceState(null, '', '#/home');
    window.location.reload();
  } catch (err) {
    overlay.close();
    showAuth({
      message: err.message || 'Profile switch failed: Invalid credentials or captcha verification failed',
      username,
      canCancel: isSignedIn()
    });
  }
};

const handleRemove = async (username) => {
  const name = getDisplayName(username);
  const isActive = username === state.username;

  const ok = await confirmDialog({
    title: 'Remove this profile?',
    message: isActive
      ? `${name} will be signed out and removed from this device.`
      : `${name} will be removed from this device. You can add it again by signing in.`,
    confirmLabel: 'Remove',
    danger: true
  });
  if (!ok) return;

  forgetAccount(username);
  if (isActive) {
    await logout();
  } else {
    toast(`${name} removed from this device.`);
  }
};

/* --------------------------------------------------------------------------
   SESSION EXPIRY
   Shown on the first 401 from a portal route. Nothing re-authenticates until
   the student presses Reconnect.
   -------------------------------------------------------------------------- */
let expiredDialog = null;

const showSessionExpired = () => {
  if (!state.sessionId || !state.username) return;
  if (expiredDialog || isReconnecting()) return;

  expiredDialog = openDialog({
    title: 'SRM session expired',
    variant: '',
    dismissible: false,
    body: `
      <span class="dialog__icon">${icon('alert-triangle', 22)}</span>
      <div data-expired-message>
        <p>Your session with the SRM student portal has timed out. Reconnect to start a new one with your saved credentials.</p>
      </div>`,
    footer: `
      <button class="btn btn--secondary" type="button" data-expired-logout>Log out</button>
      <button class="btn btn--primary" type="button" data-expired-reconnect><span>Reconnect</span></button>`,
    onClose: () => { expiredDialog = null; }
  });
  expiredDialog.el.setAttribute('data-persistent', '');

  const dialogEl = expiredDialog.el;
  const reconnectBtn = dialogEl.querySelector('[data-expired-reconnect]');
  const logoutBtn = dialogEl.querySelector('[data-expired-logout]');

  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.disabled = true;
    logoutBtn.disabled = true;
    reconnectBtn.classList.add('is-loading');

    try {
      await reconnectSession();
      // Reload so every page is rebuilt clean against the new session.
      window.location.reload();
    } catch (err) {
      dialogEl.querySelector('[data-expired-message]').innerHTML = alertBox({
        tone: 'danger',
        iconName: 'alert-circle',
        title: 'Reconnection failed',
        text: `${err.message || 'Verification failed'}. Check your connection, or log out and sign in again.`
      });
      reconnectBtn.disabled = false;
      logoutBtn.disabled = false;
      reconnectBtn.classList.remove('is-loading');
    }
  });

  logoutBtn.addEventListener('click', () => {
    if (expiredDialog) expiredDialog.close();
    logout();
  });
};

/* --------------------------------------------------------------------------
   GLOBAL ACTIONS
   -------------------------------------------------------------------------- */
const onDocumentClick = (e) => {
  const switchBtn = e.target.closest('[data-switch-account]');
  if (switchBtn) {
    handleSwitch(switchBtn.dataset.switchAccount);
    return;
  }

  const removeBtn = e.target.closest('[data-remove-account]');
  if (removeBtn) {
    handleRemove(removeBtn.dataset.removeAccount);
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  switch (actionEl.dataset.action) {
    case 'toggle-theme':
      toggleTheme();
      break;
    case 'open-account':
      openAccountMenu();
      break;
    case 'open-more':
      openMoreSheet();
      break;
    case 'add-profile':
      // Does not sign the current profile out — it just brings the sign-in
      // form up for another account. The current one stays saved.
      showAuth({ canCancel: true });
      break;
    case 'logout':
      closeDialogs();
      logout();
      break;
    default:
      break;
  }
};

/* --------------------------------------------------------------------------
   START
   -------------------------------------------------------------------------- */
export const startApp = () => {
  els.auth = document.getElementById('auth');
  els.shell = document.getElementById('shell');
  els.sidebar = document.getElementById('sidebar');
  els.topbar = document.getElementById('topbar');
  els.tabbar = document.getElementById('tabbar');
  els.view = document.getElementById('view');

  configureApi({
    sessionId: () => state.sessionId,
    unauthorized: showSessionExpired
  });

  renderSidebar();
  renderTopbar();
  renderTabbar();

  document.addEventListener('click', onDocumentClick);
  window.addEventListener('hashchange', renderRoute);
  subscribe((key) => {
    if (key === 'profile' || key === 'accounts') updateAccountChrome();
  });

  if (restoreSession()) {
    enterApp();
  } else {
    showAuth();
    initSession();
  }
};
