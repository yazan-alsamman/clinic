/** @param {number} n */
export function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

/** تقريب USD للتخزين/التقارير دون تقييد قبل ضرب سعر الصرف */
export function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6
}
