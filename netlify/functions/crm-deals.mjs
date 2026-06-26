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
  const hasId = id && id !== 'deals'
  const method = event.httpMethod

  if (method === 'GET' && !hasId) {
    const q = event.queryStringParameters || {}
    const filters = []
    if (q.stage)      filters.push('stage=eq.' + encodeURIComponent(q.stage))
    if (q.contact_id) filters.push('contact_id=eq.' + encodeURIComponent(q.contact_id))
    if (q.company_id) filters.push('company_id=eq.' + encodeURIComponent(q.company_id))
    const select = 'select=id,title,stage,value,currency,contact_id,company_id,close_date,notes,created_at&order=created_at.desc&limit=200'
    const qs = filters.length ? select + '&' + filters.join('&') : select
    const r = await sbReq('GET', 'deals?' + qs)
    return respond(r.status, r.data)
  }

  if (method === 'GET' && hasId) {
    const r = await sbReq('GET', 'deals?id=eq.' + id + '&select=*')
    if (!r.ok) return respond(r.status, r.data)
    const deal = r.data?.[0]
    if (!deal) return respond(404, { error: 'Not found' })
    return respond(200, deal)
  }

  if (method === 'PUT' && hasId) {
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return respond(400, { error: 'Invalid JSON' }) }
    const { id: _id, created_at, ...updates } = body
    const r = await sbReq('PATCH', 'deals?id=eq.' + id, updates)
    if (!r.ok) return respond(r.status, r.data)
    return respond(200, r.data?.[0] || { ok: true })
  }

  return respond(405, { error: 'Method not allowed' })
}
