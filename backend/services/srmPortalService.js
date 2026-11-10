import * as cheerio from 'cheerio'
import { solveCaptchaImage } from './captchaSolver.js'

export const SRM_HOST = 'student.srmap.edu.in'
const SRM_BASE_URL = `https://${SRM_HOST}/srmapstudentcorner/`

const CAPTCHA_URL = `${SRM_BASE_URL}captchas`
const LOGIN_URL = `${SRM_BASE_URL}StudentLoginToPortal`
const REPORT_URL = `${SRM_BASE_URL}students/report/studentreportresources.jsp`
const DASHBOARD_URL = `${SRM_BASE_URL.replace(/\/$/, '')}/HRDSystem`
const ATTENDANCE_URL = `${SRM_BASE_URL}students/transaction/studentattendanceresources.jsp`
const TODAY_ATTENDANCE_URL = `${SRM_BASE_URL}students/transaction/studentattendance.jsp`

export const REPORT_IDS = {
  profile: '1',
  timetable: '10',
  attendance: '3',
  internalMarks: '5',
  currentSemesterResults: '15'
}

const MIN_ATTENDANCE_PERCENT = 75

/* --------------------------------------------------------------------------
   SSRF GUARD
   Anything that takes a URL from the client must be pinned to SRM's host.
   Previously /api/photo passed ?src= straight through, so the server would
   fetch any URL asked of it — including cloud metadata and localhost.
   -------------------------------------------------------------------------- */
export const resolveSrmUrl = (url) => {
  const resolved = new URL(url, SRM_BASE_URL)

  if (resolved.protocol !== 'https:' || resolved.hostname !== SRM_HOST) {
    const error = new Error('Refusing to fetch a non-SRM URL')
    error.statusCode = 400
    throw error
  }

  return resolved.href
}

/* --------------------------------------------------------------------------
   SESSION / LOGIN STATE DETECTION
   Single source of truth — checkSessionExpiry and isLoginSuccessful used to
   carry two byte-identical copies of this list, which is how they drift.
   -------------------------------------------------------------------------- */
const LANDING_PAGE_MARKERS = [
  'developed by: firstline infotech',
  'enter application number',
  'enter captcha text',
  'txtusername',
  'txtauthkey'
]

// FIX: 'incorrect' on its own matched any page that happened to contain the
// word. Anchored to the phrases SRM actually renders instead.
const LOGIN_ERROR_MARKERS = [
  'invalid captcha',
  'invalid username',
  'invalid password',
  'incorrect username',
  'incorrect password',
  'authentication failed'
]

const isLandingPage = (lower) => LANDING_PAGE_MARKERS.some((m) => lower.includes(m))

export const checkSessionExpiry = (html) => {
  if (!html || typeof html !== 'string') return

  if (isLandingPage(html.toLowerCase())) {
    const error = new Error('SRM session expired or logged out')
    error.statusCode = 401
    throw error
  }
}

// FIX: this used to `return true` when the body was empty or not a string —
// i.e. an empty response from SRM counted as a successful login. Failing
// closed is the only safe default for an auth check.
const isLoginSuccessful = (html) => {
  if (!html || typeof html !== 'string') return false

  const lower = html.toLowerCase()
  return !isLandingPage(lower) && !LOGIN_ERROR_MARKERS.some((m) => lower.includes(m))
}

/* --------------------------------------------------------------------------
   PARSERS
   -------------------------------------------------------------------------- */
export const parseAttendance = (html) => {
  const $ = cheerio.load(html)
  const subjects = []

  $('#tblSubjectWiseAttendance tr').each((_, row) => {
    const cells = $(row).find('td')
    if (cells.length !== 9) return

    const code = $(cells[0]).text().trim()
    const description = $(cells[1]).text().trim()
    const present = parseInt($(cells[3]).text().trim(), 10)
    const absent = parseInt($(cells[4]).text().trim(), 10)
    const attendancePercent = parseFloat($(cells[8]).text().trim())

    if (!code || Number.isNaN(present) || Number.isNaN(absent)) return

    const total = present + absent
    const canSkip = Math.max(
      0,
      Math.floor(present / (MIN_ATTENDANCE_PERCENT / 100) - total)
    )

    subjects.push({ code, description, present, absent, total, attendancePercent, canSkip })
  })

  return subjects
}

const clean = (text) => text.replace(/\u00a0/g, '').trim()

