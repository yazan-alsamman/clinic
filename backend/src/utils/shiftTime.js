/**
 * دقائق من منتصف الليل بتوقيت دمشق — لتحديد الوردية الصباحية/المسائية بغض النظر عن توقيت السيرفر.
 */
export function wallMinutesAsiaDamascus(dateVal) {
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Damascus',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  let hour = 0
  let minute = 0
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10)
    if (p.type === 'minute') minute = parseInt(p.value, 10)
  }
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}
