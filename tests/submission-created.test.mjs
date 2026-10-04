import assert from 'node:assert/strict'
// Run: node tests/submission-created.test.mjs  (uses a fake database; never touches the live one)
import { buildApplication, processApplication, makeDb, handler } from '../netlify/functions/submission-created.mjs'

const mk = (form, data, extra={}) => ({ payload: { form_name: form, created_at: '2026-10-04T09:00:00Z', data: { 'form-name': form, name: 'Jane Q Public', email: 'Jane@Example.com', phone: '07700 900123', ...data }, ...extra } })
const bo = (plan, more={}) => mk('application-business-owner', { company: 'Acme Ltd', 'company-status': 'Established — 5–10 years', plan, situation: 'Sell within 12 months', ...more })

// in-memory fake database
function fakeDb(contacts = []) {
  const s = { contacts: [...contacts], steps: [], logs: [], acts: [], calls: 0 }
  return { s, db: {
    async findContactByEmail(e) { s.calls++; return s.contacts.find(c => c.email.toLowerCase() === e.toLowerCase()) || null },
    async insertContact(r) { s.calls++; const c = { id: 'c' + (s.contacts.length + 1), ...r }; s.contacts.push(c); return c },
    async setProcessIfEmpty(id, p) { const c = s.contacts.find(c => c.id === id); if (c.process) return false; c.process = p; return true },
    async stepAlreadyTicked(id, p, st) { return s.steps.some(x => x.record_id === id && x.process === p && x.step === st && x.ticked) },
    async upsertStep(r) { s.steps.push(r) },
    async insertStepLog(r) { s.logs.push(r) },
    async insertActivity(r) { s.acts.push(r) },
  } }
}
const run = async (sub, db) => { const a = buildApplication(sub.payload); assert.ok(!a.skip && !a.invalid, JSON.stringify(a)); return { a, r: await processApplication(a, db, '2026-10-04T09:00:00.000Z') } }
let n = 0; const ok = (m) => console.log('PASS', ++n, m)

// ---- mapping
for (const [plan, proc] of [['Selling the whole company','Selling a business'],['Selling a controlling stake','Selling a business'],['Preparing for a future sale','Selling a business'],['Buying a business','Buying a business'],['Raising development capital (referred to authorised partners)','Property']]) {
  const { s, db } = fakeDb(); const { a } = await run(bo(plan), db)
  assert.equal(a.contact.process, proc); assert.equal(s.steps.length, 1); assert.equal(s.steps[0].ticked_by, 'website'); assert.equal(s.steps[0].step, '1'); assert.equal(s.logs[0].action, 'ticked')
  assert.equal(a.contact.source, 'Website'); assert.ok(!('company_name' in a.contact)); assert.match(a.contact.background, /Company name: Acme Ltd/)
  assert.equal(a.contact.first_name, 'Jane'); assert.equal(a.contact.last_name, 'Q Public'); assert.equal(s.acts[0].subject, 'Applied via website: application-business-owner')
  ok(`business owner "${plan}" -> ${proc}, step 1 ticked`)
}
{ const { s, db } = fakeDb(); const { a } = await run(bo('Other'), db)
  assert.ok(!('process' in a.contact)); assert.equal(s.steps.length, 0); assert.ok(a.contact.background.startsWith('REVIEW: no process matched')); ok('Other -> no process, REVIEW first, no tick') }
for (const [form, data, proc, role] of [
  ['application-investor', { organisation: 'Big Fund', 'buyer-type': 'Family office', sectors: 'Software', 'deal-size': '£5m', location: 'London', 'controlling-stake': 'Yes', criteria: 'x' }, 'Buying a business'],
  ['application-property', { company: 'Dev Co', role: 'Developer', 'opportunity-type': 'Development site', capital: '£2m', description: 'A site' }, 'Property'],
  ['application-introducer', { company: 'Firm LLP', profession: 'Accountant', country: 'UK', 'introduction-type': 'Businesses', network: 'Many' }, 'Introducer', 'Introducer'],
]) { const { s, db } = fakeDb(); const { a } = await run(mk(form, data), db)
  assert.equal(a.contact.process, proc); assert.equal(a.contact.role_type, role); assert.ok(!('company_name' in a.contact)); assert.equal(s.steps.length, 1)
  const all = a.contact.background + '\n' + ''; for (const v of Object.values(data)) assert.ok(all.includes(v), 'lost: ' + v)
  ok(`${form} -> ${proc}${role ? ', role_type ' + role : ''}, every answer kept`) }