/* --------------------------------------------------------------------------
   INTERNAL MARKS (report id 5)
   Top-level table has one row per subject (code, description, marks
   obtained, max marks). Clicking a row toggles a hidden `#subject<N>` div
   right below it with the component-wise breakdown (Mid Sem, CLA 1-3, Lab
   Performance, etc). `<N>` is just the subject's position in the table, so
   we can pair each row with its breakdown div by index instead of relying
   on any id/name matching.
   -------------------------------------------------------------------------- */
export const parseInternalMarks = (html) => {
  if (!html) return []
  const $ = cheerio.load(html)
  const subjects = []

  $('tbody tr.table-striped').each((i, row) => {
    const cells = $(row).find('td')
    if (cells.length < 4) return

    const code = clean($(cells[0]).text())
    const description = clean($(cells[1]).text())
    const marksObtainedRaw = clean($(cells[2]).text())
    const maxMarksRaw = clean($(cells[3]).text())

    if (!code) return

    const marksObtained = parseFloat(marksObtainedRaw)
    const maxMarks = parseFloat(maxMarksRaw)

    const components = []
    // First row of the breakdown table is just the "Name / Conducted /
    // Converted" header — skip it.
    $(`#subject${i} table tr`).slice(1).each((_, compRow) => {
      const compCells = $(compRow).find('td')
      if (compCells.length < 3) return

      const name = clean($(compCells[0]).text())
      if (!name) return

      const conducted = clean($(compCells[1]).text())
      const converted = clean($(compCells[2]).text())

      components.push({
        name,
        conducted: conducted || null,
        converted: converted || null
      })
    })

    subjects.push({
      code,
      description,
      marksObtained: Number.isNaN(marksObtained) ? null : marksObtained,
      maxMarks: Number.isNaN(maxMarks) ? null : maxMarks,
      components
    })
  })

  return subjects
}

/* --------------------------------------------------------------------------
   CURRENT SEMESTER RESULTS (report id 15)
   One row per subject (semester, code, description, credit, grade, result),
   plus a trailing S.G.P.A summary row. We deliberately drop the disclaimer
   row (it's the one <td colspan="6"> cell with no real data in it).
   -------------------------------------------------------------------------- */
export const parseCurrentSemesterResults = (html) => {
  if (!html) return { title: '', subjects: [], sgpa: null }
  const $ = cheerio.load(html)

  const title = clean($('table thead th[colspan="6"]').first().text())

  const subjects = []
  let sgpa = null

  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td')

    if (cells.length === 6) {
      const semester = clean($(cells[0]).text())
      const code = clean($(cells[1]).text())
      const description = clean($(cells[2]).text())
      const credit = clean($(cells[3]).text())
      const grade = clean($(cells[4]).text())
      const result = clean($(cells[5]).text())

      if (!code) return
      subjects.push({ semester, code, description, credit, grade, result })
      return
    }

    // S.G.P.A row is 2 <td>s: label, value. Disclaimer row is a single
    // colspan="6" cell — neither has 6 cells, so both land here, and only
    // the S.G.P.A one matches the label check.
    if (cells.length === 2) {
      const label = clean($(cells[0]).text())
      if (/S\.?G\.?P\.?A/i.test(label)) {
        sgpa = clean($(cells[1]).text())
      }
    }
  })

  return { title, subjects, sgpa }
}

