// Headers for calling Supabase with a server key.
// New-style keys (sb_secret_..., sb_publishable_...) are NOT JWTs and go in the "apikey" header only.
// Old-style keys (eyJ... JWTs, the legacy service_role / anon) keep working as before: apikey plus Authorization: Bearer.
export function supabaseHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra }
  if (typeof key === 'string' && !key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`
  return headers
}
