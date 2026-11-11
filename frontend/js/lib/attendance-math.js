// Attendance arithmetic shared by Home and the Attendance page.

export const MIN_ATTENDANCE = 75;

export const attendancePct = (present, total) => (total > 0 ? (present / total) * 100 : 0);

export const fmtPct = (value) => `${value.toFixed(2)}%`;

// Classes that can still be missed while staying at or above the minimum.
export const classesCanSkip = (present, total) =>
  Math.max(0, Math.floor(present / (MIN_ATTENDANCE / 100) - total));

// Classes that must be attended in a row to get back to the minimum.
export const classesNeeded = (present, total) => {
  const min = MIN_ATTENDANCE / 100;
  return Math.max(0, Math.ceil((min * total - present) / (1 - min)));
};

export const summarize = (subjects) => {
  const present = subjects.reduce((sum, s) => sum + (Number(s.present) || 0), 0);
  const total = subjects.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const below = subjects.filter((s) => s.attendancePercent < MIN_ATTENDANCE).length;
  return {
    present,
    total,
    overall: attendancePct(present, total),
    below,
    safe: subjects.length - below
  };
};
