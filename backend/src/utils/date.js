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

/** بداية ونهاية نطاق أيام تقويم محلي [start, endExclusive) — لاستعلامات receivedAt */
export function localDayRangeBounds(fromYmd, toYmd) {
  const from = String(fromYmd || '').trim()
  const to = String(toYmd || '').trim()
  if (!isValidYmd(from) || !isValidYmd(to)) return null
  const [fy, fm, fd] = from.split('-').map((x) => parseInt(x, 10))
  const [ty, tm, td] = to.split('-').map((x) => parseInt(x, 10))
  const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
  const endExclusive = new Date(ty, tm - 1, td, 0, 0, 0, 0)
  endExclusive.setDate(endExclusive.getDate() + 1)
  if (start > endExclusive) return null
  return { start, endExclusive }
}
