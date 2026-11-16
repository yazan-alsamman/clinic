/**
 * حساب الخصم — دوال صافية بلا قاعدة بيانات.
 *
 * يدعم طريقتي الإدخال:
 *  - نسبة مئوية: المبلغ = الأساس − round(الأساس × (1 − النسبة/100)) — نفس تقريب النظام القديم للمستحق بعد الخصم.
 *  - مبلغ ثابت: النسبة = المبلغ ÷ الأساس × 100 (تُحفظ بدقة كاملة، وتُقرَّب للعرض فقط).
 *
 * المبلغ المخصوم الفعلي هو المرجع دائماً؛ النسبة وصف له. لا يُسمح بخصم يجعل السعر بعده أقل من 1 ل.س
 * (نفس قاعدة DISCOUNT_TOO_DEEP الموجودة في التحصيل).
 */

export const MIN_PRICE_AFTER_DISCOUNT_SYP = 1

export class DiscountInputError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.code = 'DISCOUNT'
    this.discountCode = code
  }
}

const MESSAGES = {
  DISCOUNT_RANGE: 'نسبة الخصم يجب أن تكون بين 0 و 100.',
  DISCOUNT_AMOUNT_INVALID: 'مبلغ الخصم غير صالح — أدخل رقماً موجباً بالليرة.',
  DISCOUNT_BOTH: 'أدخل الخصم إما كنسبة مئوية أو كمبلغ ثابت، وليس الاثنين معاً.',
  DISCOUNT_TOO_DEEP: 'الخصم كبير جداً — المستحق بعد الخصم أصبح أقل من 1 ل.س.',
  DISCOUNT_NO_BASE: 'لا يوجد سعر يمكن تطبيق الخصم عليه.',
}

function fail(code) {
  return new DiscountInputError(code, MESSAGES[code] || 'خصم غير صالح.')
}

function toNumberOrNull(raw) {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

/** نسبة للعرض: منزلتان عشريتان كحد أقصى */
export function displayPercent(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

/** النسبة الدقيقة المقابلة لمبلغ خصم على أساس معيّن */
export function percentFromAmount(baseSyp, amountSyp) {
  const base = Math.round(Number(baseSyp) || 0)
  const amount = Math.round(Number(amountSyp) || 0)
  if (!(base > 0) || !(amount > 0)) return 0
  return (amount / base) * 100
}

/** مبلغ الخصم المقابل لنسبة على أساس معيّن (بنفس تقريب المستحق في النظام) */
export function amountFromPercent(baseSyp, percent) {
  const base = Math.round(Number(baseSyp) || 0)
  const p = Number(percent) || 0
  if (!(base > 0) || !(p > 0)) return 0
  return base - Math.round(base * (1 - p / 100))
}

/**
 * يحوّل مدخل المستخدم (نسبة أو مبلغ) إلى خصم كامل.
 * يُرجع null إذا لم يُدخل خصم (أو كان صفراً).
 *
 * @param {{ baseSyp: number, percent?: unknown, amountSyp?: unknown, minPriceAfterSyp?: number }} input
 * @returns {null | { entryMode: 'percent'|'amount', discountPercent: number, discountAmountSyp: number, priceBeforeSyp: number, priceAfterSyp: number }}
 */
export function resolveDiscountEntry({ baseSyp, percent, amountSyp, minPriceAfterSyp = MIN_PRICE_AFTER_DISCOUNT_SYP }) {
  const p = toNumberOrNull(percent)
  const a = toNumberOrNull(amountSyp)
  const hasP = p != null && !(Number.isFinite(p) && p === 0)
  const hasA = a != null && !(Number.isFinite(a) && a === 0)
  if (!hasP && !hasA) return null
  if (hasP && hasA) throw fail('DISCOUNT_BOTH')

  const base = Math.round(Number(baseSyp) || 0)
  if (!(base > 0)) throw fail('DISCOUNT_NO_BASE')

  let entryMode
  let discountAmountSyp
  let discountPercent
  if (hasP) {
    if (!Number.isFinite(p) || p < 0 || p > 100) throw fail('DISCOUNT_RANGE')
    entryMode = 'percent'
    discountPercent = p
    discountAmountSyp = amountFromPercent(base, p)
  } else {
    if (!Number.isFinite(a) || a < 0) throw fail('DISCOUNT_AMOUNT_INVALID')
    entryMode = 'amount'
    discountAmountSyp = Math.round(a)
    discountPercent = percentFromAmount(base, discountAmountSyp)
  }
  if (!(discountAmountSyp > 0)) return null
  const priceAfterSyp = base - discountAmountSyp
  if (priceAfterSyp < minPriceAfterSyp) throw fail('DISCOUNT_TOO_DEEP')
  return {
    entryMode,
    discountPercent,
    discountAmountSyp,
    priceBeforeSyp: base,
    priceAfterSyp,
  }
}

/**
 * يطبّق خصماً إضافياً بالتسلسل على السعر الحالي (بعد الخصومات السابقة)، ويُرجع
 * الحقول المجمّعة التي تُحفظ على بند الفوترة: السعر الأصلي ثابت، والنسبة الكلية = (الأصلي − النهائي) ÷ الأصلي.
 *
 * @param {{ listSyp: number, currentEffectiveSyp: number, entry: ReturnType<typeof resolveDiscountEntry> }} opts
 */
export function combineSequentialDiscount({ listSyp, currentEffectiveSyp, entry }) {
  const list = Math.round(Number(listSyp) || 0)
  const current = Math.round(Number(currentEffectiveSyp) || 0)
  if (!entry) {
    return { listAmountDueSyp: list, effectiveAmountDueSyp: current, discountPercent: percentFromAmount(list, list - current) }
  }
  const effective = current - entry.discountAmountSyp
  return {
    listAmountDueSyp: list,
    effectiveAmountDueSyp: effective,
    discountPercent: percentFromAmount(list, list - effective),
  }
}