// ---- ignore / validation
assert.ok(buildApplication(mk('contact-us', {}).payload).skip); ok('non-application form ignored')
assert.ok(buildApplication(bo('Other', { 'bot-field': 'gotcha' }).payload).invalid); ok('honeypot stops')
assert.ok(buildApplication(mk('application-property', { email: 'not-an-email' }).payload).invalid); ok('bad email stops')
assert.ok(buildApplication(mk('application-property', { name: '   ' }).payload).invalid); ok('empty name stops')
assert.ok(buildApplication(mk('application-property', { name: 'x'.repeat(201) }).payload).invalid); ok('201-char name stops')
assert.ok(!buildApplication(mk('application-property', { name: 'x'.repeat(200), description: 'y'.repeat(5000) }).payload).invalid); ok('200-char name and 5000-char text allowed')
assert.ok(buildApplication(mk('application-property', { description: 'y'.repeat(5001) }).payload).invalid); ok('5001-char text stops')
{ const a = buildApplication(mk('application-property', { name: '<b>Jo</b> <script>alert(1)</script>Smith', description: '<img src=x onerror=1>Hello' }).payload)
  assert.ok(!/[<>]/.test(a.contact.name + a.contact.background)); assert.match(a.contact.background, /Hello/); ok('HTML tags stripped: ' + JSON.stringify(a.contact.name)) }

// ---- duplicates
{ const { s, db } = fakeDb([{ id: 'c1', email: 'jane@example.com', name: 'Old Name', process: null, phone: 'KEEP' }])
  const { r } = await run(bo('Selling the whole company'), db)
  assert.equal(r.action, 'duplicate-noted'); assert.equal(s.contacts.length, 1); assert.equal(s.contacts[0].name, 'Old Name'); assert.equal(s.contacts[0].phone, 'KEEP')
  assert.equal(s.contacts[0].process, 'Selling a business'); assert.equal(s.steps.length, 1); assert.match(s.acts[0].subject, /^Applied again via website/); assert.match(s.acts[0].body, /Sell within 12 months/)
  ok('duplicate (case-insensitive), no process yet -> process set, step 1 ticked, nothing overwritten, note added') }
{ const { s, db } = fakeDb([{ id: 'c1', email: 'JANE@example.com', name: 'Old', process: 'Property' }])
  const { r } = await run(bo('Selling the whole company'), db)
  assert.equal(s.contacts.length, 1); assert.equal(s.contacts[0].process, 'Property'); assert.equal(s.steps.length, 0); assert.match(s.acts[0].body, /already has the process Property/)
  ok('duplicate with a different process -> process kept, said in the note') }
{ const { s, db } = fakeDb([{ id: 'c1', email: 'jane@example.com', name: 'Old', process: null }])
  await run(bo('Other'), db); assert.equal(s.contacts[0].process, null); assert.equal(s.steps.length, 0); assert.equal(s.acts.length, 1); ok('duplicate + form gives no process -> only a note') }

