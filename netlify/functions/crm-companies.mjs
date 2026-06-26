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
  const hasId = id && id !== 'companies'
  const method = event.httpMethod

  if (method === 'GET' && !hasId) {
    const q = event.queryStringParameters || {}
    const filters = []
    if (q.name)   filters.push('name=ilike.*' + encodeURIComponent(q.name) + '*')
    if (q.sector) filters.push('sector=ilike.*' + encodeURIComponent(q.sector) + '*')
    const select = 'select=id,name,website,email,phone,linkedin,sector,location,notes&order=name.asc&limit=200'
    const qs = filters.length ? select + '&' + filters.join('&') : select
    const r = await sbReq('GET', 'companies?' + qs)
    return respond(r.status, r.data)
  }

  if (method === 'GET' && hasId) {
    const [cr, conR] = await Promise.all([
      sbReq('GET', 'companies?id=eq.' + id + '&select=*'),
      sbReq('GET', 'contacts?company_id=eq.' + id + '&select=id,name,job_title,email,whatsapp&order=name.asc'),
    ])
    if (!cr.ok) return respond(cr.status, cr.data)
    const company = cr.data?.[0]
    if (!company) return respond(404, { error: 'Not found' })
    company.contacts = conR.data || []
    return respond(200, company)
  }

  if (method === 'PUT' && hasId) {
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return respond(400, { error: 'Invalid JSON' }) }
    const { id: _id, created_at, ...updates } = body
    const r = await sbReq('PATCH', 'companies?id=eq.' + id, updates)
    if (!r.ok) return respond(r.status, r.data)
    return respond(200, r.data?.[0] || { ok: true })
  }

  return respond(405, { error: 'Method not allowed' })
}
