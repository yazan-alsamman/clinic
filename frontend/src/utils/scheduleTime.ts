/** تطبيع HH:mm من حقل وقت أو نص */
export function normalizeTime(t: string): string | null {
  const s = t.trim()
  const withColon = s.includes(':') ? s : `${s}:00`
  const m = withColon.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function hmToMinutes(hhmm: string): number | null {
  const n = normalizeTime(hhmm)
  if (!n) return null
  const [h, min] = n.split(':').map((x) => parseInt(x, 10))
  return h * 60 + min
}

export function defaultEndFromStart(startNorm: string): string {
  const s = hmToMinutes(startNorm)
  if (s == null) return '10:00'
  const e = s + 30
  const h = Math.floor(e / 60)
  const m = e % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** [start,end) بالدقائق؛ بدون نهاية صالحة = +30 د */
export function slotIntervalFromRow(time: string, endTime?: string | null): { start: number; end: number } | null {
  const start = hmToMinutes(time)
  if (start == null) return null
  let end = endTime ? hmToMinutes(endTime) : null
  if (end == null || end <= start) end = start + 30
  return { start, end }
}

/** [بداية، نهاية) — انتهاء عند 11:00 وبداية التالي 11:00 لا يُعد تعارضاً */
export function intervalsOverlapHalfOpen(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}