// ---- handler safety (CONTEXT is NOT visible to functions on Netlify, so the real production case has it undefined)
const evt = (sub) => ({ body: JSON.stringify(sub) })
{ const orig = globalThis.fetch; let called = 0; let urls = []
  globalThis.fetch = async (u, o) => { called++; urls.push(o.method + ' ' + u.split('/rest/v1/')[1].split('?')[0]); return { ok: true, status: 200, text: async () => (o.method === 'GET' ? '[]' : '[{"id":"new1"}]') } }
  const quiet = console.log; 
  // production reality: CONTEXT undefined, key present -> WRITES
  delete process.env.CONTEXT; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  let out = await handler(evt(bo('Selling the whole company'))); assert.equal(out.body, 'ok'); assert.ok(called >= 5, 'expected writes, got ' + called); console.log('   calls made:', urls.join(' | ')); ok('production as Netlify really runs it (no CONTEXT, key set): WRITES')
  // previews: key absent -> nothing
  called = 0; urls = []; delete process.env.SUPABASE_SERVICE_ROLE_KEY
  out = await handler(evt(bo('Selling the whole company'))); assert.equal(out.body, 'no key'); assert.equal(called, 0); ok('no key (previews/branch deploys): nothing written, finishes normally')
  // belt and braces: key present but CONTEXT visible and not production -> nothing
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  for (const ctx of ['deploy-preview', 'branch-deploy', 'dev']) { process.env.CONTEXT = ctx; out = await handler(evt(bo('Selling the whole company'))); assert.equal(out.body, 'dry run') }
  assert.equal(called, 0); ok('key present but CONTEXT says preview/branch/dev: nothing written')
  process.env.CONTEXT = 'production'; out = await handler(evt(bo('Selling the whole company'))); assert.equal(out.body, 'ok'); ok('CONTEXT=production with key: writes')
  // errors never escape
  delete process.env.CONTEXT; globalThis.fetch = async () => { throw new Error('db down') }
  out = await handler(evt(bo('Selling the whole company'))); assert.equal(out.statusCode, 200); assert.equal(out.body, 'error logged'); ok('database fails: error logged, still 200')
  out = await handler({ body: 'not json' }); assert.equal(out.statusCode, 200); ok('garbage body: 200')
  globalThis.fetch = orig }


// ---- KNOWN LIVE COLUMNS GUARD: the function may only send columns that exist in the live CRM database.
// Sources: the CRM app's own contact saves (ContactDetail / Contacts pages), supabase/migrations in the CRM repo,
// and the process_steps / process_step_log tables created from add_process_steps_and_advisers.sql.
// contacts.aims_objectives is NOT here: panel_a_to_companies.sql dropped it (a live test failed with PGRST204).
const KNOWN = {
  contacts: ['id','created_at','name','first_name','last_name','email','phone','whatsapp','linkedin','twitter','source','job_title','location',
    'company_id','company_name','service_tagged','referred_by','role_type','is_decision_maker','background','personal_notes','score_notes',
    'follow_up_date','follow_up_note','relationship_type','process','reference_number'],
  process_steps: ['id','record_type','record_id','process','step','ticked','ticked_at','ticked_by','note','created_at'],
  process_step_log: ['id','record_type','record_id','process','step','action','done_at','done_by'],
  activities: ['id','created_at','contact_id','company_id','deal_id','type','direction','subject','body','activity_at','fingerprint','status','due_date'],
}
// this function must never set these on contacts (a database rule turns company_name into a real company)
const NEVER_SET = { contacts: ['company_name'] }
function checkCols(table, cols, where) {
  for (const c of cols) {
    assert.ok(KNOWN[table], 'unknown table ' + table)
    assert.ok(KNOWN[table].includes(c), `column "${c}" is not a known live column of ${table} (${where})`)
    assert.ok(!(NEVER_SET[table] || []).includes(c), `"${c}" must never be set on ${table}`)
  }
}
{ const seen = []
  const fake = async (url, o) => { seen.push({ url, method: o.method, body: o.body ? JSON.parse(o.body) : null })
    return { ok: true, status: 200, text: async () => (o.method === 'GET' ? '[]' : '[{"id":"new1"}]') } }
  const real = makeDb('KEY', fake)
  const forms = [
    bo('Selling the whole company'), bo('Other'),
    mk('application-investor', { organisation: 'F', 'buyer-type': 'x', sectors: 's', 'deal-size': 'd', location: 'l', 'controlling-stake': 'Yes', criteria: 'c' }),
    mk('application-property', { company: 'D', role: 'r', 'opportunity-type': 'o', capital: '1', description: 'd' }),
    mk('application-introducer', { company: 'F', profession: 'p', country: 'c', 'introduction-type': 'i', network: 'n' }),
  ]
  for (const sub of forms) { const a = buildApplication(sub.payload); await processApplication(a, real, '2026-10-04T09:00:00.000Z') }
  // duplicate path too
  const dupDb = { ...real, async findContactByEmail() { return { id: 'c9', email: 'x@y.z', process: null } } }
  await processApplication(buildApplication(forms[0].payload), dupDb, '2026-10-04T09:00:00.000Z')
  const READ_PARAMS = new Set(['select', 'order', 'limit', 'on_conflict', 'or'])
  const colsOfQuery = (qs) => { const cols = []
    for (const [k, v] of new URLSearchParams(qs)) {
      if (k === 'select') cols.push(...v.split(',').filter(x => x !== '*'))
      else if (k === 'order') cols.push(v.split('.')[0])
      else if (k === 'on_conflict') cols.push(...v.split(','))
      else if (k === 'or') cols.push(...v.replace(/[()]/g, '').split(',').map(x => x.split('.')[0]))
      else if (!READ_PARAMS.has(k)) cols.push(k) }
    return cols }
  for (const r of seen) {
    const [path, qs = ''] = r.url.split('/rest/v1/')[1].split('?')
    checkCols(path, colsOfQuery(qs), r.method + ' ' + path)
    if (r.body) checkCols(path, Object.keys(r.body), 'body of ' + r.method + ' ' + path)
  }
  ok(`column guard: ${seen.length} database requests, every column is a known live column, company_name never set`)
  // and the guard really bites
  assert.throws(() => checkCols('contacts', ['aims_objectives'], 'self-test'), /not a known live column/); ok('column guard fails on aims_objectives (self-test)')
}

