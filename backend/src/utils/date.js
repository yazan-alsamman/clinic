/** Calendar business date in local server TZ (YYYY-MM-DD) */
export function todayBusinessDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** YYYY-MM-DD + عدد الأيام (تقويم محلي) */
export function addCalendarDaysYmd(ymd, deltaDays) {
  if (!YMD_RE.test(String(ymd || ''))) return todayBusinessDate()
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10))
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + deltaDays)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function isValidYmd(s) {
  return YMD_RE.test(String(s || '').trim())
}
