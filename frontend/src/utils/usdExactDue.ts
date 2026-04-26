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
