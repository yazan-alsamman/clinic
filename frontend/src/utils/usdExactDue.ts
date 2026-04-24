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
