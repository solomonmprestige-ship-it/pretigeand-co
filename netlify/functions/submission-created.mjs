// Runs automatically after each Netlify Forms submission (Netlify's own spam filter has already run).
// For application forms it creates a contact in the CRM (Supabase), using only tables and columns that already exist.
// Netlify Forms keeps the full submission and emails the alias whatever happens here, so this function never throws.
//
// Needs the site environment variable SUPABASE_SERVICE_ROLE_KEY (server only; never in the browser or the repo).
// Writes only where the service key exists (Production only) and CONTEXT, if visible, is 'production';
// otherwise it just logs what it would have created.

const SB_URL = 'https://hifvkyqkqhwzcmuuihyd.supabase.co'
const MAX_TEXT = 5000
const MAX_NAME = 200

// Per form: the process to set, and where each answer goes.
// 'profile' and 'goals' answers are both written, labelled, into contacts.background (the notes column the CRM uses on contacts;
// contacts.aims_objectives no longer exists in the live database).
const FORMS = {
  'application-business-owner': {
    label: 'Business owner',
    fields: [
      ['company', 'Company name', 'profile'],
      ['company-status', 'Company status', 'profile'],
      ['service', 'Service (from link)', 'profile'],
      ['plan', 'What are you planning?', 'goals'],
      ['situation', 'Goals and timescale', 'goals'],
    ],
  },
  'application-investor': {
    label: 'Investor',
    process: 'Buying a business',
    fields: [
      ['organisation', 'Organisation', 'profile'],
      ['buyer-type', 'Type of buyer', 'profile'],
      ['location', 'Location', 'profile'],
      ['controlling-stake', 'Confirmed seeking a controlling stake (50% or more)', 'profile'],
      ['sectors', 'Sectors', 'goals'],
      ['deal-size', 'Deal size', 'goals'],
      ['criteria', 'Anything else about what they are looking for', 'goals'],
    ],
  },
  'application-property': {
    label: 'Property',
    process: 'Property',
    fields: [
      ['company', 'Company name', 'profile'],
      ['role', 'Role', 'profile'],
      ['opportunity-type', 'Type of opportunity', 'profile'],
      ['capital', 'Asset or site value', 'goals'],
      ['description', 'Brief description', 'goals'],
    ],
  },
  'application-introducer': {
    label: 'Introducer',
    process: 'Introducer',
    roleType: 'Introducer',
    fields: [
      ['company', 'Company or firm name', 'profile'],
      ['profession', 'Profession', 'profile'],
      ['country', 'Country or market', 'profile'],
      ['introduction-type', 'What they would introduce', 'goals'],
      ['network', 'Network and introductions in mind', 'goals'],
    ],
  },
}

// Business owner form: process comes from "What are you planning?"
const PLAN_TO_PROCESS = {
  'Selling the whole company': 'Selling a business',
  'Selling a controlling stake': 'Selling a business',
  'Preparing for a future sale': 'Selling a business',
  'Buying a business': 'Buying a business',
  'Raising development capital (referred to authorised partners)': 'Property',
  'Raising development capital': 'Property',
}

// Fields that are not answers
const SKIP_KEYS = new Set(['form-name', 'bot-field', 'attachment', 'ip', 'user_agent', 'referrer'])

export function clean(value) {
  if (value === undefined || value === null) return ''
  return String(value).replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\r\n/g, '\n').trim()
}

const EMAIL_RE = /^[^\s@<>"',;:()\[\]\\]+@[^\s@<>"',;:()\[\]\\]+\.[^\s@<>"',;:()\[\]\\]+$/