export const parseTimetableData = (html) => {
  if (!html) return { periods: [], schedule: [], subjects: [] }
  const $ = cheerio.load(html)

  const periods = []
  const periodNums = []

  $('#tblClassTimetable tr.timetablehead td, #tblClassTimetable tr:first-child td, #tblClassTimetable tr:first-child th').each((i, cell) => {
    const num = clean($(cell).text())
    if (num && num !== '&nbsp;' && !/^(day|time|period)/i.test(num)) periodNums.push(num)
  })

  $('#tblClassTimetable tr.subheader td, #tblClassTimetable tr:nth-child(2) td').each((i, cell) => {
    const timing = clean($(cell).text())
    if (timing && timing !== '&nbsp;' && !/^(day|time|period)/i.test(timing) &&
        (timing.includes(':') || timing.includes('-') || timing.toLowerCase().includes('to'))) {
      const slotNum = periodNums[periods.length] || String(periods.length + 1)
      const normalized = timing.replace(/\s+/g, ' ')
      periods.push({ slotNumber: slotNum, period: slotNum, timing: normalized, time: normalized })
    }
  })

  const schedule = []
  const validDayPattern = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day\s*[-_]?\s*[1-6]|day\s*[ivx]+)/i

  $('#tblClassTimetable tr').each((_, row) => {
    const cells = $(row).find('td, th')
    if (cells.length < 2) return

    const firstCellText = clean($(cells[0]).text())
    if (!firstCellText || !validDayPattern.test(firstCellText)) return

    const dayName = firstCellText.replace(/\s+/g, ' ')
    const slots = []

    $(row).find('td.timetabledetails, td:not(:first-child)').each((colIdx, cell) => {
      const $cell = $(cell)
      if ($cell.hasClass('subheader') || $cell.hasClass('timetablehead')) return

      const title = $cell.attr('title')?.trim() || ''
      const rawText = clean($cell.text())

      let code = ''
      let room = ''
      if (rawText && rawText !== '-' && rawText !== '&nbsp;') {
        const match = rawText.match(/^(.*?)\((.*?)\)$/)
        if (match) {
          code = match[1].trim()
          room = match[2].trim()
        } else if (rawText.includes('\n')) {
          const parts = rawText.split('\n').map((p) => p.trim()).filter(Boolean)
          code = parts[0] || rawText
          room = parts[1] || ''
        } else {
          code = rawText
        }
      }

      const slot = periods[colIdx]
      const pNum = slot?.period || slot?.slotNumber || String(colIdx + 1)
      const pTiming = slot?.time || slot?.timing || ''

      slots.push({
        slotIndex: colIdx,
        slotNumber: pNum,
        period: pNum,
        timing: pTiming,
        time: pTiming,
        codeRoom: rawText,
        code,
        courseCode: code,
        room,
        roomNo: room,
        subjectName: title,
        title,
        courseTitle: title || code
      })
    })

    if (slots.length > 0) schedule.push({ day: dayName, slots })
  })

  const subjects = []
  $('#tblSubjectList tr, table.subjectlist tr').each((i, row) => {
    const cells = $(row).find('td')
    if (cells.length < 4 || $(cells[0]).hasClass('subheader') || $(cells[0]).hasClass('tableheader')) return

    const wide = cells.length >= 5
    const code = clean($(cells[0]).text())
    const title = clean($(cells[1]).text())
    const ltpc = wide ? clean($(cells[2]).text()) : ''
    const faculty = wide ? clean($(cells[3]).text()) : clean($(cells[2]).text())
    const room = wide ? clean($(cells[4]).text()) : clean($(cells[3]).text())

    const lowerCode = code.toLowerCase()
    if (code && !lowerCode.includes('code') && !lowerCode.includes('subject') && !lowerCode.includes('s.no')) {
      subjects.push({
        code,
        courseCode: code,
        title,
        courseTitle: title,
        ltpc,
        faculty,
        facultyName: faculty,
        room,
        roomNo: room
      })
    }
  })

  return { periods, schedule, subjects }
}

export const parseTodayAttendance = (html) => {
  const $ = cheerio.load(html || '')

  let dayOrder = ''
  const onlineAttendance = []
  const periods = []

  $('.container-fluid').each((_, container) => {
    const $container = $(container)
    const heading = $container.find('.row').first().text().trim()

    if (/current attendance/i.test(heading)) {
      $container.find('.row').each((__, row) => {
        const cols = $(row).find('div[class*="col-"]')
        if (cols.length === 2 && $(cols[0]).text().trim().toLowerCase() === 'day order') {
          dayOrder = $(cols[1]).text().trim()
        }
      })
      return
    }

    if (/online attendance/i.test(heading)) {
      $container.find('.row').each((__, row) => {
        const cols = $(row).find('div[class*="col-"]')
        if (cols.length === 1) {
          const text = $(cols[0]).text().trim()
          if (text) onlineAttendance.push(text)
        }
      })
      return
    }

    if (/today attendance/i.test(heading)) {
      $container.find('.row').each((__, row) => {
        const cols = $(row).find('div[class*="col-"]')
        if (cols.length !== 5) return

        const date = $(cols[0]).text().trim()
        if (date.toLowerCase() === 'date') return

        periods.push({
          date,
          dayOrder: $(cols[1]).text().trim(),
          hour: $(cols[2]).text().trim(),
          subject: $(cols[3]).text().trim(),
          status: $(cols[4]).text().trim()
        })
      })
    }
  })

  return { dayOrder, onlineAttendance, periods }
}

