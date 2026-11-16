import { normalizeDecimalDigits } from './normalizeDigits'

/** طريقة إدخال الخصم: نسبة مئوية أو مبلغ ثابت بالليرة */
export type DiscountMode = 'percent' | 'amount'

export type DiscountPreview = {
  /** هل المُدخل صالح وفيه خصم فعلي */
  valid: boolean
  error: string
  percent: number
  amountSyp: number
  priceBeforeSyp: number
  priceAfterSyp: number
}

function parseNum(raw: string): number {
  const s = normalizeDecimalDigits(String(raw || '')).replace(/[%,\s]/g, '')
  if (!s) return NaN
  return Number(s)
}

/** نسبة للعرض: منزلتان كحد أقصى */
export function displayPercent(p: number): number {
  const n = Number(p)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

/**
 * نفس منطق الخادم (discountMath.resolveDiscountEntry):
 * النسبة → المبلغ = الأساس − round(الأساس × (1 − النسبة/100))
 * المبلغ → النسبة = المبلغ ÷ الأساس × 100
 */
export function computeDiscountPreview(opts: {
  baseSyp: number
  mode: DiscountMode
  value: string
  /** أقل سعر مسموح بعد الخصم (1 ل.س في التحصيل، 0 في الجلسات المجانية) */
  minPriceAfterSyp?: number
}): DiscountPreview {
  const base = Math.max(0, Math.round(Number(opts.baseSyp) || 0))
  const minAfter = opts.minPriceAfterSyp ?? 1
  const empty: DiscountPreview = {
    valid: false,
    error: '',
    percent: 0,
    amountSyp: 0,
    priceBeforeSyp: base,
    priceAfterSyp: base,
  }
  const n = parseNum(opts.value)
  if (!Number.isFinite(n) || n === 0) return empty
  if (!(base > 0)) return { ...empty, error: 'لا يوجد سعر يمكن تطبيق الخصم عليه.' }
  let amount: number
  let percent: number
  if (opts.mode === 'percent') {
    if (n < 0 || n > 100) return { ...empty, error: 'نسبة الخصم يجب أن تكون بين 0 و 100.' }
    percent = n
    amount = base - Math.round(base * (1 - n / 100))
  } else {
    if (n < 0) return { ...empty, error: 'مبلغ الخصم غير صالح.' }
    amount = Math.round(n)
    percent = (amount / base) * 100
  }
  if (!(amount > 0)) return empty
  const after = base - amount
  if (after < minAfter) {
    return {
      ...empty,
      error: minAfter > 0 ? 'الخصم أكبر من المستحق — يجب أن يبقى 1 ل.س على الأقل.' : 'الخصم أكبر من السعر.',
    }
  }
  return { valid: true, error: '', percent, amountSyp: amount, priceBeforeSyp: base, priceAfterSyp: after }
}

/** حقول الطلب: يُرسل أحدهما فقط */
export function discountRequestFields(mode: DiscountMode, preview: DiscountPreview): {
  discountPercent: number
  discountAmountSyp?: number
} {
  if (!preview.valid) return { discountPercent: 0 }
  if (mode === 'amount') return { discountPercent: 0, discountAmountSyp: preview.amountSyp }
  return { discountPercent: preview.percent }
}