// Turns a Netlify form payload into a validated application, or { skip } / { invalid }.
export function buildApplication(payload) {
  const formName = payload?.form_name || payload?.data?.['form-name'] || ''
  if (!String(formName).startsWith('application-')) return { skip: 'not an application form' }
  const data = payload.data || {}

  if (clean(data['bot-field'])) return { invalid: 'honeypot filled' }

  const form = FORMS[formName] || { label: formName.replace(/^application-/, ''), fields: [] }

  const name = clean(data.name)
  if (name.length < 1 || name.length > MAX_NAME) return { invalid: 'name must be 1 to 200 characters' }
  const email = clean(data.email)
  if (email.length > 254 || !EMAIL_RE.test(email)) return { invalid: 'email does not look like an email' }

  const answers = {}
  for (const [key, raw] of Object.entries(data)) {
    if (SKIP_KEYS.has(key) || key === 'name' || key === 'email' || key === 'phone') continue
    const v = clean(raw && typeof raw === 'object' ? JSON.stringify(raw) : raw)
    if (v.length > MAX_TEXT) return { invalid: `field "${key}" is longer than ${MAX_TEXT} characters` }
    if (v) answers[key] = v
  }

  // Process
  let process = form.process || ''
  let review = ''
  if (formName === 'application-business-owner') {
    process = PLAN_TO_PROCESS[answers.plan] || ''
    if (!process) review = 'REVIEW: no process matched'
  } else if (!process) {
    review = 'REVIEW: no process matched'
  }

  const parts = name.split(/\s+/)
  const firstName = parts[0]
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null

  const when = payload.created_at ? new Date(payload.created_at) : new Date()
  const date = (isNaN(when) ? new Date() : when).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  // Labelled notes: known fields first, in order, then any other answers so nothing is lost
  const known = new Set(form.fields.map(f => f[0]))
  const lines = { profile: [], goals: [] }
  for (const [key, label, section] of form.fields) {
    if (answers[key]) lines[section].push(`${label}: ${answers[key]}`)
  }
  for (const [key, v] of Object.entries(answers)) {
    if (!known.has(key)) lines.profile.push(`${key}: ${v}`)
  }
  const phone = clean(data.phone)
  if (phone.length > MAX_TEXT) return { invalid: 'phone is too long' }

  const header = [
    review,
    `Applied via website (${form.label} form, ${formName}) on ${date}.`,
    'Any uploaded file is kept in Netlify Forms, not in the CRM.',
  ].filter(Boolean)
  const background = [
    ...header,
    ...lines.profile,
    ...(lines.goals.length ? ['', 'Application answers:', ...lines.goals] : []),
  ].join('\n')

  return {
    formName,
    formLabel: form.label,
    date,
    process,
    review,
    email,
    answersText: [...lines.profile, ...lines.goals].join('\n'),
    contact: {
      name,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
      source: 'Website',
      ...(process ? { process } : {}),
      ...(form.roleType ? { role_type: form.roleType } : {}),
      background,
    },
  }
}

// Does the database work. `db` is an object of small functions, so tests can pass a fake one.
export async function processApplication(app, db, nowIso) {
  const existing = await db.findContactByEmail(app.email)

  if (!existing) {
    const contact = await db.insertContact(app.contact)
    if (app.process) await tickApply(db, contact.id, app.process, nowIso)
    await db.insertActivity({
      contact_id: contact.id,
      type: 'Note',
      subject: `Applied via website: ${app.formName}`,
      body: `Applied via website: ${app.formName} on ${app.date}.`,
      activity_at: nowIso,
    })
    return { action: 'created', contact_id: contact.id, process: app.process || null }
  }

  // Already known: never create a second contact and never overwrite a field
  const lines = [`Applied again via website: ${app.formName} on ${app.date}.`]
  let setProcess = null
  if (app.process) {
    if (!existing.process) {
      const changed = await db.setProcessIfEmpty(existing.id, app.process)
      if (changed) {
        await tickApply(db, existing.id, app.process, nowIso)
        setProcess = app.process
        lines.push(`Process was empty, now set to ${app.process}; step 1 (Apply) ticked.`)
      } else {
        lines.push(`This form suggests the process ${app.process}; the contact's process was set meanwhile, so it was left alone.`)
      }
    } else if (existing.process !== app.process) {
      lines.push(`This form suggests the process ${app.process}. The contact already has the process ${existing.process}, which was left as it is.`)
    }
  } else if (app.review) {
    lines.push(app.review)
  }
  lines.push('', 'New answers:', app.answersText || '(none)', '', 'Any uploaded file is kept in Netlify Forms, not in the CRM.')
  await db.insertActivity({
    contact_id: existing.id,
    type: 'Note',
    subject: `Applied again via website: ${app.formName}`,
    body: lines.join('\n'),
    activity_at: nowIso,
  })
  return { action: 'duplicate-noted', contact_id: existing.id, process_set: setProcess }
}

