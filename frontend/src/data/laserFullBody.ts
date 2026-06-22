/** عرض «جسم كامل» — أسطر الجلسة عند الحجز أو إنشاء الجلسة */
export const FULL_BODY_BOOKING_LABEL = 'جسم كامل'

export const FULL_BODY_SESSION_AREA_LABELS = [
  'وجه',
  'رقبة',
  'نقرى',
  'يدين',
  'صدر',
  'بطن',
  'ظهر',
  'إبط',
  'رجلين',
  'بكيني',
  'ديريير',
] as const

export const FULL_BODY_SESSION_AREA_COUNT = FULL_BODY_SESSION_AREA_LABELS.length

export function normalizeLaserBookingText(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function isFullBodyLaserBookingText(text: string): boolean {
  const n = normalizeLaserBookingText(text)
  return n === 'جسم كامل' || n === 'full body' || n === 'fullbody'
}

/** جزء المناطق خارج الباكج من نص موعد الحجز (عند وضع with_addon) */
export function parseBookedLaserAddonSegment(procedureText: string, slotPkgMode: string): string {
  const proc = String(procedureText || '').trim()
  const mode = String(slotPkgMode || '').trim()
  if (mode !== 'continue_package_with_addon' && mode !== 'use_package_with_addon') return ''
  if (proc.startsWith('استكمال باكج')) {
    const idx = proc.indexOf(' + ')
    return idx >= 0 ? proc.slice(idx + 3).trim() : ''
  }
  if (proc.startsWith('جلسة ضمن باكج ليزر')) {
    const rest = proc.slice('جلسة ضمن باكج ليزر'.length).trim()
    if (!rest) return ''
    return rest.replace(/^\+\s*/, '').trim()
  }
  return ''
}

export function fullBodySessionAreaLabels(offerName?: string): string[] {
  if (isFullBodyLaserBookingText(offerName || '')) {
    return [...FULL_BODY_SESSION_AREA_LABELS]
  }
  return []
}

/** تفكيك اسم عرض إلى أسطر مناطق (مع دعم جسم كامل) */
export function splitLaserOfferAreaLabels(offerName: string): string[] {
  const full = fullBodySessionAreaLabels(offerName)
  if (full.length > 0) return full

  const raw = String(offerName || '').trim()
  if (!raw) return []
  return raw
    .replace(/\s+و\s+/g, '|')
    .split(/\s*(?:\||\+|،|,|\/|\\)\s*/g)
    .map((x) => x.trim())
    .filter(Boolean)
}
