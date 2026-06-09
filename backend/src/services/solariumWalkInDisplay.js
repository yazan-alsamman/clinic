/** ملف داخلي لجلسات سولاريوم الزائر (غير مرتبطة بملف مريض حقيقي) */
export const SOLARIUM_WALKIN_FILE_NUMBER = 'SYS-SOL-WALKIN'

const WALKIN_PROCEDURE_RE = /^سولاريوم\s*[—-]\s*\d+\s*دقيقة\s*[—-]\s*(.+)$/u

export function extractSolariumWalkInDisplayName(procedureText) {
  const m = String(procedureText || '').trim().match(WALKIN_PROCEDURE_RE)
  return m?.[1]?.trim() || ''
}

export function isSolariumWalkInPlaceholderPatient(patient) {
  if (!patient) return false
  const fileNumber = String(patient.fileNumber || '').trim()
  if (fileNumber === SOLARIUM_WALKIN_FILE_NUMBER) return true
  const name = String(patient.name || '').trim()
  return name.includes('زائر (داخلي)') || name.includes('زائر داخلي')
}

/**
 * يعرض اسم الزائر المُدخل عند التسجيل بدل اسم المريض الوهمي الداخلي.
 */
export function resolveSolariumPatientDisplayName(patient, procedureText) {
  const walkInName = extractSolariumWalkInDisplayName(procedureText)
  if (walkInName) return walkInName
  if (isSolariumWalkInPlaceholderPatient(patient)) return 'زائر سولاريوم'
  const base = patient?.name != null ? String(patient.name).trim() : ''
  return base || '—'
}

export function resolveBillingPatientDisplayName(billingItemOrPatient, procedureLabel, department) {
  const patient =
    billingItemOrPatient?.patientId && typeof billingItemOrPatient.patientId === 'object'
      ? billingItemOrPatient.patientId
      : billingItemOrPatient
  const proc = String(procedureLabel || billingItemOrPatient?.procedureLabel || '').trim()
  const dept = String(department || billingItemOrPatient?.department || '').trim()
  if (dept === 'solarium') {
    return resolveSolariumPatientDisplayName(patient, proc)
  }
  const base = patient?.name != null ? String(patient.name).trim() : ''
  return base || '—'
}