// Step 1 (Apply) ticked by "website", plus its history row, the same as a person ticking it in the CRM
async function tickApply(db, contactId, process, nowIso) {
  if (await db.stepAlreadyTicked(contactId, process, '1')) return
  await db.upsertStep({
    record_type: 'contact', record_id: contactId, process, step: '1',
    ticked: true, ticked_at: nowIso, ticked_by: 'website',
  })
  await db.insertStepLog({
    record_type: 'contact', record_id: contactId, process, step: '1',
    action: 'ticked', done_at: nowIso, done_by: 'website',
  })
}

// Real database access (service role key, server only)
export function makeDb(key, fetchImpl = fetch) {
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  async function req(method, path, body, prefer) {
    const res = await fetchImpl(SB_URL + '/rest/v1/' + path, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} failed: ${res.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
  const likeEscape = s => s.replace(/[\\%_*]/g, c => '\\' + c)
  return {
    async findContactByEmail(email) {
      const rows = await req('GET', `contacts?email=ilike.${encodeURIComponent(likeEscape(email))}&select=id,email,process&order=created_at.asc&limit=1`)
      return rows?.[0] || null
    },
    async insertContact(row) {
      const rows = await req('POST', 'contacts', row, 'return=representation')
      return rows[0]
    },
    async setProcessIfEmpty(id, process) {
      const rows = await req('PATCH', `contacts?id=eq.${id}&or=(process.is.null,process.eq.)`, { process }, 'return=representation')
      return !!rows?.length
    },
    async stepAlreadyTicked(id, process, step) {
      const rows = await req('GET', `process_steps?record_type=eq.contact&record_id=eq.${id}&process=eq.${encodeURIComponent(process)}&step=eq.${step}&ticked=eq.true&select=id&limit=1`)
      return !!rows?.length
    },
    async upsertStep(row) {
      await req('POST', 'process_steps?on_conflict=record_type,record_id,process,step', row, 'resolution=merge-duplicates,return=minimal')
    },
    async insertStepLog(row) {
      await req('POST', 'process_step_log', row, 'return=minimal')
    },
    async insertActivity(row) {
      // fingerprint is built the same way the CRM builds it, so the same note cannot be added twice
      const fingerprint = `${row.contact_id}-${row.activity_at}-${(row.body || '').slice(0, 50)}`
      await req('POST', 'activities', { ...row, fingerprint }, 'return=minimal')
    },
  }
}

function mask(row) {
  const out = { ...row }
  if (out.email) out.email = out.email.replace(/^(.).*(@.*)$/, '$1***$2')
  if (out.phone) out.phone = '***' + String(out.phone).slice(-2)
  return out
}

export async function handler(event) {
  try {
    const body = JSON.parse(event.body || '{}')
    const app = buildApplication(body.payload)
    if (app.skip) { console.log('[submission-created] ignored:', app.skip); return { statusCode: 200, body: 'ignored' } }
    if (app.invalid) { console.log('[submission-created] stopped:', app.invalid, '| form:', body.payload?.form_name); return { statusCode: 200, body: 'stopped' } }

    // Netlify does not pass CONTEXT to functions at runtime, so previews are kept out two ways:
    // the service key is set for Production only (so it is absent on previews), and if CONTEXT is ever
    // visible and is not 'production', nothing is written either.
    const ctx = process.env.CONTEXT
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!key || (ctx && ctx !== 'production')) {
      console.log('[submission-created] nothing written (' + (!key ? 'no service key on this deploy' : 'context ' + ctx) + '). Would have created:',
        JSON.stringify({ contact: mask(app.contact), tick_step_1: !!app.process, activity: `Applied via website: ${app.formName}` }))
      return { statusCode: 200, body: !key ? 'no key' : 'dry run' }
    }

    const result = await processApplication(app, makeDb(key), new Date().toISOString())
    console.log('[submission-created] done:', JSON.stringify(result), '| form:', app.formName)
    return { statusCode: 200, body: 'ok' }
  } catch (e) {
    // Never lose an application: Netlify Forms already holds it and has emailed the alias.
    console.error('[submission-created] error (application is safe in Netlify Forms):', e && e.message)
    return { statusCode: 200, body: 'error logged' }
  }
}