// ---- KEY STYLES: new-style sb_ keys go in the apikey header only; old-style (eyJ...) keys keep apikey + Bearer
{ const NEW = 'sb_secret_TESTONLY1234567890', OLD = 'eyJhbGciOiJIUzI1NiJ9.TESTONLY.sig'
  for (const [key, expectBearer] of [[NEW, false], [OLD, true]]) {
    const seen = []
    const fake = async (url, o) => { seen.push(o.headers); return { ok: true, status: 200, text: async () => '[]' } }
    await makeDb(key, fake).findContactByEmail('a@b.co')
    assert.equal(seen[0].apikey, key); assert.equal('Authorization' in seen[0], expectBearer)
    if (expectBearer) assert.equal(seen[0].Authorization, 'Bearer ' + key)
  }
  ok('submission-created: new key -> apikey only; old key -> apikey + Bearer')
  for (const fnFile of ['crm-contacts', 'crm-companies', 'crm-deals']) {
    for (const [key, expectBearer] of [[NEW, false], [OLD, true]]) {
      const seen = []; const real = globalThis.fetch
      globalThis.fetch = async (u, o) => { seen.push(o.headers); return { ok: true, status: 200, text: async () => '[]' } }
      process.env.SUPABASE_SERVICE_ROLE_KEY = key; process.env.CRM_API_SECRET = 'sec'
      try { const m = await import(`../netlify/functions/${fnFile}.mjs?k=${key}`); await m.handler({ httpMethod: 'GET', path: '/api/crm/x', headers: { authorization: 'Bearer sec' }, queryStringParameters: {} }) }
      finally { globalThis.fetch = real }
      assert.ok(seen.length && seen.every(h => h.apikey === key && ('Authorization' in h) === expectBearer), fnFile + ' ' + key.slice(0, 4))
    }
  }
  ok('crm-contacts / crm-companies / crm-deals: new key -> apikey only; old key -> apikey + Bearer')
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.CRM_API_SECRET
}

// ---- REST shapes (fake fetch, no network)
{ const seen = []; const fake = async (url, o) => { seen.push({ url, method: o.method, body: o.body }); return { ok: true, status: 200, text: async () => (o.method === 'GET' ? '[]' : '[{"id":"new1"}]') } }
  const db = makeDb('KEY', fake); await db.findContactByEmail('a_b@x.com'); await db.insertContact({ name: 'n' }); await db.upsertStep({ a: 1 }); await db.setProcessIfEmpty('u1', 'Property')
  console.log(seen.map(s => s.method + ' ' + decodeURIComponent(s.url).replace('https://hifvkyqkqhwzcmuuihyd.supabase.co/rest/v1/', '')).join('\n')); ok('REST requests built') }
console.log('\nALL', n, 'CHECKS PASSED (no live database touched)')
