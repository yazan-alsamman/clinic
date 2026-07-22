/** طبيب خاص بدون حساب مستخدم — إجراءاته كاملة لربح القسم بعد مخابره (بدون نسبة 40٪) */
export const DENTAL_ELIAS_VIRTUAL_ID = '__elias__'
export const DENTAL_ELIAS_PROVIDER_KEY = 'elias'
export const DENTAL_ELIAS_DISPLAY_NAME = 'د. الياس'

export function providerNameMatchesElias(name) {
  const raw = String(name || '').trim()
  if (!raw) return false
  const s = raw.toLowerCase()
  return /الياس|إلياس|اليأس|elias|elyas/.test(raw) || s.includes('elias') || s.includes('elyas')
}

export function isEliasProviderRef({ providerUserId, providerKey, doctorName } = {}) {
  const id = String(providerUserId || '').trim()
  const key = String(providerKey || '').trim().toLowerCase()
  if (id === DENTAL_ELIAS_VIRTUAL_ID || key === DENTAL_ELIAS_PROVIDER_KEY) return true
  return providerNameMatchesElias(doctorName)
}

export function resolveDentalProviderFields({ providerUserId, providerKey, doctorName } = {}) {
  if (isEliasProviderRef({ providerUserId, providerKey, doctorName })) {
    return {
      providerUserId: null,
      providerKey: DENTAL_ELIAS_PROVIDER_KEY,
      doctorName: DENTAL_ELIAS_DISPLAY_NAME,
      isElias: true,
    }
  }
  return {
    providerUserId: providerUserId || null,
    providerKey: String(providerKey || '').trim() || '',
    doctorName: String(doctorName || '').trim(),
    isElias: false,
  }
}
