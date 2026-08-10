import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role client (server-only, bypasses RLS). Lazy so env is read at call time.
let _db: SupabaseClient | null = null
export function db(): SupabaseClient {
  if (_db) return _db
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  _db = createClient(url, key, { auth: { persistSession: false } })
  return _db
}
