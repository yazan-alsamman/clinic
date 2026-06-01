/** تطبيع HH:mm */
export function normalizeHm(str) {
  const s = String(str || '').trim()
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function hmToMinutes(hhmm) {
  const n = normalizeHm(hhmm)
  if (!n) return null
  const [h, min] = n.split(':').map((x) => parseInt(x, 10))
  return h * 60 + min
}

/** نهاية شبكة الحجز — 12 ليلاً */
export const APPOINTMENT_GRID_END_MIN = 24 * 60

/** دقائق منذ منتصف الليل → HH:mm (نهاية اليوم عند 12 ليلاً تُخزَّن 00:00) */
export function minutesToHm(totalMin) {
  const m = Math.max(0, Math.floor(Number(totalMin) || 0))
  if (m >= APPOINTMENT_GRID_END_MIN) return '00:00'
  const capped = Math.min(m, 23 * 60 + 59)
  const h = Math.floor(capped / 60)
  const min = capped % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** فاصل [start,end) بالدقائق؛ بدون endTime صالح نفترض 30 دقيقة (بيانات قديمة) */
export function slotIntervalMinutes(doc) {
  const s = hmToMinutes(doc.time)
  if (s == null) return null
  let e = doc.endTime ? hmToMinutes(doc.endTime) : null
  if (e == null) e = s + 30
  else if (e <= s) e += APPOINTMENT_GRID_END_MIN
  return { start: s, end: e }
}

/**
 * تداخل فترتين بنمط [بداية، نهاية) بالدقائق.
 * موعد ينتهي 11:00 وآخر يبدأ 11:00 لا يُعتبر تعارضاً (لا تداخل زمني فعلي).
 */
export function intervalsOverlapHalfOpen(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}
