const WELCOME_SEEN_KEY = 'dr_elias_patient_welcome_seen'

/** بعد متابعة مشهد الترحيب — لا يُعاد في نفس جلسة المتصفح. */
export function markPatientWelcomeSeen(): void {
  try {
    sessionStorage.setItem(WELCOME_SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** عند دخول جديد: أعد إظهار الترحيب. */
export function resetPatientWelcomeSeen(): void {
  try {
    sessionStorage.removeItem(WELCOME_SEEN_KEY)
  } catch {
    /* ignore */
  }
}

export function hasPatientWelcomeSeen(): boolean {
  try {
    return sessionStorage.getItem(WELCOME_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
