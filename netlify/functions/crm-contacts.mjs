const SB_URL = 'https://hifvkyqkqhwzcmuuihyd.supabase.co'

function getKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY }

function auth(event) {
  const header = (event.headers || {})['authorization'] || ''
  const secret = process.env.CRM_API_SECRET
  if (!secret) return false
  return header === 'Bearer ' + secret
}

async function sbReq(method, path, body) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: getKey(),
      Authorization: 'Bearer ' + getKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }
}

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export async function handler(event) {
  if (!auth(event)) return respond(401, { error: 'Unauthorized' })
  const parts = (event.path || '').split('/').filter(Boolean)
  const id = parts[parts.length - 1]
  const hasId = id && id !== 'contacts'
  const method = event.httpMethod

  if (method === 'GET' && !hasId) {
    const q = event.queryStringParameters || {}
    const filters = []
    if (q.name)    filters.push('name=ilike.*' + encodeURIComponent(q.name) + '*')
    if (q.company) filters.push('company_name=ilike.*' + encodeURIComponent(q.company) + '*')
    if (q.source)  filters.push('source=eq.' + encodeURIComponent(q.source))
    const select = 'select=id,name,first_name,last_name,email,whatsapp,linkedin,job_title,company_name,company_id,location,source,service_tagged,score_notes,follow_up_date,follow_up_note&order=name.asc&limit=200'
    const qs = filters.length ? select + '&' + filters.join('&') : select
    const r = await sbReq('GET', 'contacts?' + qs)
    return respond(r.status, r.data)
  }

  if (method === 'GET' && hasId) {
    const [cr, ar] = await Promise.all([
      sbReq('GET', 'contacts?id=eq.' + id + '&select=*'),
      sbReq('GET', 'activities?contact_id=eq.' + id + '&select=id,type,body,activity_at&order=activity_at.desc&limit=50'),
    ])
    if (!cr.ok) return respond(cr.status, cr.data)
    const contact = cr.data?.[0]
    if (!contact) return respond(404, { error: 'Not found' })
    contact.activities = ar.data || []
    return respond(200, contact)
  }

  if (method === 'PUT' && hasId) {
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return respond(400, { error: 'Invalid JSON' }) }
    const { id: _id, created_at, ...updates } = body
    const r = await sbReq('PATCH', 'contacts?id=eq.' + id, updates)
    if (!r.ok) return respond(r.status, r.data)
    return respond(200, r.data?.[0] || { ok: true })
  }

  return respond(405, { error: 'Method not allowed' })
}
