/** @param {number} n */
export function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

/** @param {number} usd @param {number|null|undefined} rate */
export function usdToSypInteger(usd, rate) {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null
  return Math.round(Number(usd) * rate)
}
