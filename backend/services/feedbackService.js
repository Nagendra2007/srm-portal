import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'
import { checkSessionExpiry } from './srmPortalService.js'

/* --------------------------------------------------------------------------
   SUBJECT-WISE FEEDBACK
   Ported from the Srmap-Api project (feedbackSubjects.ts / feedbackSubmit.ts /
   feedbackComments.ts) into SRMSync's Express + cookie-jar client style.

   The SRM feedback flow is three steps, all on the student's own session:
     1. POST subjectwisefeedback.jsp (ids=9)        -> list of subjects
     2. POST ...feedbackresources.jsp (ids=1,...)   -> the form for a subject
     3. POST ...feedbackresources.jsp (ids=2,...)   -> submit answers
   -------------------------------------------------------------------------- */

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SRM_BASE_URL = 'https://student.srmap.edu.in/srmapstudentcorner/'
const FEEDBACK_PAGE_URL = `${SRM_BASE_URL}students/transaction/subjectwisefeedback.jsp`
const FEEDBACK_FORM_URL = `${SRM_BASE_URL}students/transaction/subjectwisefeedbackresources.jsp`

const URLENCODED = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }

// 1..5 maps to these SRM answer options (index 0 = strongly disagree).
const ANSWER_OPTIONS = [
  { value: '21', label: 'Strongly disagree', pointvalue: '1.00' },
  { value: '22', label: 'Somewhat disagree', pointvalue: '2.00' },
  { value: '23', label: 'Neutral', pointvalue: '3.00' },
  { value: '24', label: 'Somewhat agree', pointvalue: '4.00' },
  { value: '25', label: 'Strongly agree', pointvalue: '5.00' }
]

// Loaded once at startup. Falls back to a single safe comment if the file is
// missing, so a bad deploy can never make getRandomComment throw.
let COMMENTS = ['Good teaching and support throughout the course.']
try {
  const raw = fs.readFileSync(path.join(__dirname, '../data/feedbackComments.json'), 'utf-8')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed) && parsed.length > 0) COMMENTS = parsed
} catch (err) {
  console.warn('[feedback] could not load feedbackComments.json:', err.message)
}

export const getRandomComment = () => COMMENTS[Math.floor(Math.random() * COMMENTS.length)]

export const isValidComment = (value) => {
  const length = (value || '').trim().length
  if (length <= 10) return [false, 'Comment must be more than 10 characters']
  if (length > 500) return [false, 'Comment must be less than 500 characters']
  return [true, null]
}

export const fetchFeedbackSubjects = async (client) => {
  const response = await client.post(FEEDBACK_PAGE_URL, 'ids=9', { headers: URLENCODED })
  if (typeof response.data === 'string') checkSessionExpiry(response.data)

  const $ = cheerio.load(response.data)
  const subjects = []

  $('td.clsSubject').each((_, elem) => {
    const id = $(elem).attr('id')
    if (!id) return

    // The faculty name sits in a <font> inside the cell; the rest is the
    // subject name. Clone, pull the font out, and what's left is the name.
    const tdClone = $(elem).clone()
    const faculty = tdClone.find('font').text().trim()
    tdClone.find('font').remove()
    const name = tdClone.text().replace(/\s+/g, ' ').trim()

    subjects.push({ id, name: name || id, faculty })
  })

  const feedbackType = $('#feedbacktype').val() ?? ''
  const mcontrollerValue = $('#mcontroller').val() || ''

  return { subjects, feedbackType, mcontrollerValue }
}

