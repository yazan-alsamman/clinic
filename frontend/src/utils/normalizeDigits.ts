/** تحويل الأرقام العربية/الفارسية إلى لاتينية ليقبلها parseFloat */
export function normalizeDecimalDigits(raw: string) {
  let s = raw.replace(/,/g, '').replace(/\s/g, '').trim()
  for (let i = 0; i < 10; i++) {
    const ar = String.fromCharCode(0x0660 + i)
    const ext = String.fromCharCode(0x06f0 + i)
    s = s.split(ar).join(String(i)).split(ext).join(String(i))
  }
  return s
}
