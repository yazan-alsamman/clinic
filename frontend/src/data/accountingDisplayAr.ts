/** عرض واجهة المحاسبة بالعربية — المعرّفات التقنية تُظهر كمرجع فقط */

export const DATA_TYPE_AR: Record<string, string> = {
  number: 'رقم',
  string: 'نص',
  boolean: 'قيمة منطقية',
}

export const ACCOUNTING_TAG_AR: Record<string, string> = {
  MANAGEMENT: 'تقارير إدارية',
  ACCRUAL_CLINIC: 'استحقاق (عيادة)',
  CASH_HELPER: 'مساعد نقدي',
  IFRS_MANAGEMENT: 'إطار IFRS — إداري',
}

export const STEP_KEY_AR: Record<string, string> = {
  net_gross: 'صافي الإيراد بعد الحسم',
  net_after_material: 'صافي بعد خصم تكلفة المواد',
  doctor_share_usd: 'حصة الطبيب / الأخصائي (دولار)',
  clinic_net_usd: 'صافي العيادة (دولار)',
  material_cost_usd: 'تكلفة المواد (دولار)',
}

export const PROFILE_CODE_AR: Record<string, string> = {
  CLINIC_NET_SHARE: 'بعد المواد ثم حصة الطبيب',
  CLINIC_SHARE_ON_GROSS: 'حصة من الإيراد مباشرة (أسنان عام)',
}

export const DEPARTMENT_AR: Record<string, string> = {
  laser: 'الليزر',
  dermatology: 'الجلدية',
  dental: 'الأسنان',
  multi: 'أكثر من قسم',
}

export const SOURCE_TYPE_AR: Record<string, string> = {
  laser_session: 'جلسة ليزر',
  dermatology_visit: 'زيارة جلدية',
  dental_procedure: 'إجراء أسنان',
  manual_adjustment: 'تسوية يدوية',
}

export const LINE_TYPE_AR: Record<string, string> = {
  net_revenue: 'صافي الإيراد',
  material_cost: 'تكلفة المواد',
  doctor_share: 'حصة الطبيب',
  clinic_net: 'صافي العيادة',
  discount_memo: 'مذكرة حسم',
}

export function formatDataTypeAr(dt: string | undefined): string {
  if (!dt) return '—'
  return DATA_TYPE_AR[dt] ?? dt
}

export function formatAccountingTagsAr(tags: string[] | undefined): string {
  if (!tags?.length) return ''
  return tags.map((t) => ACCOUNTING_TAG_AR[t] ?? t).join(' · ')
}

export function formatStepKeyAr(key: string): string {
  return STEP_KEY_AR[key] ?? key
}

export function formatDepartmentAr(d: string): string {
  return DEPARTMENT_AR[d] ?? d
}

export function formatSourceTypeAr(s: string): string {
  return SOURCE_TYPE_AR[s] ?? s
}

export function formatBackfillSummary(result: Record<string, unknown>): string {
  const laser = Number(result.laser ?? 0)
  const dermatology = Number(result.dermatology ?? 0)
  const skipped = Number(result.skipped ?? 0)
  const errors = Array.isArray(result.errors) ? result.errors : []
  const parts = [
    `ليزر: ${laser} مستند جديد`,
    `جلدية: ${dermatology} مستند جديد`,
    `تخطّي (موجود مسبقاً): ${skipped}`,
  ]
  if (errors.length) parts.push(`أخطاء: ${errors.length}`)
  return parts.join(' — ')
}