/* --------------------------------------------------------------------------
   CAPTCHA
   Solved locally by the TFLite model in captchaSolver.js (this replaced the
   Tesseract OCR worker).
   -------------------------------------------------------------------------- */
export const solveCaptcha = async (client) => {
  const captchaResponse = await client.get(CAPTCHA_URL, { responseType: 'arraybuffer' })

  return solveCaptchaImage(captchaResponse.data)
}

/* --------------------------------------------------------------------------
   SRM REQUESTS
   -------------------------------------------------------------------------- */
export const fetchBinaryResource = async (client, url) => {
  const response = await client.get(resolveSrmUrl(url), { responseType: 'arraybuffer' })

  return {
    contentType: response.headers['content-type'] || 'image/jpeg',
    imageBuffer: response.data
  }
}

export const fetchStudentPhotoUrl = async (client) => {
  const response = await client.get(DASHBOARD_URL)
  const html = typeof response.data === 'string' ? response.data : ''
  checkSessionExpiry(html)

  const match = html.match(/src="([^"]*resources\/photos\/[^"]+)"/i)
  return match ? match[1] : null
}

// Campus coordinates. Kept as the default so existing behaviour is unchanged,
// but overridable via ATTENDANCE_LATITUDE / ATTENDANCE_LONGITUDE so the value
// is a deployment decision rather than a hard-coded constant in a route.
const DEFAULT_LATITUDE = 16.464478869582308
const DEFAULT_LONGITUDE = 80.50074625327288

const coord = (value, fallback) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const markAttendance = async (client, { acode, latitude, longitude } = {}) => {
  // Guard against String(undefined) === 'undefined' reaching SRM when the env
  // vars are unset.
  const lat = coord(latitude, coord(process.env.ATTENDANCE_LATITUDE, DEFAULT_LATITUDE))
  const lon = coord(longitude, coord(process.env.ATTENDANCE_LONGITUDE, DEFAULT_LONGITUDE))

  const form = new URLSearchParams()
  form.append('ids', '1')
  form.append('acode', acode)
  form.append('dynamiclatdata', String(lat))
  form.append('dynamiclonxdata', String(lon))

  const response = await client.post(ATTENDANCE_URL, form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    }
  })

  if (typeof response.data === 'string') checkSessionExpiry(response.data)

  return response.data
}

// FIX: takes the session, not just the client, so the scraped studentId is
// remembered. /api/att used to re-download the whole dashboard page on every
// poll just to read one hidden input.
export const fetchId = async (session) => {
  const client = session.client ?? session

  if (session.studentId) return session.studentId

  const response = await client.post(DASHBOARD_URL)
  const html = typeof response.data === 'string' ? response.data : ''
  checkSessionExpiry(html)

  const studentId = cheerio.load(html)('#studentId').attr('value')
  if (studentId && session.client) session.studentId = studentId

  return studentId
}

export const fetchAtt = async (client, id) => {
  const form = new URLSearchParams()
  form.append('ids', '33')
  form.append('studId', id)

  const response = await client.post(TODAY_ATTENDANCE_URL, form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html, */*; q=0.01'
    }
  })

  checkSessionExpiry(response.data)
  return response.data
}

export const fetchReport = async (client, ids) => {
  const form = new URLSearchParams()
  form.append('ids', ids)

  const response = await client.post(REPORT_URL, form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html, */*; q=0.01'
    }
  })

  checkSessionExpiry(response.data)
  return response.data
}

// FIX: only one redirect hop was followed. SRM chains Location headers on
// some login paths, which showed up as a random "invalid credentials".
export const submitLogin = async (client, { username, password, captchaCode }) => {
  const form = new URLSearchParams()
  form.append('ccode', captchaCode)
  form.append('txtUserName', username)
  form.append('txtAuthKey', password)

  let response = await client.post(LOGIN_URL, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  })

  let currentUrl = LOGIN_URL
  let hops = 0

  while (response.status >= 300 && response.status < 400 && response.headers.location && hops < 5) {
    currentUrl = new URL(response.headers.location, currentUrl).href
    response = await client.get(currentUrl)
    hops += 1
  }

  const finalHtml = typeof response.data === 'string' ? response.data : ''
  const success = response.status >= 200 && response.status < 300 && isLoginSuccessful(finalHtml)

  return { success, status: response.status }
}