// Submits one subject's form. Returns { subjectId, success }.
const submitOneSubject = async (client, subjectId, { comment, option, feedbackType, mcontrollerValue }) => {
  const formData = new URLSearchParams()
  formData.append('ids', '1')
  formData.append('filter', subjectId)
  formData.append('controller', mcontrollerValue)

  const formResponse = await client.post(FEEDBACK_FORM_URL, formData.toString(), { headers: URLENCODED })
  if (formResponse.status !== 200) return { subjectId, success: false }

  const $ = cheerio.load(formResponse.data)
  const hdnControllerId = $('#hdnControllerId').val() || ''
  const txtRemarks = $('#txtRemarks').val() || ''

  // Rating questions: pick the radio whose answervalue matches the option.
  const answersJson = []
  $('tr.clsquestions').slice(0, 20).each((_, question) => {
    const questionElem = $(question)
    const questionId = questionElem.attr('id')?.replace(/_\d+$/, '')
    if (!questionId) return

    const answerInputs = questionElem.find('input.answers')
    if (answerInputs.length === 0) return

    const selected = answerInputs
      .filter((_, el) => $(el).attr('answervalue') === option.value)
      .first()
    if (selected.length === 0) return

    answersJson.push({
      questionid: questionId,
      answerid: selected.attr('id') || '',
      answerdesc: option.label.replace(' ', '+'),
      quesid: selected.attr('quesid') || questionId,
      partid: selected.attr('partid') || '',
      answervalue: option.value,
      pointvalue: option.pointvalue
    })
  })

  // Descriptive questions: the free-text comment goes into each textarea.
  const descriptiveJson = []
  $('tr.clsquestions')
    .filter((_, el) => $(el).find('textarea').length > 0)
    .slice(0, 5)
    .each((_, el) => {
      const questionElem = $(el)
      const questionId = questionElem.attr('itemid')?.replace(/_\d+$/, '')
      const textarea = questionElem.find('textarea')
      const quesid = textarea.attr('quesid')
      if (!questionId || !quesid) return

      descriptiveJson.push({
        questionid: questionId,
        answerdesc: comment.replace(' ', '+'),
        quesid,
        partid: textarea.attr('partid') || '6'
      })
    })

  const params = new URLSearchParams({
    txtRemarks: String(txtRemarks),
    hdnSubjectId: subjectId,
    hdnControllerId: String(hdnControllerId),
    ids: '2',
    filter: '',
    answers: JSON.stringify(answersJson),
    descriptiveanswer: JSON.stringify(descriptiveJson),
    remarks: String(txtRemarks),
    feedbacktype: String(feedbackType)
  })

  const submitResponse = await client.post(FEEDBACK_FORM_URL, params.toString(), { headers: URLENCODED })

  try {
    const data = typeof submitResponse.data === 'string'
      ? JSON.parse(submitResponse.data)
      : submitResponse.data
    return { subjectId, success: data.result === 'Feedback Completed' }
  } catch {
    return { subjectId, success: submitResponse.status === 200 }
  }
}

export const submitFeedback = async (client, { comment, optionNo = 5, selectedSubjectIds } = {}) => {
  const option = Number(optionNo)
  if (!Number.isInteger(option) || option < 1 || option > ANSWER_OPTIONS.length) {
    return { success: false, message: 'Answer option number should be between 1-5 only!' }
  }

  const [isValid, message] = isValidComment(comment)
  if (!isValid) return { success: false, message }

  const { subjects, feedbackType, mcontrollerValue } = await fetchFeedbackSubjects(client)

  let subjectIds = subjects.map((s) => s.id)
  if (selectedSubjectIds && selectedSubjectIds.length > 0) {
    subjectIds = subjectIds.filter((id) => selectedSubjectIds.includes(id))
  }

  if (subjectIds.length === 0) {
    return { success: false, message: 'No subjects found, your feedback may have been already submitted!' }
  }

  // Serial on purpose: SRMSync's client already serialises requests per
  // session (JSP cookie collisions otherwise), so Promise.all would gain
  // nothing and only muddy error handling.
  const selectedOption = ANSWER_OPTIONS[option - 1]
  const results = []
  for (const subjectId of subjectIds) {
    results.push(await submitOneSubject(client, subjectId, {
      comment,
      option: selectedOption,
      feedbackType,
      mcontrollerValue
    }))
  }

  const successCount = results.filter((r) => r.success).length

  return {
    success: successCount > 0,
    message: successCount > 0
      ? `Feedback submitted for ${successCount} of ${results.length} subject${results.length === 1 ? '' : 's'}`
      : 'Feedback submission failed',
    processedSubjects: results.length,
    successCount,
    perSubject: results
  }
}
