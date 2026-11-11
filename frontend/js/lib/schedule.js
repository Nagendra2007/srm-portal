/* Timetable helpers: which day is "today", what a slot contains, and what is
   happening right now. Shared by Home and Timetable. */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FREE_CODES = new Set(['', '-', '&NBSP;', 'FREE', 'NIL']);

export const hasSchedule = (timetable) =>
  !!(timetable && Array.isArray(timetable.schedule) && timetable.schedule.length > 0);

// Course code -> course title, from the subject list that ships with the timetable.
export const buildSubjectMap = (timetable) => {
  const map = {};
  if (timetable && Array.isArray(timetable.subjects)) {
    timetable.subjects.forEach((subject) => {
      const code = (subject.courseCode || subject.code || '').trim();
      const title = (subject.courseTitle || subject.title || '').trim();
      if (code && title) {
        map[code.toLowerCase()] = title;
        map[code.replace(/\s+/g, '').toLowerCase()] = title;
      }
    });
  }
  return map;
};

/* "09:00", "1.30", "2:20 pm" -> minutes from midnight. SRM timetables can omit
   AM/PM and write afternoon periods as 1:00, 2:00, so a bare hour of 1-6 is
   read as afternoon. */
const parseTimeToMinutes = (text) => {
  if (!text) return null;
  const match = String(text).trim().match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridian = (match[3] || '').toLowerCase();
  if (hours > 23 || minutes > 59) return null;

  if (meridian === 'pm' && hours < 12) hours += 12;
  if (meridian === 'am' && hours === 12) hours = 0;
  if (!meridian && hours >= 1 && hours <= 6) hours += 12;

  return hours * 60 + minutes;
};

export const normalizeSlot = (slot, index, subjectMap) => {
  const code = (slot.courseCode || slot.code || '').trim();
  const rawCodeRoom = (slot.codeRoom || '').trim();
  const cleanCode = code || (rawCodeRoom !== '-' && rawCodeRoom !== '&nbsp;' ? rawCodeRoom : '');
  const isFree = FREE_CODES.has(cleanCode.toUpperCase());

  const period = String(
    slot.period || slot.slotNumber || (slot.slotIndex != null ? slot.slotIndex + 1 : index + 1)
  );
  const time = String(slot.time || slot.timing || '').trim();
  const room = (slot.room || slot.roomNo || '').trim();

  let title = (slot.courseTitle || slot.subjectName || slot.title || '').trim();
  if (!title && cleanCode) {
    title = subjectMap[cleanCode.toLowerCase()] ||
      subjectMap[cleanCode.replace(/\s+/g, '').toLowerCase()] ||
      cleanCode;
  }

  let startMin = null;
  let endMin = null;
  let startText = '';
  let endText = '';
  const range = time.match(/^\s*(.*?)\s*(?:-|to)\s*(.*?)\s*$/i);
  if (range) {
    startMin = parseTimeToMinutes(range[1]);
    endMin = parseTimeToMinutes(range[2]);
    if (startMin != null && endMin != null) {
      startText = range[1];
      endText = range[2];
    }
  }

  return {
    index,
    period,
    time,
    startText,
    endText,
    code: isFree ? '' : cleanCode,
    title: isFree ? 'Free period' : (title || cleanCode),
    room: isFree ? '' : room,
    isFree,
    startMin,
    endMin
  };
};

export const normalizeDay = (dayObj, subjectMap) =>
  (Array.isArray(dayObj?.slots) ? dayObj.slots : []).map((slot, i) => normalizeSlot(slot, i, subjectMap));

export const countClasses = (slots) => slots.filter((slot) => !slot.isFree).length;

/* Which schedule entry is today.

   1. A weekday name ("Monday") in the timetable wins.
   2. SRM usually labels days "Day 1".."Day 5" instead. When the portal has
      told us today's real day order (from the today's-attendance report) use
      that, since day orders shift after holidays.
   3. Otherwise fall back to weekday position (Monday = Day 1), which is what
      this app has always assumed.

   Returns null when nothing matches — callers show "no classes today" rather
   than borrowing another day's classes. */
export const findToday = (timetable, dayOrderHint) => {
  if (!hasSchedule(timetable)) return null;
  const schedule = timetable.schedule;
  const dayIndex = new Date().getDay();
  const weekday = WEEKDAYS[dayIndex].toLowerCase();

  const byWeekday = schedule.find((s) => s.day && s.day.trim().toLowerCase().includes(weekday));
  if (byWeekday) return byWeekday;

  const matchOrder = (n) => schedule.find((s) =>
    s.day && new RegExp(`^day\\s*[-_]?\\s*${n}$`, 'i').test(s.day.trim()));

  const hinted = String(dayOrderHint ?? '').match(/[1-6]/);
  if (hinted) {
    const byHint = matchOrder(hinted[0]);
    if (byHint) return byHint;
  }

  if (dayIndex >= 1 && dayIndex <= 6) {
    const byPosition = matchOrder(dayIndex);
    if (byPosition) return byPosition;
  }

  return null;
};

export const weekdayName = () => WEEKDAYS[new Date().getDay()];

export const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/* Snapshot of right now, from today's slots only:
     current — the slot whose time range contains now (may be a free period)
     next    — the earliest real class starting strictly after now */
export const liveStatus = (slots, minutes = nowMinutes()) => {
  const timed = slots.filter((slot) => slot.startMin != null && slot.endMin != null);
  const current = timed.find((slot) => slot.startMin <= minutes && minutes < slot.endMin) || null;
  const next = timed
    .filter((slot) => !slot.isFree && slot.startMin > minutes)
    .sort((a, b) => a.startMin - b.startMin)[0] || null;
  const classes = slots.filter((slot) => !slot.isFree);
  const done = classes.length > 0 && !next && !(current && !current.isFree);

  return { current, next, classes, done, minutes };
};

export const formatDuration = (minutes) => {
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

// Drop free periods before the first class and after the last one.
export const trimFreeEdges = (slots) => {
  const first = slots.findIndex((slot) => !slot.isFree);
  if (first === -1) return [];
  let last = slots.length - 1;
  while (last > first && slots[last].isFree) last -= 1;
  return slots.slice(first, last + 1);
};
