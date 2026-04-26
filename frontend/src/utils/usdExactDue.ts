/** إزالة أصفار زائدة بعد الفاصلة مع الإبقاء على دقة كافية */
function trimUsdDecimalString(s: string): string {
  if (!s.includes('.')) return s
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * سلسلة مبلغ USD بحيث: Math.round(Number(النتيجة) × rate) === dueSyp
 * (لأن المستحق بالليرة صحيح والتحويل يُقرّب لليرة عند الحفظ).
 */
export function usdAmountStringMatchingDueSyp(dueSyp: number, rate: number): string {
  const due = Math.round(Number(dueSyp) || 0)
  const r = Number(rate)
  if (!(due > 0) || !(r > 0) || !Number.isFinite(r)) return ''
  for (let d = 2; d <= 14; d++) {
    const s = (due / r).toFixed(d)
    const usd = Number(s)
    if (!Number.isFinite(usd) || usd <= 0) continue
    if (Math.round(usd * r) === due) return trimUsdDecimalString(s)
  }
  return trimUsdDecimalString((due / r).toFixed(10))
}

/** نتيجة اقتراح دولار بسيط (غالباً عدد صحيح) + ترجيع ل.س ليبقى الصافي = المستحق */
export type UsdRoundedCashOffer = {
  usdRounded: number
  usdFieldValue: string
  impliedRefundSyp: number
}

/**
 * يقرّب مبلغ الدولار إلى **أعلى عدد صحيح** لا يقل عن المبلغ المضبوط رياضياً،
 * ويحسب ترجيعاً بالليرة بحيث: round(usd×rate) − ترجيع = المستحق (لا رصيد إضافي).
 */
/**
 * صافي ما يبقى للعيادة بالليرة بعد دفع USD وترجيع (ل.س و/أو USD).
 * عند وجود ترجيع بالدولار يُحسب: round((مستلم − ترجيع USD) × السعر) − ترجيع ل.س
 * ليتوافق مع التجميع المحاسبي وتفادي فرق التقريب بين round(a×r) − round(b×r) و round((a−b)×r).
 */
/**
 * بعد حساب صافي الليرة من USD (ومع ترجيع USD اختياري، بلا ترجيع ل.س):
 * إذا كان صافي الدولار النقدي = مستلم − ترجيع USD **عدداً صحيحاً** وزاد الصافي بالليرة على المستحق
 * بمقدار ≤ سعر 1 USD بالليرة، نعتبره فرق تقريب تسعير/أوراق ولا يُسجَّل رصيد إضافي.
 * (يشمل قبض 8$ فقط، أو 10$ مع ترجيع 2$ عندما يعادل الصافي «جلسة 8$» مقابل مستحق ل.س غير مضبوط على مضاعف السعر.)
 */
export function settlementDeltaAfterUsdCashNetAbsorb(opts: {
  payCurrency: 'SYP' | 'USD'
  netReceivedSyp: number
  amountDueSyp: number
  rate: number
  amountUsd: number
  patientRefundSyp: number
  patientRefundUsd: number
}): number {
  const { payCurrency, netReceivedSyp, amountDueSyp, rate, amountUsd, patientRefundSyp, patientRefundUsd } = opts
  const rawDelta = netReceivedSyp - amountDueSyp
  if (payCurrency !== 'USD') return rawDelta
  if (patientRefundSyp > 0) return rawDelta
  const u = Number(amountUsd)
  const ru = Number(patientRefundUsd) || 0
  const netUsd = u - ru
  if (!(rate > 0) || rawDelta <= 0 || rawDelta > rate) return rawDelta
  if (!Number.isFinite(netUsd) || netUsd <= 0) return rawDelta
  if (Math.abs(netUsd - Math.round(netUsd)) > 1e-5) return rawDelta
  return 0
}

export function netReceivedSypAfterUsdCollection(opts: {
  amountUsd: number
  patientRefundSyp: number
  patientRefundUsd: number
  rate: number
}): number {
  const u = Number(opts.amountUsd)
  const r = Number(opts.rate)
  const rs = Math.round(Number(opts.patientRefundSyp) || 0)
  const ru = Number(opts.patientRefundUsd) || 0
  if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(r) || r <= 0) return 0
  if (ru > 0) {
    return Math.round((u - ru) * r) - rs
  }
  return Math.round(u * r) - rs
}

export function usdRoundedUpCashOffer(dueSyp: number, rate: number): UsdRoundedCashOffer | null {
  const due = Math.round(Number(dueSyp) || 0)
  const r = Number(rate)
  if (!(due > 0) || !(r > 0) || !Number.isFinite(r)) return null

  const exactStr = usdAmountStringMatchingDueSyp(due, r)
  const exactUsd = Number(exactStr)
  if (!Number.isFinite(exactUsd) || exactUsd <= 0) return null

  const usdRounded = Math.ceil(exactUsd - 1e-9)
  const grossSyp = Math.round(usdRounded * r)
  const impliedRefundSyp = Math.max(0, grossSyp - due)

  return {
    usdRounded,
    usdFieldValue: String(usdRounded),
    impliedRefundSyp,
  }
}
