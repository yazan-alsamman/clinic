const TOKEN_KEY = 'dr_elias_token'
const PATIENT_TOKEN_KEY = 'dr_elias_patient_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function getPatientToken(): string | null {
  return localStorage.getItem(PATIENT_TOKEN_KEY)
}

export function setPatientToken(token: string | null): void {
  if (token) localStorage.setItem(PATIENT_TOKEN_KEY, token)
  else localStorage.removeItem(PATIENT_TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** In production (separate static host), set VITE_API_BASE_URL to the API origin, no trailing slash. */
function resolveApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const t = getToken()
  if (t) headers.Authorization = `Bearer ${t}`

  const res = await fetch(resolveApiUrl(path), { ...init, headers })
  const text = await res.text()
  let body: { error?: string } | null = null
  try {
    body = text ? (JSON.parse(text) as { error?: string }) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const fromBody = body && typeof body.error === 'string' ? body.error.trim() : ''
    let msg = fromBody || res.statusText || 'خطأ'
    if ([502, 503, 504].includes(res.status) || /bad gateway|gateway timeout/i.test(msg)) {
      msg =
        'الخادم الخلفي غير متاح (Bad Gateway). من مجلد backend شغّل: npm run dev — المنفذ 5000 — مع إبقاء واجهة Vite تعمل.'
    }
    throw new ApiError(res.status, msg)
  }

  return (body ?? {}) as T
}

export async function patientApi<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const t = getPatientToken()
  if (t) headers.Authorization = `Bearer ${t}`

  const res = await fetch(resolveApiUrl(path), { ...init, headers })
  const text = await res.text()
  let body: { error?: string } | null = null
  try {
    body = text ? (JSON.parse(text) as { error?: string }) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const fromBody = body && typeof body.error === 'string' ? body.error.trim() : ''
    let msg = fromBody || res.statusText || 'خطأ'
    if ([502, 503, 504].includes(res.status) || /bad gateway|gateway timeout/i.test(msg)) {
      msg =
        'الخادم الخلفي غير متاح (Bad Gateway). من مجلد backend شغّل: npm run dev — المنفذ 5000 — مع إبقاء واجهة Vite تعمل.'
    }
    throw new ApiError(res.status, msg)
  }

  return (body ?? {}) as T
}
