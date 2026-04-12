/**
 * تصنيف نوع الإجراء لعرض الفلاتر (النصوص حرة في الجدول).
 * يُراعى النص العربي والإنجليزي الشائع في العيادة.
 */
export type ProcedureCategory = 'laser' | 'dermatology' | 'dental' | 'other'

export type ProcedureCategoryFilter = 'all' | ProcedureCategory

/** خيارات حجز الموعد من الاستقبال — مصدر واحد للقائمة والتصنيف */
export const APPOINTMENT_PROCEDURE_OPTIONS = ['ليزر', 'جلدية', 'بشرة', 'سولاريوم', 'أسنان'] as const

export type AppointmentProcedureOption = (typeof APPOINTMENT_PROCEDURE_OPTIONS)[number]

export function inferProcedureCategory(procedureType: string, providerName?: string): ProcedureCategory {
  const t = String(procedureType || '').trim()
  const pr = String(providerName || '').trim()
  const blob = `${t} ${pr}`.toLowerCase()

  if (t === 'ليزر') return 'laser'
  if (t === 'أسنان') return 'dental'
  if (t === 'جلدية' || t === 'بشرة' || t === 'سولاريوم') return 'dermatology'

  if (/ليزر|\blaser\b|أخصائية\s*ليزر/i.test(blob)) return 'laser'

  if (
    /أسنان|\bdental\b|تقويم|خلع|حشو|تنظيف\s*أسنان|تاج|جسر|زرع|عصب|تلبيس|\bortho\b|implant|crown|filling|extraction/i.test(
      blob,
    )
  )
    return 'dental'

  if (/جلد|جلدية|بشرة|تجميل|فيلر|بوتوكس|نضارة|سولاريوم|مساج|كشف|peel|derma|botox|filler/i.test(blob))
    return 'dermatology'

  return 'other'
}

export const PROCEDURE_FILTER_LABELS: Record<ProcedureCategoryFilter, string> = {
  all: 'جميع الإجراءات',
  laser: 'ليزر',
  dermatology: 'جلدية',
  dental: 'أسنان',
  other: 'غير مصنّف',
}

/** خيارات قائمة المواعيد المحجوزة (بدون «غير مصنّف» — تظهر تلك الصفوف ضمن «الكل» فقط) */
export const BOOKED_PAGE_PROCEDURE_FILTERS: { value: ProcedureCategoryFilter; label: string }[] = [
  { value: 'all', label: PROCEDURE_FILTER_LABELS.all },
  { value: 'laser', label: PROCEDURE_FILTER_LABELS.laser },
  { value: 'dermatology', label: PROCEDURE_FILTER_LABELS.dermatology },
  { value: 'dental', label: PROCEDURE_FILTER_LABELS.dental },
]
