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
 * بعد صافي الليرة من USD (ترجيع ل.س و/أو USD):
 * إذا زاد الصافي على المستحق ب≤ سعر 1 USD وكان «صافي الدولار النقدي» عدداً صحيحاً نعتبره تسامح تسعير/أوراق ولا رصيد إضافي.
 * — بلا ترجيع أو ترجيع USD فقط: صافي USD = مستلم − ترجيع USD صحيح.
 * — ترجيع ل.س فقط: صافي الليرة ÷ السعر يعادل عدداً صحيحاً من USD (مثال 50$ و630000 ل.س ترجيع → صافي 8$).
 * — ترجيع ل.س وUSD معاً: لا نستوعب (نادر؛ يُرجى التحقق يدوياً).
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
  if (!(rate > 0) || rawDelta <= 0 || rawDelta > rate) return rawDelta

  const u = Number(amountUsd)
  const ru = Number(patientRefundUsd) || 0
  const rs = Math.round(Number(patientRefundSyp) || 0)

  if (ru > 0 && rs > 0) return rawDelta

  if (ru > 0) {
    const netUsd = u - ru
    if (!Number.isFinite(netUsd) || netUsd <= 0) return rawDelta
    if (Math.abs(netUsd - Math.round(netUsd)) > 1e-5) return rawDelta
    return 0
  }

  if (rs > 0) {
    const impliedNetUsd = netReceivedSyp / rate
    if (!Number.isFinite(impliedNetUsd) || impliedNetUsd <= 0) return rawDelta
    if (Math.abs(impliedNetUsd - Math.round(impliedNetUsd)) > 1e-5) return rawDelta
    return 0
  }

  if (!Number.isFinite(u) || u <= 0) return rawDelta
  if (Math.abs(u - Math.round(u)) > 1e-5) return rawDelta
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
