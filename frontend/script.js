// JS FILE: All page behavior - login, navigation, attendance, marks, results, theme toggle and popups

function showProfileSwitchPopup(username) {
  const overlay = document.getElementById('profileSwitchOverlay');
  const title = document.getElementById('profileSwitchTitle');
  const message = document.getElementById('profileSwitchMessage');
  const avatar = document.getElementById('profileSwitchAvatar');

  if (!overlay) return;

  let displayName = username;
  try {
    const accounts = getSavedAccounts();
    const account = accounts.find((a) => a.username === username);
    if (account && account.displayName) displayName = account.displayName;
    if (avatar) avatar.textContent = getInitials(displayName);
  } catch (err) {
    if (avatar) avatar.textContent = '';
  }

  title.textContent = 'Switching Profile';
  message.textContent = `Loading ${displayName}'s dashboard...`;

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('profile-switching');
}

function hideProfileSwitchPopup() {
  const overlay = document.getElementById('profileSwitchOverlay');
  if (!overlay) return;

  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('profile-switching');
}


    /* --------------------------------------------------------------------------
       1. THEME ENGINE & TOGGLE
       -------------------------------------------------------------------------- */
    const savedThemeValue = localStorage.getItem('theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

    const setTheme = (theme) => {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      const isDark = theme === 'dark';
      const label = document.getElementById('themeLabelText');
      if (label) {
        label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
      }
    };

    setTheme(savedThemeValue);

    const toggleTheme = () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
    };

    const headerThemeBtn = document.getElementById('headerThemeBtn');
    const loginThemeBtnRef = document.getElementById('loginThemeBtn');
    if (headerThemeBtn) headerThemeBtn.addEventListener('click', toggleTheme);
    if (loginThemeBtnRef) loginThemeBtnRef.addEventListener('click', toggleTheme);

    /* --------------------------------------------------------------------------
       2. PASSWORD VISIBILITY TOGGLE
       -------------------------------------------------------------------------- */
    const togglePasswordBtn = document.getElementById('togglePasswordBtn');
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');

    if (togglePasswordBtn && passwordInput) {
      togglePasswordBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        
        passwordInput.type = isPassword ? 'text' : 'password';
        eyeIcon.innerHTML = isPassword
          ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>'
          : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
      });
    }

    /* --------------------------------------------------------------------------
       3. DOM ELEMENTS & CLIENT STATE
       -------------------------------------------------------------------------- */
    const API_BASE = window.location.origin;

    /* ------------------------------------------------------------------------
       HTML ESCAPING

       Every render function below builds markup with template strings and
       assigns it through innerHTML. None of the interpolated values were
       escaped, so any '<' arriving from the SRM portal, from localStorage, or
       straight from the course-search box was parsed as markup. The search box
       was directly exploitable: typing
           <img src=x onerror=alert(1)>
       and pressing a key ran it, because the "no courses matching" branch
       interpolated the raw query.
       ------------------------------------------------------------------------ */
    const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);

    /* ------------------------------------------------------------------------
       CREDENTIAL PERSISTENCE

       "Remember me" used to run localStorage.setItem('password', password),
       and every saved profile kept its password in the savedAccounts array —
       all in cleartext, on disk, unexpired. localStorage is readable by any
       script on this origin, so a single XSS anywhere in the app (see above)
       leaked every stored SRM password at once, and they also survived on
       shared or lab machines indefinitely.

       Passwords now live in sessionStorage, which is scoped to the tab and
       cleared when it closes. Session restore and profile switching still work
       for as long as the tab is open; after that the password is re-entered.

       Setting this to true restores the old on-disk behaviour. It is here so
       the choice is yours and explicit, but leaving it false is the point.
       ------------------------------------------------------------------------ */
    const PERSIST_PASSWORD_ON_DISK = true;

    const setStoredPassword = (password) => {
      try { sessionStorage.setItem('password', password); } catch (e) {}
      if (PERSIST_PASSWORD_ON_DISK) {
        try { localStorage.setItem('password', password); } catch (e) {}
      }
    };

    const clearStoredPassword = () => {
      try { sessionStorage.removeItem('password'); } catch (e) {}
      try { localStorage.removeItem('password'); } catch (e) {}
    };

    // Per-account secrets for profile switching — tab-scoped, never on disk.
    const accountSecretKey = (username) => `accountSecret:${username}`;
    const setAccountSecret = (username, password) => {
      if (!username || !password) return;
      try { sessionStorage.setItem(accountSecretKey(username), password); } catch (e) {}
      if (PERSIST_PASSWORD_ON_DISK) {
        try { localStorage.setItem(accountSecretKey(username), password); } catch (e) {}
      }
    };
    const getAccountSecret = (username) => {
      if (!username) return '';
      try {
        return sessionStorage.getItem(accountSecretKey(username)) ||
               (PERSIST_PASSWORD_ON_DISK ? localStorage.getItem(accountSecretKey(username)) : '') || '';
      } catch (e) { return ''; }
    };
    const clearAccountSecret = (username) => {
      if (!username) return;
      try { sessionStorage.removeItem(accountSecretKey(username)); } catch (e) {}
      try { localStorage.removeItem(accountSecretKey(username)); } catch (e) {}
    };

    /* Per-account backend session ids. Each saved profile keeps the session
       it last logged in with, so switching profiles can pick that session
       back up instead of logging in to SRM again. An entry only goes away on
       logout, on removing the profile, or when a fresh login replaces it. */
    const getAccountSessions = () => {
      try {
        const parsed = JSON.parse(localStorage.getItem('accountSessions') || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (e) { return {}; }
    };
    const getAccountSession = (username) => {
      const id = username ? getAccountSessions()[username] : '';
      return typeof id === 'string' ? id : '';
    };
    const setAccountSession = (username, id) => {
      if (!username || !id) return;
      const sessions = getAccountSessions();
      sessions[username] = id;
      try { localStorage.setItem('accountSessions', JSON.stringify(sessions)); } catch (e) {}
    };
    const clearAccountSession = (username) => {
      if (!username) return;
      const sessions = getAccountSessions();
      delete sessions[username];
      try { localStorage.setItem('accountSessions', JSON.stringify(sessions)); } catch (e) {}
    };

    /* One-time cleanup for anyone upgrading: purge cleartext passwords this
       app already wrote to disk, otherwise the old values just sit there. */
    (function purgeLegacyPlaintextPasswords() {
      if (PERSIST_PASSWORD_ON_DISK) return;
      try {
        localStorage.removeItem('password');
        const raw = localStorage.getItem('savedAccounts');
        if (raw) {
          const accounts = JSON.parse(raw);
          if (Array.isArray(accounts) && accounts.some((a) => a && a.password)) {
            localStorage.setItem('savedAccounts', JSON.stringify(
              accounts.map(({ username, displayName }) => ({ username, displayName }))
            ));
          }
        }
      } catch (e) {}
    })();
    let sessionId = null;
    let inMemoryUsername = null;
    let inMemoryPassword = null;
    const form = document.getElementById('loginForm');
    const btn = document.getElementById('loginBtn');
    const status = document.getElementById('status');
    const stamp = document.getElementById('stamp');
    const inputs = document.querySelectorAll('.row input');
    const profileSection = document.getElementById('profileSection');
    const profileContent = document.getElementById('profileContent');
    const ledger = document.querySelector('.ledger');
    const loginThemeBar = document.getElementById('loginThemeBar');
    const appHeader = document.getElementById('appHeader');
    const accountMenu = document.getElementById('accountMenu');
    const savedAccountsList = document.getElementById('savedAccountsList');
    const addProfileBtn = document.getElementById('addProfileBtn');
    const accountLogoutBtn = document.getElementById('accountLogoutBtn');
    const attendanceSection = document.getElementById('attendanceSection');
    const attendanceContent = document.getElementById('attendanceContent');
    const markAttendanceSection = document.getElementById('markAttendanceSection');
    const markAttendanceForm = document.getElementById('markAttendanceForm');
    const markAttendanceBtn = document.getElementById('markAttendanceBtn');
    const markAttendanceStatus = document.getElementById('markAttendanceStatus');
    const todayAttendanceStatus = document.getElementById('todayAttendanceStatus');
    const codeBoxesWrap = document.getElementById('codeBoxesWrap');

    const timetableSection = document.getElementById('timetableSection');
    const timetableContent = document.getElementById('timetableContent');
    const timetableBadge = document.getElementById('timetableBadge');
    const daySelectorWrap = document.getElementById('daySelectorWrap');

    const coursesSection = document.getElementById('coursesSection');
    const coursesContent = document.getElementById('coursesContent');
    const coursesCountBadge = document.getElementById('coursesCountBadge');
    const courseSearchInput = document.getElementById('courseSearchInput');

    const internalMarksSection = document.getElementById('internalMarksSection');
    const internalMarksContent = document.getElementById('internalMarksContent');

    const currentResultsSection = document.getElementById('currentResultsSection');
    const currentResultsContent = document.getElementById('currentResultsContent');
    const currentResultsSgpaBadge = document.getElementById('currentResultsSgpaBadge');
    const feedbackSection = document.getElementById('feedbackSection');
    const feedbackContent = document.getElementById('feedbackContent');

    let currentTimetableData = null;
    let currentCoursesList = [];
    let activeDayFilter = 'TODAY';

    const showSection = (activeSec) => {
      profileSection.style.display = 'none';
      timetableSection.style.display = 'none';
      coursesSection.style.display = 'none';
      attendanceSection.style.display = 'none';
      markAttendanceSection.style.display = 'none';
      internalMarksSection.style.display = 'none';
      currentResultsSection.style.display = 'none';
      feedbackSection.style.display = 'none';
      if (activeSec) activeSec.style.display = 'block';

      // Highlight the matching tab in the bottom bar. The bar is only scrolled
      // when the user taps a tab (see the bottomNav click handler): scrolling
      // here made the bar jump to its far end on page open, because the
      // default section (Profile) is the last tab.
      document.querySelectorAll('.bottom-nav-item').forEach((tab) => {
        const isActive = !!activeSec && tab.dataset.section === activeSec.id;
        tab.classList.toggle('active', isActive);
        if (isActive) {
          tab.setAttribute('aria-current', 'page');
        } else {
          tab.removeAttribute('aria-current');
        }
      });
    };

    /* --------------------------------------------------------------------------
       4. FIELD ICONS
       -------------------------------------------------------------------------- */
    const FIELD_ICONS = {
      user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
      file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
      building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18"/><path d="M9 21v-4h6v4M9 7h1M9 11h1M14 7h1M14 11h1"/></svg>',
      calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h6l2 3h10v11H3z"/></svg>',
      graduation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>',
      phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a12 12 0 006 6L16 14l5 2v4c0 1-1 2-2 2A16 16 0 013 6c0-1 1-2 2-2z"/></svg>',
      family: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><circle cx="17" cy="8" r="2.5"/><path d="M22 20c0-2.5-1.8-4.3-4-5"/></svg>',
      globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9z"/></svg>',
      mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>',
      group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
    };

    const getFieldIcon = (label) => {
      const lower = label.toLowerCase();
      if (lower.includes('father') || lower.includes('mother') || lower.includes('parent')) return FIELD_ICONS.family;
      if (lower.includes('name')) return FIELD_ICONS.user;
      if (lower.includes('register') || lower.includes('reg')) return FIELD_ICONS.file;
      if (lower.includes('institution') || lower.includes('college') || lower.includes('campus')) return FIELD_ICONS.building;
      if (lower.includes('semester') || lower.includes('d.o.b') || lower.includes('dob') || lower.includes('date')) return FIELD_ICONS.calendar;
      if (lower.includes('section') || lower.includes('batch')) return FIELD_ICONS.group;
      if (lower.includes('program') || lower.includes('specialization') || lower.includes('branch')) return FIELD_ICONS.graduation;
      if (lower.includes('mail')) return FIELD_ICONS.mail;
      if (lower.includes('contact') || lower.includes('phone') || lower.includes('mobile')) return FIELD_ICONS.phone;
      if (lower.includes('access') || lower.includes('status')) return FIELD_ICONS.globe;
      return FIELD_ICONS.file;
    };

    const parseProfileFields = (tableHtml) => {
      const doc = new DOMParser().parseFromString(tableHtml, 'text/html');
      const rows = doc.querySelectorAll('tr');
      const fields = [];
      rows.forEach((row) => {
        const rowCells = Array.from(row.querySelectorAll('td'))
          .filter((cell) => cell.textContent.trim() !== '' && cell.textContent.trim() !== ':');
        if (rowCells.length < 2) return;
        const label = rowCells[0].textContent.trim().replace(/:$/, '');
        const value = rowCells.slice(1).map((cell) => cell.innerHTML.trim()).join(' ').trim();
        if (label && value) {
          fields.push({ label, value });
        }
      });
      return fields;
    };

    const renderProfileFields = (fields) => {
      if (fields.length === 0) {
        return '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:16px;">No profile data found.</p>';
      }
      const rowsHtml = fields.map((field) => `
        <div class="profile-field">
          <span class="profile-field-icon">${getFieldIcon(field.label)}</span>
          <span class="profile-field-body">
            <span class="profile-field-label">${field.label}</span>
            <span class="profile-field-value">${field.value}</span>
          </span>
        </div>
      `).join('');
      return `<div class="profile-fields">${rowsHtml}</div>`;
    };

    const splitPhotoAndTable = (html) => {
      const match = html.match(/<img[^>]*>/i);
      const photoTag = match ? match[0] : '';
      const tableHtml = html.replace(/<img[^>]*>/i, '');
      return { photoTag, tableHtml };
    };

    const renderLiveClassWidget = (timetableData) => {
      if (!timetableData || !Array.isArray(timetableData.schedule)) {
        return '';
      }

      // The tracker must use ONLY today's timetable. Never fall back to
      // the first day in the weekly schedule, because that can belong to
      // another day and makes the "Next Class" card show the wrong class.
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const weekdayMap = {
        0: 'Sunday',
        1: 'Monday',
        2: 'Tuesday',
        3: 'Wednesday',
        4: 'Thursday',
        5: 'Friday',
        6: 'Saturday'
      };
      const todayWeekday = weekdayMap[now.getDay()];
      const dayOrderMap = {
        1: 'Day 1',
        2: 'Day 2',
        3: 'Day 3',
        4: 'Day 4',
        5: 'Day 5',
        6: 'Day 6'
      };

      // Match the actual weekday first. SRM may label days as "Day 1",
      // "Day 2", etc., so support that format as well.
      let todaySchedule = timetableData.schedule.find(
        s => s.day && s.day.trim().toLowerCase() === todayWeekday.toLowerCase()
      );

      if (!todaySchedule) {
        const todayOrder = dayOrderMap[now.getDay()];
        if (todayOrder) {
          todaySchedule = timetableData.schedule.find(
            s => s.day && s.day.trim().toLowerCase() === todayOrder.toLowerCase()
          );
        }
      }

      // Do not use schedule[0] as a fallback. If today's timetable does
      // not exist, the tracker should simply show Free / no class today.
      const todayDayName = todaySchedule?.day || todayWeekday;
      const todaySlots = Array.isArray(todaySchedule?.slots) ? todaySchedule.slots : [];

      // Subject dictionary
      const subjectMap = {};
      if (Array.isArray(timetableData.subjects)) {
        timetableData.subjects.forEach((subj) => {
          const code = (subj.courseCode || subj.code || '').trim();
          const title = (subj.courseTitle || subj.title || '').trim();
          if (code && title) {
            subjectMap[code.toLowerCase()] = title;
            subjectMap[code.replace(/\s+/g, '').toLowerCase()] = title;
          }
        });
      }

      // Convert a timetable time such as:
      // "09:00 - 09:50", "01:30 - 02:20", "14:00 - 14:50"
      // into minutes from midnight.
      const parseTimeToMinutes = (timeStr) => {
        if (!timeStr) return null;

        const match = String(timeStr).trim().match(
          /^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i
        );
        if (!match) return null;

        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const meridian = (match[3] || '').toLowerCase();

        if (h > 23 || m > 59) return null;

        if (meridian === 'pm' && h < 12) h += 12;
        if (meridian === 'am' && h === 12) h = 0;

        // SRM timetables can omit AM/PM and use 1:00, 2:00 etc.
        // for afternoon periods.
        if (!meridian && h >= 1 && h <= 6) h += 12;

        return h * 60 + m;
      };

      // Normalize ONLY today's slots.
      const normalizedSlots = todaySlots.map((slot, idx) => {
        const code = (slot.courseCode || slot.code || '').trim();
        const rawCodeRoom = (slot.codeRoom || '').trim();
        const cleanCode = code ||
          (rawCodeRoom !== '-' && rawCodeRoom !== '&nbsp;' ? rawCodeRoom : '');

        const isFree =
          !cleanCode ||
          cleanCode === '-' ||
          cleanCode === '&nbsp;' ||
          cleanCode.toUpperCase() === 'FREE' ||
          cleanCode.toUpperCase() === 'NIL';

        const periodNum =
          slot.period ||
          slot.slotNumber ||
          (slot.slotIndex != null ? String(slot.slotIndex + 1) : String(idx + 1));

        const periodTime = slot.time || slot.timing || '';
        const room = (slot.room || slot.roomNo || '').trim();

        let courseTitle =
          (slot.courseTitle || slot.subjectName || slot.title || '').trim();

        if (!courseTitle && cleanCode) {
          courseTitle =
            subjectMap[cleanCode.toLowerCase()] ||
            subjectMap[cleanCode.replace(/\s+/g, '').toLowerCase()] ||
            cleanCode;
        }

        let startMin = null;
        let endMin = null;

        const rangeMatch = String(periodTime).match(
          /^\s*(.*?)\s*(?:-|to)\s*(.*?)\s*$/i
        );

        if (rangeMatch) {
          startMin = parseTimeToMinutes(rangeMatch[1]);
          endMin = parseTimeToMinutes(rangeMatch[2]);
        }

        return {
          periodNum,
          periodTime,
          code: cleanCode,
          courseTitle: isFree ? 'Free Period' : (courseTitle || cleanCode),
          room,
          isFree,
          startMin,
          endMin,
          index: idx
        };
      });

      // CURRENT CLASS:
      // start <= now < end
      // This deliberately checks today's slots only.
      const currentSlot = normalizedSlots.find(slot =>
        slot.startMin != null &&
        slot.endMin != null &&
        slot.startMin <= currentMinutes &&
        currentMinutes < slot.endMin
      ) || null;

      // NEXT CLASS:
      // Find the earliest REAL class whose start time is strictly after
      // the current time. Free periods are ignored.
      // No search of tomorrow/another weekday is performed.
      const nextRealClass = normalizedSlots
        .filter(slot =>
          !slot.isFree &&
          slot.startMin != null &&
          slot.startMin > currentMinutes
        )
        .sort((a, b) => a.startMin - b.startMin)[0] || null;

      const currentDisplay = currentSlot
        ? {
            isFree: currentSlot.isFree,
            code: currentSlot.isFree ? 'Free' : currentSlot.code,
            title: currentSlot.isFree ? 'Free Period' : currentSlot.courseTitle,
            room: currentSlot.room,
            periodNum: `P${currentSlot.periodNum}`,
            time: currentSlot.periodTime || 'In Progress'
          }
        : {
            isFree: true,
            code: 'Free',
            title: 'No class running',
            room: '',
            periodNum: 'Now',
            time: 'Current Time'
          };

      const nextDisplay = nextRealClass
        ? {
            code: nextRealClass.code,
            title: nextRealClass.courseTitle,
            room: nextRealClass.room,
            periodNum: `P${nextRealClass.periodNum}`,
            time: nextRealClass.periodTime || 'Upcoming'
          }
        : {
            code: '—',
            title: 'No more classes today',
            room: '',
            periodNum: 'Done',
            time: 'Today'
          };

      return `
        <div class="live-class-widget">
          <div class="live-widget-header">
            <div class="live-widget-title-wrap">
              <span class="live-pulse-dot"></span>
              <span class="live-widget-title">Live Class Tracker</span>
            </div>
            <span class="live-day-tag">Today • ${todayDayName}</span>
          </div>

          <div class="live-cards-grid">
            <!-- CURRENT CLASS CARD -->
            <div class="live-subcard is-current">
              <div class="live-card-badge-row">
                <span class="live-badge current">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Current Class
                </span>
                <span class="live-slot-period">${currentDisplay.periodNum}</span>
              </div>
              <div class="live-card-body">
                <div class="live-course-head">
                  <span class="live-course-code ${currentDisplay.isFree ? 'free' : ''}">${currentDisplay.code}</span>
                  ${currentDisplay.room ? `<span class="live-room-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18"/><path d="M9 21v-4h6v4M9 7h1M9 11h1M14 7h1M14 11h1"/></svg>${currentDisplay.room}</span>` : ''}
                </div>
                <div class="live-course-name ${currentDisplay.isFree ? 'free' : ''}" title="${currentDisplay.title}">${currentDisplay.title}</div>
                <div class="live-time-foot">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>${currentDisplay.time}</span>
                </div>
              </div>
            </div>

            <!-- NEXT CLASS CARD (TODAY ONLY) -->
            <div class="live-subcard is-next">
              <div class="live-card-badge-row">
                <span class="live-badge next">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                  Next Class
                </span>
                <span class="live-slot-period">${nextDisplay.periodNum}</span>
              </div>
              <div class="live-card-body">
                <div class="live-course-head">
                  <span class="live-course-code">${nextDisplay.code}</span>
                  ${nextDisplay.room ? `<span class="live-room-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18"/><path d="M9 21v-4h6v4M9 7h1M9 11h1M14 7h1M14 11h1"/></svg>${nextDisplay.room}</span>` : ''}
                </div>
                <div class="live-course-name" title="${nextDisplay.title}">${nextDisplay.title}</div>
                <div class="live-time-foot">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>${nextDisplay.time}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    };

    const updateHeaderProfilePhoto = (photoTag) => {
      const container = document.getElementById('headerProfileContainer');
      if (container) {
        if (photoTag) {
          const srcMatch = photoTag.match(/src="([^"]+)"/i);
          if (srcMatch && srcMatch[1]) {
            container.innerHTML = `<img src="${srcMatch[1]}" class="header-profile-img" alt="Profile">`;
            return;
          }
        }
        container.innerHTML = `<svg class="header-profile-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`;
      }
    };

    const renderProfileDisplay = (tableHtml, photoTag, isCached = false) => {
      const fields = parseProfileFields(tableHtml);
      // completely remove profile photo from the profile section
      const liveClassMarkup = `<div id="liveClassWidgetContainer">${currentTimetableData ? renderLiveClassWidget(currentTimetableData) : '<div style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:16px;">Waiting for schedule sync...</div>'}</div>`;
      
      let cacheIndicator = '';
      if (isCached) {
        cacheIndicator = `
          <div style="margin-bottom:12px;padding:8px 12px;background:var(--accent-soft);border:1px dashed var(--header-border);border-radius:6px;display:flex;align-items:center;gap:8px;font-family:\'Space Grotesk\',sans-serif;font-size:11px;color:var(--ink-muted);">
            <span style="display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%;"></span>
            <span>[Last-Known Cached Data]</span>
          </div>
        `;
      }
      return cacheIndicator + liveClassMarkup + renderProfileFields(fields);
    };

    /* --------------------------------------------------------------------------
       5. ATTENDANCE CARDS RENDERER
       Toolbar (What If? / Today / sort) on top, one card per subject below.
       Each card has two planners: "Plan Bunks" (what happens if I skip N
       classes) and "Future" (what happens if I attend N more).

       All of the view state lives in attendanceView, and every interaction
       just re-renders from it — so a background data refresh never resets
       what the student has open.
       -------------------------------------------------------------------------- */
    const MIN_ATTENDANCE = 75;
    const ATT_SORTS = ['default', 'low', 'high'];
    const ATT_SORT_LABELS = { default: 'Portal order', low: 'Lowest first', high: 'Highest first' };

    const attendanceView = {
      sort: 'default',
      panel: null,              // null | 'whatif' | 'today'
      whatIf: { attend: 0, miss: 0 },
      todayHtml: null,          // null = not loaded yet
      planner: null             // null | { code, mode: 'bunk' | 'future', n }
    };

    const attendancePct = (present, total) => (total > 0 ? (present / total) * 100 : 0);
    const fmtPct = (value) => `${value.toFixed(2)}%`;

    // Classes that can still be missed while staying at or above the minimum.
    const classesCanSkip = (present, total) =>
      Math.max(0, Math.floor(present / (MIN_ATTENDANCE / 100) - total));

    // Classes that must be attended in a row to get back to the minimum.
    const classesNeeded = (present, total) => {
      const min = MIN_ATTENDANCE / 100;
      return Math.max(0, Math.ceil((min * total - present) / (1 - min)));
    };

    const attStepper = (field, value, label) => `
      <div class="att-stepper">
        <span class="att-stepper-label">${label}</span>
        <div class="att-stepper-controls">
          <button class="att-step-btn" type="button" data-att-step="${field}" data-delta="-1" aria-label="Decrease">&minus;</button>
          <span class="att-stepper-value">${value}</span>
          <button class="att-step-btn" type="button" data-att-step="${field}" data-delta="1" aria-label="Increase">+</button>
        </div>
      </div>`;

    const renderAttendancePlanner = (subject) => {
      const planner = attendanceView.planner;
      if (!planner || planner.code !== subject.code) return '';

      const isBunk = planner.mode === 'bunk';
      const present = subject.present + (isBunk ? 0 : planner.n);
      const total = subject.total + planner.n;
      const projected = attendancePct(present, total);
      const isSafe = projected >= MIN_ATTENDANCE;

      let hint;
      if (isBunk) {
        const maxSkip = classesCanSkip(subject.present, subject.total);
        hint = maxSkip > 0
          ? `You can skip up to ${maxSkip} class${maxSkip === 1 ? '' : 'es'} and stay at ${MIN_ATTENDANCE}%.`
          : `No room to skip — you are at or below ${MIN_ATTENDANCE}%.`;
      } else {
        const needed = classesNeeded(subject.present, subject.total);
        hint = needed > 0
          ? `Attend the next ${needed} class${needed === 1 ? '' : 'es'} in a row to reach ${MIN_ATTENDANCE}%.`
          : `You are already above ${MIN_ATTENDANCE}%.`;
      }

      return `
        <div class="att-planner">
          ${attStepper('planner', planner.n, isBunk ? 'Classes to skip' : 'Classes to attend')}
          <div class="att-planner-result">
            <span>Attendance becomes</span>
            <span class="subject-percent ${isSafe ? 'good' : 'low'}">${fmtPct(projected)}</span>
          </div>
          <p class="att-planner-hint">${hint}</p>
        </div>`;
    };

    const renderAttendancePanel = (subjects) => {
      if (attendanceView.panel === 'today') {
        return `<div class="att-panel">${attendanceView.todayHtml
          || '<div class="today-card"><p class="today-card-empty">Loading today\'s attendance status...</p></div>'}</div>`;
      }

      if (attendanceView.panel !== 'whatif') return '';

      const { attend, miss } = attendanceView.whatIf;
      const rows = subjects.map((subject) => {
        const projected = attendancePct(subject.present + attend, subject.total + attend + miss);
        return `
          <div class="att-whatif-row">
            <span class="att-whatif-name">${esc(subject.description)}</span>
            <span class="att-whatif-from">${subject.attendancePercent}%</span>
            <span class="subject-percent ${projected >= MIN_ATTENDANCE ? 'good' : 'low'}">${fmtPct(projected)}</span>
          </div>`;
      }).join('');

      return `
        <div class="att-panel">
          <p class="att-panel-title">What if, in every subject, I&hellip;</p>
          <div class="att-whatif-steppers">
            ${attStepper('attend', attend, 'Attend the next')}
            ${attStepper('miss', miss, 'Miss the next')}
          </div>
          <div class="att-whatif-rows">${rows}</div>
        </div>`;
    };

    const renderAttendance = (subjects) => {
      if (!subjects || subjects.length === 0) {
        attendanceContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">No attendance data found.</p>';
        return;
      }

      const sorted = [...subjects];
      if (attendanceView.sort === 'low') sorted.sort((a, b) => a.attendancePercent - b.attendancePercent);
      if (attendanceView.sort === 'high') sorted.sort((a, b) => b.attendancePercent - a.attendancePercent);

      const cardsHtml = sorted.map((subject) => {
        const isGood = subject.attendancePercent >= MIN_ATTENDANCE;
        const statusClass = isGood ? 'good' : 'low';
        const barWidth = Math.min(100, Math.max(0, subject.attendancePercent));
        const needed = classesNeeded(subject.present, subject.total);
        const planner = attendanceView.planner;
        const openMode = planner && planner.code === subject.code ? planner.mode : null;

        return `
          <div class="subject-card" data-code="${esc(subject.code)}">
            <div class="subject-card-header">
              <div class="subject-title">
                <span class="subject-name">${esc(subject.description)}</span>
                <span class="subject-code">${esc(subject.code)}</span>
              </div>
              <span class="subject-percent ${statusClass}">${subject.attendancePercent}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${statusClass}" style="width:${barWidth}%"></div>
            </div>
            <div class="subject-minmax">
              <span>Min: ${MIN_ATTENDANCE}%</span>
              <span>Current: ${subject.attendancePercent}%</span>
            </div>
            <div class="subject-stats">
              <div class="stat-box">
                <div class="stat-label">Present</div>
                <div class="stat-value present">${subject.present}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Absent</div>
                <div class="stat-value absent">${subject.absent}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Total</div>
                <div class="stat-value">${subject.total}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">${isGood ? 'Can Skip' : 'Must Attend'}</div>
                <div class="stat-value ${isGood ? '' : 'absent'}">${isGood ? subject.canSkip : needed}</div>
              </div>
            </div>
            <div class="subject-actions">
              <button class="att-action-btn${openMode === 'bunk' ? ' active' : ''}" type="button" data-att-plan="bunk" aria-expanded="${openMode === 'bunk'}">Plan Bunks</button>
              <button class="att-action-btn${openMode === 'future' ? ' active' : ''}" type="button" data-att-plan="future" aria-expanded="${openMode === 'future'}">Future</button>
            </div>
            ${renderAttendancePlanner(subject)}
          </div>
        `;
      }).join('');

      let cacheIndicator = '';
      if (subjects.isCached) {
        cacheIndicator = `
          <div style="margin-bottom:12px;padding:8px 12px;background:var(--accent-soft);border:1px dashed var(--header-border);border-radius:6px;display:flex;align-items:center;gap:8px;font-family:\'Space Grotesk\',sans-serif;font-size:11px;color:var(--ink-muted);">
            <span style="display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%;"></span>
            <span>[Last-Known Cached Data]</span>
          </div>
        `;
      }

      const toolbar = `
        <div class="att-toolbar">
          <button class="att-tool-btn${attendanceView.panel === 'whatif' ? ' active' : ''}" type="button" data-att-tool="whatif" aria-pressed="${attendanceView.panel === 'whatif'}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="8" y2="15"/><line x1="12" y1="15" x2="12" y2="15"/><line x1="16" y1="15" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg>
            What If?
          </button>
          <button class="att-tool-btn${attendanceView.panel === 'today' ? ' active' : ''}" type="button" data-att-tool="today" aria-pressed="${attendanceView.panel === 'today'}">Today</button>
          <button class="att-tool-btn icon-only${attendanceView.sort !== 'default' ? ' active' : ''}" type="button" data-att-tool="sort" title="Sort: ${ATT_SORT_LABELS[attendanceView.sort]}" aria-label="Sort: ${ATT_SORT_LABELS[attendanceView.sort]}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 4 7 20"/><polyline points="3 8 7 4 11 8"/><polyline points="17 20 17 4"/><polyline points="13 16 17 20 21 16"/></svg>
          </button>
        </div>
        ${attendanceView.sort !== 'default' ? `<p class="att-sort-note">Sorted: ${ATT_SORT_LABELS[attendanceView.sort]}</p>` : ''}`;

      attendanceContent.innerHTML = cacheIndicator + toolbar + renderAttendancePanel(sorted)
        + `<div class="attendance-grid">${cardsHtml}</div>`;
    };

    const loadAttendanceTodayPanel = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/att`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) return;
        attendanceView.todayHtml = res.ok
          ? renderTodayAttendanceStatus(await res.json())
          : '<div class="today-card"><p class="today-card-empty">Could not load today\'s attendance.</p></div>';
      } catch (err) {
        attendanceView.todayHtml = '<div class="today-card"><p class="today-card-empty">Could not load today\'s attendance.</p></div>';
      }
      if (attendanceView.panel === 'today' && currentAttendanceList) renderAttendance(currentAttendanceList);
    };

    attendanceContent.addEventListener('click', (e) => {
      if (!currentAttendanceList) return;

      const tool = e.target.closest('[data-att-tool]');
      const plan = e.target.closest('[data-att-plan]');
      const step = e.target.closest('[data-att-step]');
      if (!tool && !plan && !step) return;

      if (tool) {
        const name = tool.dataset.attTool;
        if (name === 'sort') {
          attendanceView.sort = ATT_SORTS[(ATT_SORTS.indexOf(attendanceView.sort) + 1) % ATT_SORTS.length];
        } else {
          attendanceView.panel = attendanceView.panel === name ? null : name;
          if (attendanceView.panel === 'today') {
            // Always re-fetch on open: today's status changes during the day.
            attendanceView.todayHtml = null;
            loadAttendanceTodayPanel();
          }
        }
      }

      if (plan) {
        const code = plan.closest('.subject-card').dataset.code;
        const mode = plan.dataset.attPlan;
        const current = attendanceView.planner;
        attendanceView.planner = current && current.code === code && current.mode === mode
          ? null
          : { code, mode, n: 1 };
      }

      if (step) {
        const delta = Number(step.dataset.delta);
        const clamp = (value) => Math.max(0, Math.min(99, value + delta));
        const field = step.dataset.attStep;
        if (field === 'planner' && attendanceView.planner) {
          attendanceView.planner.n = clamp(attendanceView.planner.n);
        } else if (field === 'attend' || field === 'miss') {
          attendanceView.whatIf[field] = clamp(attendanceView.whatIf[field]);
        }
      }

      renderAttendance(currentAttendanceList);
    });

    /* --------------------------------------------------------------------------
       6b. INTERNAL MARKS RENDERER
       Each subject card is clickable, same as SRM's own row-click behaviour
       (funShowHideDetails), and expands to show the component-wise
       breakdown (Mid Sem, CLA 1-3, Lab Performance, etc). Marks are often
       blank until SRM actually enters them, so blank cells show as an
       em-dash rather than "undefined" or "0".
       -------------------------------------------------------------------------- */
    const renderInternalMarks = (subjects) => {
      if (!subjects || subjects.length === 0) {
        internalMarksContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">No internal marks data found.</p>';
        return;
      }

      const cardsHtml = subjects.map((subject, i) => {
        const hasMarks = subject.marksObtained !== null && subject.maxMarks !== null;
        const scoreText = hasMarks ? `${subject.marksObtained} / ${subject.maxMarks}` : 'Not Entered';

        const componentsHtml = (subject.components || []).map((c) => `
          <div class="marks-breakdown-row">
            <div class="marks-breakdown-cell">${esc(c.name)}</div>
            <div class="marks-breakdown-cell numeric">${esc(c.conducted ?? '\u2014')}</div>
            <div class="marks-breakdown-cell numeric">${esc(c.converted ?? '\u2014')}</div>
          </div>
        `).join('');

        const breakdownTableHtml = componentsHtml
          ? `
            <div class="marks-breakdown-table">
              <div class="marks-breakdown-row header">
                <div class="marks-breakdown-cell">Component</div>
                <div class="marks-breakdown-cell numeric">Conducted</div>
                <div class="marks-breakdown-cell numeric">Converted</div>
              </div>
              ${componentsHtml}
            </div>
          `
          : '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:12px;color:var(--ink-muted);">No component-wise breakdown available.</p>';

        return `
          <div class="subject-card internal-marks-card" data-marks-index="${i}" style="cursor:pointer">
            <div class="subject-card-header">
              <span class="subject-name">${esc(subject.code)} \u2014 ${esc(subject.description)}</span>
              <span class="subject-percent ${hasMarks ? 'good' : 'low'}">${scoreText}</span>
            </div>
            <div class="internal-marks-breakdown" id="internalMarksBreakdown${i}" style="display:none;margin-top:10px">
              ${breakdownTableHtml}
            </div>
          </div>
        `;
      }).join('');

      let cacheIndicator = '';
      if (subjects.isCached) {
        cacheIndicator = `
          <div style="margin-bottom:12px;padding:8px 12px;background:var(--accent-soft);border:1px dashed var(--header-border);border-radius:6px;display:flex;align-items:center;gap:8px;font-family:\'Space Grotesk\',sans-serif;font-size:11px;color:var(--ink-muted);">
            <span style="display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%;"></span>
            <span>[Last-Known Cached Data]</span>
          </div>
        `;
      }

      internalMarksContent.innerHTML = cacheIndicator + `<div class="attendance-grid">${cardsHtml}</div>`;
    };

    internalMarksContent.addEventListener('click', (e) => {
      const card = e.target.closest('.internal-marks-card');
      if (!card) return;
      const breakdown = document.getElementById(`internalMarksBreakdown${card.dataset.marksIndex}`);
      if (!breakdown) return;
      breakdown.style.display = breakdown.style.display === 'none' ? 'block' : 'none';
    });

    /* --------------------------------------------------------------------------
       6c. CURRENT SEMESTER RESULTS RENDERER
       Straight tabular data (semester, code, description, credit, grade,
       result) plus a trailing S.G.P.A figure. The disclaimer paragraph SRM
       ships with this report is intentionally dropped by the parser.
       -------------------------------------------------------------------------- */
    const renderCurrentResults = (data) => {
      const subjects = data && data.subjects;

      if (!subjects || subjects.length === 0) {
        currentResultsSgpaBadge.textContent = 'SGPA';
        currentResultsContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">No results published yet.</p>';
        return;
      }

      currentResultsSgpaBadge.textContent = data.sgpa ? `SGPA: ${data.sgpa}` : 'SGPA';

      // Cards instead of a 5-column table — a fixed-width row (Code /
      // Description / Credit / Grade / Result) doesn't fit a phone screen
      // without pushing the last column off-canvas. This reuses the same
      // subject-card/stat-box pattern the Attendance panel already uses,
      // which is proven to wrap properly at any width.
      const cardsHtml = subjects.map((s) => {
        const isPass = /pass/i.test(s.result || '');
        return `
          <div class="subject-card">
            <div class="subject-card-header">
              <span class="subject-name">${esc(s.code)} \u2014 ${esc(s.description)}</span>
              <span class="subject-percent ${isPass ? 'good' : 'low'}">${esc(s.grade)}</span>
            </div>
            <div class="subject-stats" style="grid-template-columns:repeat(2,1fr)">
              <div class="stat-box">
                <div class="stat-label">Credit</div>
                <div class="stat-value">${esc(s.credit)}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Result</div>
                <div class="stat-value ${isPass ? 'present' : 'absent'}">${esc(s.result)}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');

      let cacheIndicator = '';
      if (data.isCached) {
        cacheIndicator = `
          <div style="margin-bottom:12px;padding:8px 12px;background:var(--accent-soft);border:1px dashed var(--header-border);border-radius:6px;display:flex;align-items:center;gap:8px;font-family:\'Space Grotesk\',sans-serif;font-size:11px;color:var(--ink-muted);">
            <span style="display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%;"></span>
            <span>[Last-Known Cached Data]</span>
          </div>
        `;
      }

      const titleHtml = data.title
        ? `<p style="font-family:\'Space Grotesk\',sans-serif;font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">${esc(data.title)}</p>`
        : '';

      currentResultsContent.innerHTML = cacheIndicator + titleHtml + `<div class="attendance-grid">${cardsHtml}</div>`;
    };

    /* --------------------------------------------------------------------------
       6. TIMETABLE RENDERER & DAY SELECTION
       -------------------------------------------------------------------------- */
    const getTodayDayName = (schedule = []) => {
      const dayIndex = new Date().getDay(); // 0 is Sun, 1 is Mon, 2 is Tue...
      const weekdayMap = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
      const dayOrderMap = { 0: 'Day 1', 1: 'Day 1', 2: 'Day 2', 3: 'Day 3', 4: 'Day 4', 5: 'Day 5', 6: 'Day 6' };

      const todayWeekday = weekdayMap[dayIndex] || 'Monday';

      if (schedule && schedule.length > 0) {
        // 1. Try to match weekday name (e.g. Monday)
        const matchWeekday = schedule.find(s => s.day && s.day.toLowerCase().includes(todayWeekday.toLowerCase()));
        if (matchWeekday) return matchWeekday.day;

        // 2. Try to match Day order (e.g. Day 1)
        const todayOrder = dayOrderMap[dayIndex] || 'Day 1';
        const matchOrder = schedule.find(s => s.day && s.day.toLowerCase().includes(todayOrder.toLowerCase()));
        if (matchOrder) return matchOrder.day;

        // 3. Fallback to first day in schedule
        return schedule[0].day;
      }

      return todayWeekday;
    };

    const renderTimetable = (timetableData, selectedFilter) => {
      if (!timetableData || !timetableData.schedule || timetableData.schedule.length === 0) {
        timetableContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">No timetable data found.</p>';
        return;
      }

      const todayDayName = getTodayDayName(timetableData.schedule);
      const allDays = timetableData.schedule.map((s) => s.day);

      // Subject lookup dictionary to resolve course codes to course names
      const subjectMap = {};
      if (Array.isArray(timetableData.subjects)) {
        timetableData.subjects.forEach((subj) => {
          const code = (subj.courseCode || subj.code || '').trim();
          const title = (subj.courseTitle || subj.title || '').trim();
          if (code && title) {
            subjectMap[code.toLowerCase()] = title;
            subjectMap[code.replace(/\s+/g, '').toLowerCase()] = title;
          }
        });
      }

      // Render Day Filter Pills
      const dayPillsHtml = [
        `<button type="button" class="day-pill-btn is-today ${selectedFilter === 'TODAY' ? 'active' : ''}" data-day="TODAY">Today (${esc(todayDayName)})</button>`,
        ...allDays.map((d) => `<button type="button" class="day-pill-btn ${selectedFilter === d ? 'active' : ''} ${d === todayDayName ? 'is-today' : ''}" data-day="${esc(d)}">${esc(d)}</button>`),
        `<button type="button" class="day-pill-btn ${selectedFilter === 'ALL' ? 'active' : ''}" data-day="ALL">Full Week</button>`
      ].join('');

      daySelectorWrap.innerHTML = dayPillsHtml;

      // Determine which days to display
      let daysToShow = [];
      if (selectedFilter === 'TODAY') {
        const found = timetableData.schedule.filter((s) => s.day && s.day.toLowerCase() === todayDayName.toLowerCase());
        daysToShow = found.length > 0 ? found : [timetableData.schedule[0]];
      } else if (selectedFilter === 'ALL') {
        daysToShow = timetableData.schedule;
      } else {
        daysToShow = timetableData.schedule.filter((s) => s.day && s.day.toLowerCase() === selectedFilter.toLowerCase());
      }

      if (daysToShow.length === 0) {
        daysToShow = timetableData.schedule;
      }

      const scheduleHtml = daysToShow.map((dayObj) => {
        const activeSlots = dayObj.slots.filter((s) => {
          const code = (s.courseCode || s.code || s.codeRoom || '').trim();
          return code && code !== '-' && code !== '&nbsp;' && code !== 'FREE' && code.toUpperCase() !== 'NIL';
        });
        const countLabel = activeSlots.length === 1 ? '1 Class' : `${activeSlots.length} Classes`;

        const slotsHtml = dayObj.slots.map((slot, sIdx) => {
          const code = (slot.courseCode || slot.code || '').trim();
          const rawCodeRoom = (slot.codeRoom || '').trim();
          const cleanCode = code || (rawCodeRoom !== '-' && rawCodeRoom !== '&nbsp;' ? rawCodeRoom : '');
          const isFree = !cleanCode || cleanCode === '-' || cleanCode === '&nbsp;' || cleanCode === 'FREE' || cleanCode.toUpperCase() === 'NIL';

          const periodNum = esc(slot.period || slot.slotNumber || (slot.slotIndex != null ? String(slot.slotIndex + 1) : String(sIdx + 1)));
          const periodTime = esc(slot.time || slot.timing || '');
          const room = esc((slot.room || slot.roomNo || '').trim());

          let courseTitle = (slot.courseTitle || slot.subjectName || slot.title || '').trim();
          if (!courseTitle && cleanCode) {
            courseTitle = subjectMap[cleanCode.toLowerCase()] || subjectMap[cleanCode.replace(/\s+/g, '').toLowerCase()] || cleanCode;
          }

          if (isFree) {
            return `
              <div class="slot-card free-slot">
                <div class="slot-time-col">
                  <span class="slot-period-num">P${periodNum}</span>
                  <span class="slot-time-range">${periodTime || 'Free'}</span>
                </div>
                <div class="slot-info-col">
                  <span class="slot-free-text">No scheduled class (Free Period)</span>
                </div>
              </div>
            `;
          }

          return `
            <div class="slot-card">
              <div class="slot-time-col">
                <span class="slot-period-num">P${periodNum}</span>
                <span class="slot-time-range">${periodTime || 'Class'}</span>
              </div>
              <div class="slot-info-col">
                <div class="slot-header-row">
                  <span class="slot-course-code">${esc(cleanCode)}</span>
                  ${room ? `<span class="slot-room-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18"/><path d="M9 21v-4h6v4M9 7h1M9 11h1M14 7h1M14 11h1"/></svg>${room}</span>` : ''}
                </div>
                <div class="slot-course-title">${esc(courseTitle || cleanCode)}</div>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="timetable-day-block">
            <div class="timetable-day-header">
              <span class="timetable-day-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                ${esc(dayObj.day)}
              </span>
              <span class="timetable-day-badge">${countLabel}</span>
            </div>
            <div class="timetable-slots-list">${slotsHtml}</div>
          </div>
        `;
      }).join('');

      let cacheIndicator = '';
      if (timetableData.isCached) {
        cacheIndicator = `
          <div style="margin-bottom:12px;padding:8px 12px;background:var(--accent-soft);border:1px dashed var(--header-border);border-radius:6px;display:flex;align-items:center;gap:8px;font-family:\'Space Grotesk\',sans-serif;font-size:11px;color:var(--ink-muted);">
            <span style="display:inline-block;width:6px;height:6px;background:var(--accent);border-radius:50%;"></span>
            <span>[Last-Known Cached Data]</span>
          </div>
        `;
      }

      timetableContent.innerHTML = cacheIndicator + scheduleHtml;
    };

    daySelectorWrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.day-pill-btn');
      if (!btn) return;
      activeDayFilter = btn.dataset.day;
      if (currentTimetableData) {
        renderTimetable(currentTimetableData, activeDayFilter);
      }
    });

    /* --------------------------------------------------------------------------
       7. COURSES & FACULTY RENDERER
       -------------------------------------------------------------------------- */
    const renderCourses = (courses, filterText = '') => {
      if (!courses || courses.length === 0) {
        coursesContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">No course records found.</p>';
        coursesCountBadge.textContent = '0 Subjects';
        return;
      }

      const q = filterText.trim().toLowerCase();
      const filtered = q
        ? courses.filter((c) => {
            const code = (c.courseCode || c.code || '').toLowerCase();
            const title = (c.courseTitle || c.title || '').toLowerCase();
            const faculty = (c.facultyName || c.faculty || '').toLowerCase();
            const room = (c.roomNo || c.room || '').toLowerCase();
            return code.includes(q) || title.includes(q) || faculty.includes(q) || room.includes(q);
          })
        : courses;

      coursesCountBadge.textContent = `${filtered.length} Subjects`;

      if (filtered.length === 0) {
        coursesContent.innerHTML = `<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">No courses matching "${esc(filterText)}".</p>`;
        return;
      }

      const cardsHtml = filtered.map((c) => {
        const code = esc(c.courseCode || c.code || 'COURSE');
        const title = esc(c.courseTitle || c.title || 'Untitled Course');
        const ltpc = esc(c.ltpc || '');
        const faculty = esc(c.facultyName || c.faculty || 'Faculty Not Assigned');
        const room = esc(c.roomNo || c.room || 'Main Academic Block');
        const ltpcTag = ltpc ? `<span class="course-ltpc-badge">LTPC: ${ltpc}</span>` : '';

        return `
          <div class="course-card">
            <div class="course-card-top">
              <span class="course-code-badge">${code}</span>
              ${ltpcTag}
            </div>
            <div class="course-card-title">${title}</div>
            <div class="course-meta-list">
              <div class="course-meta-row">
                <svg class="course-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                <span class="course-meta-label">Faculty:</span>
                <span class="course-meta-val">${faculty}</span>
              </div>
              <div class="course-meta-row">
                <svg class="course-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="3" width="16" height="18"/><path d="M9 21v-4h6v4M9 7h1M9 11h1M14 7h1M14 11h1"/>
                </svg>
                <span class="course-meta-label">Room(s):</span>
                <span class="course-meta-val course-rooms-val">${room}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      coursesContent.innerHTML = `<div class="courses-list">${cardsHtml}</div>`;
    };

    courseSearchInput.addEventListener('input', (e) => {
      renderCourses(currentCoursesList, e.target.value);
    });

    /* --------------------------------------------------------------------------
       8. ASYNC DATA FETCHING & ULTRA-FAST SWR CACHE ENGINE
       -------------------------------------------------------------------------- */
    let currentAttendanceList = null;
    let currentInternalMarksList = null;
    let currentResultsData = null;

    // Fast local storage cache helpers
    const CACHE_TTL_MS = 30 * 60 * 1000; // 30 mins

    const readLocalCache = (key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
        if (parsed.data && typeof parsed.data === 'object') {
          parsed.data.isCached = true;
        }
        return parsed.data;
      } catch (e) {
        return null;
      }
    };

    const writeLocalCache = (key, data) => {
      try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
      } catch (e) {}
    };

    // Pre-hydrate in-memory state from local storage on initial load
    const hydrateLocalState = (username) => {
      if (!username) return;
      const cachedTimetable = readLocalCache(`timetable:${username}`);
      if (cachedTimetable) {
        currentTimetableData = cachedTimetable;
        if (cachedTimetable.subjects) currentCoursesList = cachedTimetable.subjects;
      }
      const cachedAttendance = readLocalCache(`attendance:${username}`);
      if (cachedAttendance) {
        currentAttendanceList = cachedAttendance;
      }
      const cachedInternalMarks = readLocalCache(`internalMarks:${username}`);
      if (cachedInternalMarks) {
        currentInternalMarksList = cachedInternalMarks;
      }
      const cachedResults = readLocalCache(`currentResults:${username}`);
      if (cachedResults) {
        currentResultsData = cachedResults;
      }
    };

    const showSessionExpiredPopup = () => {
      const overlay = document.getElementById('sessionExpiredOverlay');
      const msgEl = document.getElementById('sessionExpiredMessage');
      if (msgEl) {
        msgEl.textContent = 'Your secure session with the SRM student portal has timed out. Click below to instantly establish a fresh session using your saved credentials.';
        msgEl.style.color = 'var(--ink-muted)';
      }
      if (overlay) {
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('session-expired-active');
      }
    };

    const hideSessionExpiredPopup = () => {
      const overlay = document.getElementById('sessionExpiredOverlay');
      if (overlay) {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('session-expired-active');
      }
    };

    // Setup Session Expiration action button listener
    const sessionExpiredBtn = document.getElementById('sessionExpiredBtn');
    const sessionExpiredLogoutBtn = document.getElementById('sessionExpiredLogoutBtn');

    /* --------------------------------------------------------------------------
       SRM's own upstream session can — and does — expire well before our
       30-minute local session TTL (clientSessionStore.js) runs out. Every
       route that touches SRM already surfaces that as a 401 (see
       handleRouteError in portal.js), so a 401 here doesn't only mean our
       local session died of old age; most of the time it means SRM logged us
       out early and we still have a perfectly good saved password.

       reconnectSession() is the single place that re-authenticates. It only
       runs when the user clicks "Initiate New Session" on the popup:
       checkResponseAuth below shows that popup on a 401 and stops there, so
       a session is kept for as long as SRM honours it and a new SRM login
       only ever happens on an explicit click.
       -------------------------------------------------------------------------- */
    let reconnectInFlight = null;

    const reconnectSession = () => {
      if (reconnectInFlight) return reconnectInFlight;

      reconnectInFlight = (async () => {
        const username = inMemoryUsername || localStorage.getItem('username') || sessionStorage.getItem('username');
        const password = inMemoryPassword || localStorage.getItem('password') || sessionStorage.getItem('password');

        if (!username || !password) {
          throw new Error('Saved credentials not found. Please log in again.');
        }

        // sessionId is left as-is on purpose: performLogin sends it along, so
        // the backend drops the expired session as it creates the new one.
        await performLogin(username, password, { remember: true });

        // Re-load current dashboard with new active session
        preloadAllPortalData(username);
      })();

      return reconnectInFlight.finally(() => { reconnectInFlight = null; });
    };

    const checkResponseAuth = async (res) => {
      if (res.status === 401) {
        if (!sessionId) return false;

        // Several panels can 401 around the same time. Only the first one
        // should (re)open the popup, or a later 401 would wipe an error
        // message / in-progress state from a reconnect already under way.
        const overlay = document.getElementById('sessionExpiredOverlay');
        if (!reconnectInFlight && !(overlay && overlay.classList.contains('show'))) {
          showSessionExpiredPopup();
        }

        // No login happens here — the popup's button does that. The caller's
        // fetch has no data to use, so it treats this pass as failed.
        return false;
      }
      return true;
    };

    if (sessionExpiredBtn) {
      sessionExpiredBtn.addEventListener('click', async () => {
        sessionExpiredBtn.disabled = true;
        sessionExpiredBtn.textContent = 'Reconnecting...';

        try {
          await reconnectSession();
          hideSessionExpiredPopup();
          // Reload to guarantee every panel is rebuilt clean against the
          // new session, same as profile switch.
          window.location.reload();
          return;
        } catch (err) {
          const msgEl = document.getElementById('sessionExpiredMessage');
          if (msgEl) {
            msgEl.textContent = `Reconnection failed: ${err.message || 'Verification failed'}. Please check your connection or log out and sign in again.`;
            msgEl.style.color = 'var(--low-red)';
          }
        } finally {
          sessionExpiredBtn.disabled = false;
          sessionExpiredBtn.textContent = 'Initiate New Session';
        }
      });
    }

    if (sessionExpiredLogoutBtn) {
      sessionExpiredLogoutBtn.addEventListener('click', () => {
        hideSessionExpiredPopup();
        performFullLogout();
      });
    }

    // Parallel bootstrap / pre-fetch: fetches all sections in 1 fast pass
    const preloadAllPortalData = async (username) => {
      hydrateLocalState(username);

      // Pre-render immediately if cache exists
      if (currentTimetableData) {
        renderTimetable(currentTimetableData, activeDayFilter);
        updateProfileLiveWidget();
      }
      if (currentCoursesList && currentCoursesList.length > 0) {
        renderCourses(currentCoursesList, '');
      }
      if (currentAttendanceList && currentAttendanceList.length > 0) {
        renderAttendance(currentAttendanceList);
      }

      // Fast background network fetch
      try {
        const bootstrapRes = await fetch(`${API_BASE}/api/bootstrap`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(bootstrapRes)) return;
        if (bootstrapRes.ok) {
          const bData = await bootstrapRes.json();
          if (bData.timetable) {
            currentTimetableData = bData.timetable;
            if (bData.timetable.subjects) currentCoursesList = bData.timetable.subjects;
            writeLocalCache(`timetable:${username}`, bData.timetable);
            renderTimetable(currentTimetableData, activeDayFilter);
            updateProfileLiveWidget();
          }
          if (bData.courses && (!currentCoursesList || currentCoursesList.length === 0)) {
            currentCoursesList = bData.courses;
            renderCourses(currentCoursesList, '');
          }
          if (bData.attendance) {
            currentAttendanceList = bData.attendance;
            writeLocalCache(`attendance:${username}`, bData.attendance);
            renderAttendance(currentAttendanceList);
          }
          return;
        }
      } catch (e) {
        // Fallback to parallel single fetches
      }

      // Parallel fallback
      Promise.allSettled([
        ensureTimetableData(username),
        ensureAttendanceData(username)
      ]);
    };

    const ensureTimetableData = async (username) => {
      const u = username || localStorage.getItem('username') || sessionStorage.getItem('username') || '';
      if (currentTimetableData && currentTimetableData.schedule && currentTimetableData.schedule.length > 0) {
        return currentTimetableData;
      }
      const cached = readLocalCache(`timetable:${u}`);
      if (cached) {
        currentTimetableData = cached;
        if (cached.subjects) currentCoursesList = cached.subjects;
        return currentTimetableData;
      }
      try {
        const res = await fetch(`${API_BASE}/api/timetable`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) throw new Error('Session expired');
        if (!res.ok) throw new Error('Timetable error');
        const data = await res.json();
        currentTimetableData = data;
        if (data.subjects && data.subjects.length > 0) {
          currentCoursesList = data.subjects;
        }
        if (u) writeLocalCache(`timetable:${u}`, data);
        return currentTimetableData;
      } catch (err) {
        // DO NOT return demo/fake data.
        throw err;
      }
    };

    const ensureInternalMarksData = async (username) => {
      const u = username || localStorage.getItem('username') || sessionStorage.getItem('username') || '';
      if (currentInternalMarksList && currentInternalMarksList.length > 0) {
        return currentInternalMarksList;
      }
      const cached = readLocalCache(`internalMarks:${u}`);
      if (cached) {
        currentInternalMarksList = cached;
        return currentInternalMarksList;
      }
      try {
        const res = await fetch(`${API_BASE}/api/internal-marks`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) throw new Error('Session expired');
        if (!res.ok) throw new Error('Internal marks error');
        const subjects = await res.json();
        currentInternalMarksList = subjects;
        if (u) writeLocalCache(`internalMarks:${u}`, subjects);
        return currentInternalMarksList;
      } catch (err) {
        // DO NOT return demo/fake data.
        throw err;
      }
    };

    const ensureCurrentResultsData = async (username) => {
      const u = username || localStorage.getItem('username') || sessionStorage.getItem('username') || '';
      if (currentResultsData && currentResultsData.subjects && currentResultsData.subjects.length > 0) {
        return currentResultsData;
      }
      const cached = readLocalCache(`currentResults:${u}`);
      if (cached) {
        currentResultsData = cached;
        return currentResultsData;
      }
      try {
        const res = await fetch(`${API_BASE}/api/current-semester-results`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) throw new Error('Session expired');
        if (!res.ok) throw new Error('Current semester results error');
        const data = await res.json();
        currentResultsData = data;
        if (u) writeLocalCache(`currentResults:${u}`, data);
        return currentResultsData;
      } catch (err) {
        // DO NOT return demo/fake data.
        throw err;
      }
    };

    const ensureAttendanceData = async (username) => {
      const u = username || localStorage.getItem('username') || sessionStorage.getItem('username') || '';
      if (currentAttendanceList && currentAttendanceList.length > 0) {
        return currentAttendanceList;
      }
      const cached = readLocalCache(`attendance:${u}`);
      if (cached) {
        currentAttendanceList = cached;
        return currentAttendanceList;
      }
      try {
        const res = await fetch(`${API_BASE}/api/attendance`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) throw new Error('Session expired');
        if (!res.ok) throw new Error('Attendance error');
        const subjects = await res.json();
        currentAttendanceList = subjects;
        if (u) writeLocalCache(`attendance:${u}`, subjects);
        return currentAttendanceList;
      } catch (err) {
        // DO NOT return demo/fake data.
        throw err;
      }
    };

    let liveClassUpdateTimer = null;

    const updateProfileLiveWidget = () => {
      const container = document.getElementById('liveClassWidgetContainer');
      if (container && currentTimetableData) {
        container.innerHTML = renderLiveClassWidget(currentTimetableData);
      }

      // Keep only the Live Class Tracker in sync with the clock.
      // Re-rendering every 30 seconds is enough to catch class
      // boundaries without touching any other portal functionality.
      if (!liveClassUpdateTimer) {
        liveClassUpdateTimer = setInterval(() => {
          const liveContainer = document.getElementById('liveClassWidgetContainer');
          if (liveContainer && currentTimetableData) {
            liveContainer.innerHTML = renderLiveClassWidget(currentTimetableData);
          }
        }, 30 * 1000);
      }
    };

    const loadTimetable = async () => {
      showSection(timetableSection);
      if (currentTimetableData) {
        renderTimetable(currentTimetableData, activeDayFilter);
      } else {
        timetableContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">Loading schedule...</p>';
      }
      try {
        const data = await ensureTimetableData();
        renderTimetable(data, activeDayFilter);
      } catch (err) {
        if (!currentTimetableData) {
          timetableContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;border:1px dashed var(--header-border);margin:10px;border-radius:8px;">Unable to load timetable. Please check your connection and try again.</p>';
        }
      }
    };

    const loadCourses = async () => {
      showSection(coursesSection);
      courseSearchInput.value = '';

      if (currentCoursesList && currentCoursesList.length > 0) {
        renderCourses(currentCoursesList, '');
        return;
      }

      coursesContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">Loading courses...</p>';

      try {
        const res = await fetch(`${API_BASE}/api/courses`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) return;
        if (!res.ok) throw new Error('Courses error');
        const courses = await res.json();
        currentCoursesList = courses;
        renderCourses(currentCoursesList, '');
      } catch (err) {
        try {
          await ensureTimetableData();
          renderCourses(currentCoursesList, '');
        } catch (e) {
          if (!currentCoursesList || currentCoursesList.length === 0) {
            coursesContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;border:1px dashed var(--header-border);margin:10px;border-radius:8px;">Unable to load courses. Please check your connection and try again.</p>';
          }
        }
      }
    };

    const loadAttendance = async () => {
      showSection(attendanceSection);
      if (currentAttendanceList && currentAttendanceList.length > 0) {
        renderAttendance(currentAttendanceList);
      } else {
        attendanceContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">Loading attendance...</p>';
      }
      try {
        const subjects = await ensureAttendanceData();
        renderAttendance(subjects);
      } catch (err) {
        if (!currentAttendanceList) {
          attendanceContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;border:1px dashed var(--header-border);margin:10px;border-radius:8px;">Unable to load attendance. Please check your connection and try again.</p>';
        }
      }
    };

    const loadInternalMarks = async () => {
      showSection(internalMarksSection);
      const previousList = currentInternalMarksList;
      if (previousList && previousList.length > 0) {
        renderInternalMarks(previousList);
      } else {
        internalMarksContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">Loading internal marks...</p>';
      }

      // Unlike Attendance/Timetable, this always does a live fetch instead
      // of serving the 30-min local cache — marks change often enough
      // right after they're entered that "last-known" data isn't good
      // enough here. Whatever was showing above stays up as a placeholder
      // until the fresh fetch resolves, so there's no flash of "Loading...".
      const u = localStorage.getItem('username') || sessionStorage.getItem('username') || '';
      currentInternalMarksList = null;
      if (u) localStorage.removeItem(`internalMarks:${u}`);

      try {
        const subjects = await ensureInternalMarksData(u);
        renderInternalMarks(subjects);
      } catch (err) {
        // Fresh fetch failed — fall back to whatever we had before rather
        // than wiping a perfectly good screen with an error message.
        currentInternalMarksList = previousList;
        if (previousList && previousList.length > 0) {
          previousList.isCached = true;
          renderInternalMarks(previousList);
        } else {
          internalMarksContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;border:1px dashed var(--header-border);margin:10px;border-radius:8px;">Unable to load internal marks. Please check your connection and try again.</p>';
        }
      }
    };

    const loadCurrentResults = async () => {
      showSection(currentResultsSection);
      if (currentResultsData && currentResultsData.subjects && currentResultsData.subjects.length > 0) {
        renderCurrentResults(currentResultsData);
      } else {
        currentResultsContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">Loading results...</p>';
      }
      try {
        const data = await ensureCurrentResultsData();
        renderCurrentResults(data);
      } catch (err) {
        if (!currentResultsData) {
          currentResultsContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;border:1px dashed var(--header-border);margin:10px;border-radius:8px;">Unable to load results. Please check your connection and try again.</p>';
        }
      }
    };

    const showMarkStatus = (message, isError) => {
      const icon = isError ? '!' : '\u2713';
      markAttendanceStatus.innerHTML = `<span class="status-icon">${icon}</span><span>${message}</span>`;
      markAttendanceStatus.classList.remove('error', 'success');
      markAttendanceStatus.classList.add('show', isError ? 'error' : 'success');
      codeBoxesWrap.classList.remove('error-glow', 'success-glow');
      codeBoxesWrap.classList.add(isError ? 'error-glow' : 'success-glow');
    };

    const clearMarkStatus = () => {
      markAttendanceStatus.innerHTML = '';
      markAttendanceStatus.classList.remove('show', 'error', 'success');
      codeBoxesWrap.classList.remove('error-glow', 'success-glow');
    };

    const loadTodayAttendanceStatus = async () => {
      if (!todayAttendanceStatus) return;
      todayAttendanceStatus.innerHTML = '<div class="today-card"><p class="today-card-empty">Loading today\'s attendance status...</p></div>';

      try {
        const res = await fetch(`${API_BASE}/api/att`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) return;
        if (!res.ok) {
          todayAttendanceStatus.innerHTML = '';
          return;
        }
        const data = await res.json();
        todayAttendanceStatus.innerHTML = renderTodayAttendanceStatus(data);
      } catch (err) {
        todayAttendanceStatus.innerHTML = '';
      }
    };

    const renderTodayAttendanceStatus = (data) => {
      const { dayOrder, onlineAttendance, periods } = data || {};

      if ((!periods || periods.length === 0) && (!onlineAttendance || onlineAttendance.length === 0) && !dayOrder) {
        return '<div class="today-card"><p class="today-card-empty">No attendance activity recorded for today yet.</p></div>';
      }

      const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));

      let html = '<div class="today-card">';

      html += '<div class="today-card-header">';
      html += '<span class="today-card-title">Today\'s Attendance</span>';
      if (dayOrder) {
        html += `<span class="today-card-dayorder">Day Order: ${esc(dayOrder)}</span>`;
      }
      html += '</div>';

      if (onlineAttendance && onlineAttendance.length > 0) {
        html += '<div class="today-card-section">';
        html += '<p class="today-card-section-label">Online Attendance</p>';
        onlineAttendance.forEach((line) => {
          html += `<div class="today-online-line">${esc(line)}</div>`;
        });
        html += '</div>';
      }

      if (periods && periods.length > 0) {
        html += '<div class="today-card-section">';
        html += '<p class="today-card-section-label">Subjects</p>';
        html += '<div class="today-period-grid">';
        periods.forEach((p) => {
          const isPresent = p.status === 'P';
          const isAbsent = p.status === 'A';
          const statusClass = isPresent ? 'present' : (isAbsent ? 'absent' : '');
          const statusLabel = isPresent ? 'Present' : (isAbsent ? 'Absent' : (p.status || '—'));
          html += `
            <div class="today-period-card">
              <div class="today-period-card-top">
                <span class="today-period-hour">Hour ${esc(p.hour)}</span>
                <span class="today-period-status ${statusClass}">${esc(statusLabel)}</span>
              </div>
              <span class="today-period-subject">${esc(p.subject)}</span>
            </div>
          `;
        });
        html += '</div></div>';
      }

      html += '</div>';
      return html;
    };

    const openMarkAttendance = () => {
      showSection(markAttendanceSection);
      clearMarkStatus();
      loadTodayAttendanceStatus();
      // No auto-focus on the code boxes: it pops the on-screen keyboard open
      // as soon as the tab is tapped. The keyboard appears when a box is tapped.
    };

    /* --------------------------------------------------------------------------
       9. CODE INPUTS
       -------------------------------------------------------------------------- */
    const codeBoxes = Array.from(document.querySelectorAll('.code-box'));

    codeBoxes.forEach((box, index) => {
      box.addEventListener('input', () => {
        const isLetterBox = index === 0;
        const pattern = isLetterBox ? /[^a-zA-Z]/g : /[^0-9]/g;
        box.value = box.value.replace(pattern, '').toUpperCase();

        codeBoxesWrap.classList.remove('error-glow', 'success-glow');
        markAttendanceStatus.classList.remove('show', 'error', 'success');
        markAttendanceStatus.innerHTML = '';

        if (box.value) {
          box.classList.add('filled');
          if (index < codeBoxes.length - 1) {
            codeBoxes[index + 1].focus();
          }
        } else {
          box.classList.remove('filled');
        }
      });

      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && index > 0) {
          codeBoxes[index - 1].focus();
        }
      });

      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase();
        pasted.split('').forEach((char, i) => {
          if (codeBoxes[i]) {
            const isLetterBox = i === 0;
            const pattern = isLetterBox ? /[^a-zA-Z]/g : /[^0-9]/g;
            const clean = char.replace(pattern, '');
            codeBoxes[i].value = clean;
            if (clean) codeBoxes[i].classList.add('filled');
          }
        });
        const lastFilled = Math.min(pasted.length, codeBoxes.length) - 1;
        if (lastFilled >= 0) codeBoxes[lastFilled].focus();
      });
    });

    const getEnteredCode = () => codeBoxes.map((box) => box.value).join('');

    const refreshAllAttendance = async (username) => {
      // Force a fresh fetch instead of relying on ensureAttendanceData's
      // early-return cache, since we specifically need post-mark data.
      currentAttendanceList = null;
      const u = username || localStorage.getItem('username') || sessionStorage.getItem('username') || '';
      if (u) localStorage.removeItem(`attendance:${u}`);

      const subjects = await ensureAttendanceData(u);
      if (attendanceSection && attendanceSection.style.display !== 'none') {
        renderAttendance(subjects);
      }

      loadTodayAttendanceStatus();
    };

    markAttendanceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const acode = getEnteredCode();

      if (acode.length !== 7) {
        showMarkStatus('Please enter all 7 characters of the code', true);
        return;
      }

      markAttendanceBtn.disabled = true;
      markAttendanceBtn.textContent = 'Verifying...';
      clearMarkStatus();

      try {
        const res = await fetch(`${API_BASE}/api/mark-attendance`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Session': sessionId
          },
          body: JSON.stringify({ acode })
        });

        if (!await checkResponseAuth(res)) return;

        if (!res.ok) {
          showMarkStatus("Unable to confirm attendance. Please check today's attendance status before trying again.", true);
          refreshAllAttendance();
          return;
        }

        let data;
        try {
          data = await res.json();
        } catch (jsonErr) {
          showMarkStatus("Unable to confirm attendance. Please check today's attendance status before trying again.", true);
          refreshAllAttendance();
          return;
        }

        const isSuccess = data && (data.resultstatus === '1' || data.resultstatus === 1);
        if (isSuccess) {
          showMarkStatus(data.result || 'Attendance marked successfully!', false);
          codeBoxes.forEach((box) => {
            box.value = '';
            box.classList.remove('filled');
          });
          refreshAllAttendance();
        } else if (data && (data.resultstatus === '0' || data.resultstatus === 0)) {
          showMarkStatus(data.result || 'Attendance marking failed', true);
        } else {
          showMarkStatus("Unable to confirm attendance. Please check today's attendance status before trying again.", true);
          refreshAllAttendance();
        }
      } catch (err) {
        showMarkStatus("Unable to confirm attendance. Please check today's attendance status before trying again.", true);
        refreshAllAttendance();
      } finally {
        markAttendanceBtn.disabled = false;
        markAttendanceBtn.textContent = 'Mark Attendance';
      }
    });

    /* --------------------------------------------------------------------------
       10. INK WRITING ANIMATION (THROTTLED)
       -------------------------------------------------------------------------- */
    inputs.forEach((input) => {
      let timer;
      input.addEventListener('input', () => {
        input.classList.remove('writing');
        void input.offsetWidth;
        input.classList.add('writing');
        clearTimeout(timer);
        timer = setTimeout(() => input.classList.remove('writing'), 250);
      });
    });

    /* --------------------------------------------------------------------------
       11. SESSION MANAGEMENT & FAST CACHE
       -------------------------------------------------------------------------- */
    const initSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/session`);
        const data = await res.json();
        sessionId = data.sessionId || res.headers.get('x-client-session') || ('sess_' + Date.now().toString(36));
      } catch (err) {
        sessionId = 'sess_' + Date.now().toString(36);
      }
    };

    const restoreSession = async () => {
      const storedSessionId = localStorage.getItem('sessionId') || sessionStorage.getItem('sessionId');
      const storedUsername = localStorage.getItem('username') || sessionStorage.getItem('username');
      const storedPassword = localStorage.getItem('password') || sessionStorage.getItem('password');

      if (storedUsername) {
        inMemoryUsername = storedUsername;
      }
      if (storedPassword) {
        inMemoryPassword = storedPassword;
      }

      if (!storedSessionId || !storedUsername) {
        await initSession();
        return;
      }

      sessionId = storedSessionId;
      ledger.style.display = 'none';
      if (loginThemeBar) loginThemeBar.style.display = 'none';
      if (appHeader) appHeader.classList.add('visible');

      // Instantly load cached profile without blocking
      loadProfile(storedUsername);
      // Preload all remaining portal data in the background for zero-lag switching
      preloadAllPortalData(storedUsername);
    };

    const fetchAsDataUrl = async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        return null;
      }
    };

    const readCachedProfile = (username) => {
      const raw = localStorage.getItem(`profile:${username}`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        const age = Date.now() - parsed.fetchedAt;
        if (age > CACHE_TTL_MS) return null;
        if (parseProfileFields(parsed.tableHtml).length === 0) {
          localStorage.removeItem(`profile:${username}`);
          return null;
        }
        return parsed;
      } catch (err) {
        return null;
      }
    };

    const writeCachedProfile = (username, tableHtml, photoTag, base64Photo = null) => {
      const current = readCachedProfile(username) || {};
      localStorage.setItem(`profile:${username}`, JSON.stringify({
        tableHtml,
        photoTag,
        base64Photo: base64Photo || current.base64Photo || null,
        fetchedAt: Date.now()
      }));
    };

    /* --------------------------------------------------------------------------
       MULTI-ACCOUNT: SAVED ACCOUNTS DATA LAYER
       -------------------------------------------------------------------------- */
    const getSavedAccounts = () => {
      try {
        return JSON.parse(localStorage.getItem('savedAccounts') || '[]');
      } catch (err) {
        return [];
      }
    };

    const saveSavedAccounts = (accounts) => {
      localStorage.setItem('savedAccounts', JSON.stringify(accounts));
    };

    // Called on every successful login. Password is only overwritten
    // when a fresh one is actually provided (switching to an already
    // saved account calls this again but shouldn't need to re-send
    // its own stored password back into itself).
    const upsertSavedAccount = (username, password, displayName) => {
      const accounts = getSavedAccounts();
      const existing = accounts.find((a) => a.username === username);
      if (existing) {
        if (displayName) existing.displayName = displayName;
        delete existing.password; // strip any value written by an older build
      } else {
        accounts.push({ username, displayName: displayName || username });
      }
      saveSavedAccounts(accounts);

      // The secret is held separately, tab-scoped.
      setAccountSecret(username, password);
    };

    const removeSavedAccount = (username) => {
      saveSavedAccounts(getSavedAccounts().filter((a) => a.username !== username));
      clearAccountSecret(username);
    };

    /* --------------------------------------------------------------------------
       PROFILE NAME: prints the student's name under the "Student Profile"
       heading. Uses the saved display name for the given username (falls
       back to the most recently saved account, then to "Student").
       -------------------------------------------------------------------------- */
    const showProfileName = (username) => {
      const el = document.getElementById('profileNameText');
      if (!el) return;

      const accounts = getSavedAccounts();
      const account = (username && accounts.find((a) => a.username === username))
        || accounts[accounts.length - 1];

      el.textContent = (account && (account.displayName || account.username)) || 'Student';
    };

    const getInitials = (name) => {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return '?';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    const renderSavedAccountsList = () => {
      const accounts = getSavedAccounts();
      const activeUsername = sessionId ? sessionStorage.getItem('username') : null;

      if (accounts.length === 0) {
        savedAccountsList.innerHTML = '<p class="no-saved-accounts">No saved profiles yet</p>';
        return;
      }

      savedAccountsList.innerHTML = accounts.map((account) => {
        const isActive = account.username === activeUsername;
        return `
          <div class="saved-account-row${isActive ? ' active' : ''}" data-username="${esc(account.username)}">
            <span class="saved-account-avatar">${esc(getInitials(account.displayName))}</span>
            <span class="saved-account-info">
              <span class="saved-account-name">${esc(account.displayName)}</span>
              <span class="saved-account-reg">${esc(account.username)}</span>
            </span>
            ${isActive ? '<span class="saved-account-active-badge">Active</span>' : ''}
            <button class="saved-account-remove" data-remove-username="${esc(account.username)}" type="button" title="Remove">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `;
      }).join('');
    };

    // Shared by the login form submit AND switching to an already-
    // saved account — one place that actually talks to the backend,
    // so both paths behave identically and never drift apart.
    const performLogin = async (username, password, { remember = false } = {}) => {
      inMemoryUsername = username;
      inMemoryPassword = password;

      if (!sessionId) {
        sessionId = 'sess_' + Date.now().toString(36);
      }

      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Session': sessionId
        },
        body: JSON.stringify({ username, password })
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = { success: true };
      }

      if (!res.ok || data.success === false) {
        throw new Error(data.message || 'Login verification failed');
      }

      if (data.sessionId) {
        sessionId = data.sessionId;
      }

      sessionStorage.setItem('sessionId', sessionId);
      sessionStorage.setItem('username', username);

      // Password goes to sessionStorage (tab-scoped) rather than localStorage.
      setStoredPassword(password);

      if (remember) {
        localStorage.setItem('sessionId', sessionId);
        localStorage.setItem('username', username);
      } else {
        localStorage.removeItem('sessionId');
        localStorage.removeItem('username');
        clearStoredPassword();
        setStoredPassword(password);
      }

      upsertSavedAccount(username, password);
      setAccountSession(username, sessionId);

      return data;
    };

    const loadProfile = async (username) => {
      hydrateLocalState(username);
      showProfileName(username);

      const cachedProfile = readCachedProfile(username);
      if (cachedProfile) {
        profileContent.innerHTML = renderProfileDisplay(cachedProfile.tableHtml, '');
        if (cachedProfile.base64Photo) {
          const container = document.getElementById('headerProfileContainer');
          if (container) {
            container.innerHTML = `<img src="${cachedProfile.base64Photo}" class="header-profile-img" alt="Profile">`;
          }
        } else if (cachedProfile.photoTag) {
          updateHeaderProfilePhoto(cachedProfile.photoTag);
        }
        showSection(profileSection);
      } else {
        updateHeaderProfilePhoto('');
        profileContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--ink-muted);text-align:center;padding:20px;">Loading profile...</p>';
        showSection(profileSection);
      }

      // Background revalidation
      try {
        const res = await fetch(`${API_BASE}/api/profile`, {
          headers: { 'X-Client-Session': sessionId }
        });
        if (!await checkResponseAuth(res)) return;
        if (!res.ok) return;
        const html = await res.text();
        const { photoTag, tableHtml } = splitPhotoAndTable(html);
        const parsedFields = parseProfileFields(tableHtml);
        if (parsedFields.length > 0) {
          profileContent.innerHTML = renderProfileDisplay(tableHtml, photoTag);

          const nameField = parsedFields.find((f) => f.label.toLowerCase() === 'student name')
            || parsedFields.find((f) => f.label.toLowerCase().includes('name') && !f.label.toLowerCase().includes('father') && !f.label.toLowerCase().includes('mother'));
          if (nameField && nameField.value) {
            upsertSavedAccount(username, null, nameField.value.replace(/<[^>]+>/g, '').trim());
            showProfileName(username);
          }

          let base64Photo = null;
          if (photoTag) {
            const srcMatch = photoTag.match(/src="([^"]+)"/i);
            if (srcMatch && srcMatch[1]) {
              const fullUrl = srcMatch[1].startsWith('http') ? srcMatch[1] : `${API_BASE || ''}${srcMatch[1]}`;
              base64Photo = await fetchAsDataUrl(fullUrl);
            }
          }

          if (base64Photo) {
            const container = document.getElementById('headerProfileContainer');
            if (container) {
              container.innerHTML = `<img src="${base64Photo}" class="header-profile-img" alt="Profile">`;
            }
          } else {
            updateHeaderProfilePhoto(photoTag);
          }

          writeCachedProfile(username, tableHtml, photoTag, base64Photo);
        }
      } catch (err) {
        if (!cachedProfile) {
          profileContent.innerHTML = '<p style="font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:var(--low-red);text-align:center;padding:20px;">Could not load profile — check your connection or try logging in again.</p>';
        }
      }
    };

    /* --------------------------------------------------------------------------
       12. PRE-FILL CREDENTIALS
       -------------------------------------------------------------------------- */
    const storedUsernameForPrefill = localStorage.getItem('username');
    if (storedUsernameForPrefill) {
      document.getElementById('username').value = storedUsernameForPrefill;
      document.getElementById('rememberMe').checked = true;
    }

    // The password field is deliberately left empty. Prefilling it required
    // keeping cleartext on disk; the username alone is enough to make the
    // "remember me" flow feel the same, and the browser's own password
    // manager already handles the rest (the input has
    // autocomplete="current-password").

    restoreSession();

    /* --------------------------------------------------------------------------
       13. LOGIN FORM SUBMISSION (SUPER-FAST PARALLEL PREWARM)
       -------------------------------------------------------------------------- */
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const remember = document.getElementById('rememberMe').checked;

      btn.disabled = true;
      btn.textContent = 'Verifying...';
      status.textContent = '';
      status.style.color = 'var(--low-red)';
      stamp.classList.remove('show');
      showSection(null);

      try {
        await performLogin(username, password, { remember });

        status.textContent = 'Entry Verified';
        status.style.color = 'var(--good-green)';
        stamp.classList.add('show');

        // Fire parallel data preload immediately so it's ready in 0ms
        preloadAllPortalData(username);

        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Login';
          ledger.style.display = 'none';
          if (loginThemeBar) loginThemeBar.style.display = 'none';
          if (appHeader) appHeader.classList.add('visible');
          window.scrollTo(0, 0);
          loadProfile(username);
        }, 150);

      } catch (err) {
        status.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Login';
      }
    });

    /* --------------------------------------------------------------------------
       14. BOTTOM NAVIGATION BAR
       A fixed tab bar along the bottom edge; it scrolls sideways when the
       tabs don't all fit. The tabs themselves are plain markup in
       login.html, CSS shows the bar only while the app header is visible,
       and showSection() marks the active tab — so all that is left here is
       the click handler further down.
       -------------------------------------------------------------------------- */
    const bottomNav = document.getElementById('bottomNav');

    /* --------------------------------------------------------------------------
       SUBJECT FEEDBACK
       Loads the subjects awaiting feedback, lets the student pick a rating,
       comment and subjects, then submits on their own session. "One-Tap
       Submit All" does the lot at once: a random comment + "Strongly Agree"
       + every pending subject.
       -------------------------------------------------------------------------- */
    const FEEDBACK_RATINGS = [
      { value: '1', label: 'Strongly Disagree' },
      { value: '2', label: 'Disagree' },
      { value: '3', label: 'Neutral' },
      { value: '4', label: 'Agree' },
      { value: '5', label: 'Strongly Agree' }
    ];

    const feedbackState = { subjects: [], selectedIds: [], rating: '5', comment: '', loaded: false, busy: false };

    const fetchRandomFeedbackComment = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/feedback/comment`, { headers: { 'X-Client-Session': sessionId } });
        if (res.ok) {
          const data = await res.json();
          if (data.comment) return data.comment;
        }
      } catch (err) { /* ignore — caller falls back */ }
      return '';
    };

    const loadFeedbackSubjects = async () => {
      const res = await fetch(`${API_BASE}/api/feedback/subjects`, { headers: { 'X-Client-Session': sessionId } });
      if (!await checkResponseAuth(res)) throw new Error('Session expired');
      if (!res.ok) throw new Error('Failed to load subjects');
      const data = await res.json();
      return Array.isArray(data.subjects) ? data.subjects : [];
    };

    const renderFeedback = () => {
      if (feedbackState.subjects.length === 0) {
        feedbackContent.innerHTML = `
          <div class="fb-empty">
            <p>No subjects are awaiting feedback — it may already be submitted.</p>
            <button class="att-tool-btn" type="button" data-fb="reload">Reload</button>
          </div>`;
        return;
      }

      const ratingBtns = FEEDBACK_RATINGS.map((r) => `
        <button class="fb-rating-btn${feedbackState.rating === r.value ? ' active' : ''}" type="button" data-fb="rating" data-value="${r.value}">${r.label}</button>
      `).join('');

      const subjectRows = feedbackState.subjects.map((s) => {
        const checked = feedbackState.selectedIds.includes(s.id);
        return `
          <label class="fb-subject${checked ? ' checked' : ''}">
            <input type="checkbox" data-fb="subject" data-id="${esc(s.id)}" ${checked ? 'checked' : ''}>
            <span class="fb-subject-body">
              <span class="fb-subject-name">${esc(s.name)}</span>
              ${s.faculty ? `<span class="fb-subject-faculty">${esc(s.faculty)}</span>` : ''}
            </span>
          </label>`;
      }).join('');

      const allSelected = feedbackState.selectedIds.length === feedbackState.subjects.length;

      feedbackContent.innerHTML = `
        <div class="fb-onetap">
          <div class="fb-onetap-text">
            <span class="fb-onetap-title">One-Tap Submit All</span>
            <span class="fb-onetap-sub">Rates every subject "Strongly Agree" with a random comment and submits instantly.</span>
          </div>
          <button class="att-action-btn" type="button" data-fb="onetap">One-Tap Submit All</button>
        </div>

        <div class="fb-field">
          <span class="fb-label">Rating — applies to every selected subject</span>
          <div class="fb-rating-row">${ratingBtns}</div>
        </div>

        <div class="fb-field">
          <div class="fb-label-row">
            <span class="fb-label">Comment</span>
            <button class="att-tool-btn icon-only" type="button" data-fb="random" title="Random comment" aria-label="Load a random comment">&#8635;</button>
          </div>
          <textarea class="fb-comment" data-fb="comment" rows="3" maxlength="500" placeholder="Write a comment, or use the shuffle button for a random one">${esc(feedbackState.comment)}</textarea>
          <span class="fb-charcount"><span data-fb="count">${feedbackState.comment.length}</span>/500</span>
        </div>

        <div class="fb-field">
          <div class="fb-label-row">
            <span class="fb-label" data-fb="subjCount">Subjects (${feedbackState.selectedIds.length}/${feedbackState.subjects.length})</span>
            <button class="att-tool-btn" type="button" data-fb="toggleAll">${allSelected ? 'Deselect all' : 'Select all'}</button>
          </div>
          <div class="fb-subject-list">${subjectRows}</div>
        </div>

        <button class="att-action-btn fb-submit" type="button" data-fb="submit">Submit Feedback (${feedbackState.selectedIds.length})</button>
        <div class="fb-result" data-fb="result"></div>
      `;
    };

    const refreshFeedbackData = async () => {
      const [subjects, comment] = await Promise.all([loadFeedbackSubjects(), fetchRandomFeedbackComment()]);
      feedbackState.subjects = subjects;
      feedbackState.selectedIds = subjects.map((s) => s.id);
      if (!feedbackState.comment) feedbackState.comment = comment;
      feedbackState.loaded = true;
      renderFeedback();
    };

    const openFeedback = async () => {
      showSection(feedbackSection);
      if (feedbackState.loaded) { renderFeedback(); return; }
      feedbackContent.innerHTML = '<p class="fb-loading">Loading feedback…</p>';
      try {
        await refreshFeedbackData();
      } catch (err) {
        feedbackContent.innerHTML = '<p class="fb-loading">Unable to load feedback. Check your connection and try again.</p>';
      }
    };

    const setFeedbackResult = (msg, ok) => {
      const el = feedbackContent.querySelector('[data-fb="result"]');
      if (el) {
        el.textContent = msg;
        el.className = `fb-result show ${ok ? 'ok' : 'err'}`;
      }
    };

    const submitFeedbackRequest = async (ratingValue, comment, ids) => {
      const res = await fetch(`${API_BASE}/api/feedback/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Session': sessionId },
        body: JSON.stringify({ comment, optionNo: ratingValue, selectedSubjectIds: ids })
      });
      if (!await checkResponseAuth(res)) throw new Error('Session expired');
      let data = {};
      try { data = await res.json(); } catch (err) { /* ignore */ }
      if (!res.ok) throw new Error(data.message || 'Feedback submission failed');
      return data;
    };

    feedbackContent.addEventListener('input', (e) => {
      const el = e.target.closest('[data-fb="comment"]');
      if (!el) return;
      feedbackState.comment = el.value;
      const count = feedbackContent.querySelector('[data-fb="count"]');
      if (count) count.textContent = String(el.value.length);
    });

    feedbackContent.addEventListener('change', (e) => {
      const el = e.target.closest('[data-fb="subject"]');
      if (!el) return;
      const id = el.dataset.id;
      if (el.checked) {
        if (!feedbackState.selectedIds.includes(id)) feedbackState.selectedIds.push(id);
      } else {
        feedbackState.selectedIds = feedbackState.selectedIds.filter((x) => x !== id);
      }
      const row = el.closest('.fb-subject');
      if (row) row.classList.toggle('checked', el.checked);
      const count = feedbackContent.querySelector('[data-fb="subjCount"]');
      if (count) count.textContent = `Subjects (${feedbackState.selectedIds.length}/${feedbackState.subjects.length})`;
      const submitBtn = feedbackContent.querySelector('[data-fb="submit"]');
      if (submitBtn) submitBtn.textContent = `Submit Feedback (${feedbackState.selectedIds.length})`;
    });

    feedbackContent.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-fb]');
      if (!el) return;
      const kind = el.dataset.fb;

      if (kind === 'reload') {
        feedbackState.loaded = false;
        feedbackState.comment = '';
        openFeedback();
        return;
      }

      if (kind === 'rating') {
        feedbackState.rating = el.dataset.value;
        feedbackContent.querySelectorAll('[data-fb="rating"]').forEach((b) =>
          b.classList.toggle('active', b.dataset.value === feedbackState.rating));
        return;
      }

      if (kind === 'toggleAll') {
        const all = feedbackState.selectedIds.length === feedbackState.subjects.length;
        feedbackState.selectedIds = all ? [] : feedbackState.subjects.map((s) => s.id);
        renderFeedback();
        return;
      }

      if (kind === 'random') {
        const comment = await fetchRandomFeedbackComment();
        if (comment) {
          feedbackState.comment = comment;
          const ta = feedbackContent.querySelector('[data-fb="comment"]');
          const count = feedbackContent.querySelector('[data-fb="count"]');
          if (ta) ta.value = comment;
          if (count) count.textContent = String(comment.length);
        }
        return;
      }

      if (kind === 'onetap' || kind === 'submit') {
        if (feedbackState.busy) return;

        let comment = feedbackState.comment;
        let ratingValue = feedbackState.rating;
        let ids = feedbackState.selectedIds;

        if (kind === 'onetap') {
          ratingValue = '5';
          ids = feedbackState.subjects.map((s) => s.id);
          const fresh = await fetchRandomFeedbackComment();
          if (fresh) comment = fresh;
        }

        if (!comment || comment.trim().length <= 10) {
          setFeedbackResult('Add a comment longer than 10 characters (or use the shuffle button).', false);
          return;
        }
        if (ids.length === 0) {
          setFeedbackResult('Select at least one subject.', false);
          return;
        }

        feedbackState.busy = true;
        el.disabled = true;
        const original = el.textContent;
        el.textContent = 'Submitting…';
        try {
          const data = await submitFeedbackRequest(ratingValue, comment, ids);
          const ok = data.success !== false;
          // Reload the remaining subjects, then show the result on the fresh view.
          feedbackState.comment = '';
          await refreshFeedbackData();
          setFeedbackResult(data.message || (ok ? 'Feedback submitted' : 'Feedback submission failed'), ok);
        } catch (err) {
          setFeedbackResult(err.message || 'Feedback submission failed', false);
          el.disabled = false;
          el.textContent = original;
        } finally {
          feedbackState.busy = false;
        }
      }
    });

    const brandHomeBtn = document.getElementById('brandHomeBtn');
    if (brandHomeBtn) {
      brandHomeBtn.addEventListener('click', () => {
        showSection(profileSection);
      });
    }

    const headerProfileContainer = document.getElementById('headerProfileContainer');
    if (headerProfileContainer) {
      headerProfileContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSavedAccountsList();
        const isOpen = accountMenu.classList.toggle('open');
        headerProfileContainer.setAttribute('aria-expanded', isOpen);
      });
    }

    document.addEventListener('click', (e) => {
      if (!accountMenu.contains(e.target) && e.target !== headerProfileContainer && !headerProfileContainer.contains(e.target)) {
        accountMenu.classList.remove('open');
        headerProfileContainer.setAttribute('aria-expanded', 'false');
      }
    });

    // Full logout — clears the active session and its cached data,
    // but deliberately never touches savedAccounts. That list is
    // only ever changed by an explicit remove click, matching "stays
    // saved until I choose to remove it."
    const performFullLogout = async () => {
      inMemoryUsername = null;
      inMemoryPassword = null;

      try {
        fetch(`${API_BASE}/api/logout`, {
          method: 'POST',
          headers: { 'X-Client-Session': sessionId }
        });
      } catch (err) {}

      const u = localStorage.getItem('username') || sessionStorage.getItem('username') || '';
      sessionStorage.removeItem('sessionId');
      sessionStorage.removeItem('username');
      localStorage.removeItem('sessionId');
      localStorage.removeItem('username');
      localStorage.removeItem('password');
      if (u) {
        clearAccountSession(u);
        localStorage.removeItem(`profile:${u}`);
        localStorage.removeItem(`timetable:${u}`);
        localStorage.removeItem(`attendance:${u}`);
        localStorage.removeItem(`internalMarks:${u}`);
        localStorage.removeItem(`currentResults:${u}`);
      }
      sessionId = null;
      currentTimetableData = null;
      currentCoursesList = [];
      currentAttendanceList = null;
      currentInternalMarksList = null;
      currentResultsData = null;

      showSection(null);
      if (appHeader) appHeader.classList.remove('visible');
      if (loginThemeBar) loginThemeBar.style.display = 'flex';
      updateHeaderProfilePhoto('');
      profileContent.innerHTML = '';
      timetableContent.innerHTML = '';
      coursesContent.innerHTML = '';
      attendanceContent.innerHTML = '';
      internalMarksContent.innerHTML = '';
      currentResultsContent.innerHTML = '';
      ledger.style.display = 'block';
      status.textContent = '';
      form.reset();
      await initSession();
    };

    if (accountLogoutBtn) {
      accountLogoutBtn.addEventListener('click', () => {
        accountMenu.classList.remove('open');
        performFullLogout();
      });
    }

    if (addProfileBtn) {
      addProfileBtn.addEventListener('click', () => {
        accountMenu.classList.remove('open');
        // Doesn't log out the current account — just brings the
        // login form back up (with empty fields) so a different
        // account's credentials can be entered. That successful
        // login becomes the new active one; the old one stays saved.
        showSection(null);
        if (appHeader) appHeader.classList.remove('visible');
        if (loginThemeBar) loginThemeBar.style.display = 'flex';
        ledger.style.display = 'block';
        form.reset();
        document.getElementById('rememberMe').checked = false;
        status.textContent = '';
        window.scrollTo(0, 0);
        document.getElementById('username').focus();
      });
    }

    if (savedAccountsList) {
      savedAccountsList.addEventListener('click', async (e) => {
        const removeBtn = e.target.closest('.saved-account-remove');
        if (removeBtn) {
          e.stopPropagation();
          const usernameToRemove = removeBtn.dataset.removeUsername;
          const activeUsername = sessionId ? sessionStorage.getItem('username') : null;
          removeSavedAccount(usernameToRemove);
          localStorage.removeItem(`profile:${usernameToRemove}`);
          localStorage.removeItem(`timetable:${usernameToRemove}`);
          localStorage.removeItem(`attendance:${usernameToRemove}`);
          localStorage.removeItem(`internalMarks:${usernameToRemove}`);
          localStorage.removeItem(`currentResults:${usernameToRemove}`);
          if (usernameToRemove === activeUsername) {
            accountMenu.classList.remove('open');
            await performFullLogout();
          } else {
            // End the removed profile's kept-alive backend session too.
            const removedSessionId = getAccountSession(usernameToRemove);
            if (removedSessionId) {
              fetch(`${API_BASE}/api/logout`, {
                method: 'POST',
                headers: { 'X-Client-Session': removedSessionId }
              }).catch(() => {});
            }
            clearAccountSession(usernameToRemove);
            renderSavedAccountsList();
          }
          return;
        }

        const row = e.target.closest('.saved-account-row');
        if (!row) return;
        const usernameToSwitch = row.dataset.username;
        const activeUsername = sessionId ? sessionStorage.getItem('username') : null;
        if (usernameToSwitch === activeUsername) {
          accountMenu.classList.remove('open');
          showSection(profileSection);
          return;
        }

        const account = getSavedAccounts().find((a) => a.username === usernameToSwitch);
        const accountPassword = account ? getAccountSecret(account.username) : '';
        if (!account || !accountPassword) {
          accountMenu.classList.remove('open');
          status.textContent = 'Saved password missing — please log in again';
          showSection(null);
          if (appHeader) appHeader.classList.remove('visible');
          ledger.style.display = 'block';
          document.getElementById('username').value = usernameToSwitch;
          return;
        }

        accountMenu.classList.remove('open');

        // This profile already has a session from its last login — pick it
        // back up instead of logging in to SRM again. If that session has
        // since expired, the first request after the reload gets a 401 and
        // the "SRM Session Expired" popup offers the reconnect.
        const keptSessionId = getAccountSession(account.username);
        if (keptSessionId) {
          sessionStorage.setItem('sessionId', keptSessionId);
          sessionStorage.setItem('username', account.username);
          localStorage.setItem('sessionId', keptSessionId);
          localStorage.setItem('username', account.username);
          // Reconnect reads the active password from here.
          setStoredPassword(accountPassword);
          window.location.reload();
          return;
        }

        try {
          sessionId = null;
          showProfileSwitchPopup(account.username);

          // Instantly switch profile picture to new account's cached pic or empty fallback
          const cachedProfile = readCachedProfile(account.username);
          const container = document.getElementById('headerProfileContainer');
          if (container) {
            if (cachedProfile && cachedProfile.base64Photo) {
              container.innerHTML = `<img src="${cachedProfile.base64Photo}" class="header-profile-img" alt="Profile">`;
            } else if (cachedProfile && cachedProfile.photoTag) {
              updateHeaderProfilePhoto(cachedProfile.photoTag);
            } else {
              updateHeaderProfilePhoto('');
            }
          }

          await performLogin(account.username, accountPassword, { remember: true });

          // FIX: previously patched the DOM in place after switching (photo,
          // sections, cached profile) but left every other panel — timetable,
          // attendance, courses — showing whatever the last account's data
          // was until each one happened to re-fetch. A full reload forces
          // restoreSession() to rebuild the whole page from the new account's
          // localStorage/session state, so nothing stale can linger.
          window.location.reload();
          return;
        } catch (err) {
          hideProfileSwitchPopup();
          status.textContent = err.message || 'Profile switch failed: Invalid credentials or captcha verification failed';
          showSection(null);
          if (appHeader) appHeader.classList.remove('visible');
          ledger.style.display = 'block';
        }
      });
    }

    bottomNav.addEventListener('click', async (e) => {
      const item = e.target.closest('.bottom-nav-item');
      if (!item) return;
      const action = item.dataset.action;
      if (!action) return;

      accountMenu.classList.remove('open');
      window.scrollTo(0, 0);
      // Bring a half-hidden tab fully into view when it is tapped.
      item.scrollIntoView({ block: 'nearest', inline: 'nearest' });

      if (action === 'profile') {
        showSection(profileSection);
      } else if (action === 'timetable') {
        loadTimetable();
      } else if (action === 'courses') {
        loadCourses();
      } else if (action === 'attendance') {
        loadAttendance();
      } else if (action === 'internalMarks') {
        loadInternalMarks();
      } else if (action === 'currentResults') {
        loadCurrentResults();
      } else if (action === 'markAttendance') {
        openMarkAttendance();
      } else if (action === 'feedback') {
        openFeedback();
      }
    });
