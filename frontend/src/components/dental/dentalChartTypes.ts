export type ToothStatus = 'present' | 'missing' | 'implant'
export type ImplantColor = 'teal' | 'red'
export type SurfaceView = 'buccal' | 'occlusal'
export type SurfaceRegion = 'M' | 'D' | 'O' | 'B' | 'L' | 'I'

export type SurfaceOrigin = 'preexisting' | 'clinic'
export type ChartViewLayer = 'baseline' | 'clinic' | 'all'
export type ChartPaintMode = 'baseline' | 'clinic'

export type DentalSurfaceMark = {
  view: SurfaceView
  region: SurfaceRegion
  label: string
  /** preexisting = عند القدوم، clinic = عمل العيادة */
  origin: SurfaceOrigin
}

export type DentalPayment = {
  id: string
  amountSyp: number
  amountUsd: number
  currency: 'syp' | 'usd'
  usdSypRateUsed: number
  paidAt: string
  note: string
}

export type DentalToothTreatment = {
  id?: string
  procedureDescription: string
  totalCostSyp: number
  totalCostUsd: number
  costUsdSypRate: number
  doctorName: string
  providerUserId: string | null
  providerKey?: string
  businessDate: string
  payments: DentalPayment[]
}

export type DentalLabWork = {
  id?: string
  labName: string
  procedureDescription: string
  amountSyp: number
  amountUsd: number
  /** سعر الصرف لجزء الدولار (ل.س لكل 1 USD) */
  usdSypRate: number
  businessDate: string
  doctorName?: string
  providerUserId?: string | null
  providerKey?: string
}

/** طبيب خاص بدون حساب مستخدم (د. الياس) */
export const DENTAL_ELIAS_VIRTUAL_ID = '__elias__'
export const DENTAL_ELIAS_DISPLAY_NAME = 'د. الياس'

export type DentalToothState = {
  fdi: number
  status: ToothStatus
  /** preexisting = جاء هكذا، clinic = خلع/زراعة في العيادة */
  statusOrigin: SurfaceOrigin
  implantColor: ImplantColor | null
  surfaces: DentalSurfaceMark[]
  note: string
  treatments: DentalToothTreatment[]
  labWorks: DentalLabWork[]
}

export type DentalChartDto = {
  teeth: DentalToothState[]
  updatedAt: string | null
  updatedBy: string | null
}

export type ChartTool =
  | 'select'
  | 'healthy'
  | 'missing'
  | 'implant_teal'
  | 'implant_red'
  | 'filling'
  | 'clear_surface'

export const FDI_ALL = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35,
  36, 37, 38,
] as const

export const UPPER_ROW = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] as const
export const LOWER_ROW = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const

export function toothKind(fdi: number): 'incisor' | 'canine' | 'premolar' | 'molar' {
  const pos = fdi % 10
  if (pos === 1 || pos === 2) return 'incisor'
  if (pos === 3) return 'canine'
  if (pos === 4 || pos === 5) return 'premolar'
  return 'molar'
}

export function isUpperFdi(fdi: number) {
  const q = Math.floor(fdi / 10)
  return q === 1 || q === 2
}

/** أسماء عربية حسب FDI */
export function arabicToothName(fdi: number): string {
  const names: Record<number, string> = {
    11: 'ثنية علوية يمنى',
    12: 'رباعية علوية يمنى',
    13: 'ناب علوي أيمن',
    14: 'ضاحك أول علوي أيمن',
    15: 'ضاحك ثانٍ علوي أيمن',
    16: 'طاحن أول علوي أيمن',
    17: 'طاحن ثانٍ علوي أيمن',
    18: 'طاحن ثالث علوي أيمن',
    21: 'ثنية علوية يسرى',
    22: 'رباعية علوية يسرى',
    23: 'ناب علوي أيسر',
    24: 'ضاحك أول علوي أيسر',
    25: 'ضاحك ثانٍ علوي أيسر',
    26: 'طاحن أول علوي أيسر',
    27: 'طاحن ثانٍ علوي أيسر',
    28: 'طاحن ثالث علوي أيسر',
    31: 'ثنية سفلية يسرى',
    32: 'رباعية سفلية يسرى',
    33: 'ناب سفلي أيسر',
    34: 'ضاحك أول سفلي أيسر',
    35: 'ضاحك ثانٍ سفلي أيسر',
    36: 'طاحن أول سفلي أيسر',
    37: 'طاحن ثانٍ سفلي أيسر',
    38: 'طاحن ثالث سفلي أيسر',
    41: 'ثنية سفلية يمنى',
    42: 'رباعية سفلية يمنى',
    43: 'ناب سفلي أيمن',
    44: 'ضاحك أول سفلي أيمن',
    45: 'ضاحك ثانٍ سفلي أيمن',
    46: 'طاحن أول سفلي أيمن',
    47: 'طاحن ثانٍ سفلي أيمن',
    48: 'طاحن ثالث سفلي أيمن',
  }
  return names[fdi] || `سن ${fdi}`
}

function todayIsoDateLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function roundUsd(n: number) {
  return Math.round(Number(n) * 1e6) / 1e6
}

export function formatUsdAmount(n: number) {
  const v = Number(n) || 0
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v)
}

/** التكلفة الكلية المكافئة بالليرة = ل.س + دولار×سعر الصرف */
export function treatmentEffectiveTotalSyp(t: DentalToothTreatment, fallbackRate?: number | null): number {
  const syp = Math.max(0, Math.round(Number(t.totalCostSyp) || 0))
  const usd = Math.max(0, Number(t.totalCostUsd) || 0)
  const rate =
    Number(t.costUsdSypRate) > 0 ? Number(t.costUsdSypRate) : Math.max(0, Number(fallbackRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? Math.round(usd * rate) : 0
  return syp + fromUsd
}

export function emptyTreatment(): DentalToothTreatment {
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    procedureDescription: '',
    totalCostSyp: 0,
    totalCostUsd: 0,
    costUsdSypRate: 0,
    doctorName: '',
    providerUserId: null,
    providerKey: '',
    businessDate: todayIsoDateLocal(),
    payments: [],
  }
}

export function normalizeTreatment(
  raw: Partial<DentalToothTreatment> | null | undefined,
  fallbackRate?: number | null,
): DentalToothTreatment {
  const totalCostSyp = Math.max(0, Math.round(Number(raw?.totalCostSyp) || 0))
  const totalCostUsd = Math.max(0, roundUsd(Number(raw?.totalCostUsd) || 0))
  let costUsdSypRate = Math.max(0, Number(raw?.costUsdSypRate) || 0)
  if (totalCostUsd > 0 && !(costUsdSypRate > 0)) {
    costUsdSypRate = Math.max(0, Number(fallbackRate) || 0)
  }
  if (!(totalCostUsd > 0)) costUsdSypRate = 0
  const effectiveTotal = treatmentEffectiveTotalSyp(
    { totalCostSyp, totalCostUsd, costUsdSypRate } as DentalToothTreatment,
    fallbackRate,
  )

  const payments: DentalPayment[] = []
  let paid = 0
  for (const p of raw?.payments || []) {
    const currency: 'syp' | 'usd' = String(p.currency || '').toLowerCase() === 'usd' ? 'usd' : 'syp'
    let amountUsd = Math.max(0, roundUsd(Number(p.amountUsd) || 0))
    let rateUsed = Math.max(0, Number(p.usdSypRateUsed) || 0)
    let amount = Math.max(0, Math.round(Number(p.amountSyp) || 0))
    if (currency === 'usd') {
      if (!(rateUsed > 0)) rateUsed = costUsdSypRate || Math.max(0, Number(fallbackRate) || 0)
      if (amountUsd > 0 && rateUsed > 0) amount = Math.round(amountUsd * rateUsed)
    } else {
      amountUsd = 0
      rateUsed = 0
    }
    if (!(amount > 0) && !(amountUsd > 0)) continue
    if (effectiveTotal > 0 && paid + amount > effectiveTotal) {
      amount = Math.max(0, effectiveTotal - paid)
      if (!(amount > 0)) break
      if (currency === 'usd' && rateUsed > 0) amountUsd = roundUsd(amount / rateUsed)
    }
    payments.push({
      id: String(p.id || `p-${payments.length}`),
      amountSyp: amount,
      amountUsd: currency === 'usd' ? amountUsd : 0,
      currency,
      usdSypRateUsed: currency === 'usd' ? rateUsed : 0,
      paidAt: String(p.paidAt || ''),
      note: String(p.note || ''),
    })
    paid += amount
  }
  let businessDate = String(raw?.businessDate || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    const firstPay = payments.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p.paidAt || '').slice(0, 10)))
    businessDate = firstPay ? String(firstPay.paidAt).slice(0, 10) : todayIsoDateLocal()
  }
  const providerRaw = raw?.providerUserId != null ? String(raw.providerUserId).trim() : ''
  const providerKey = String(raw?.providerKey || '').trim()
  const isElias =
    providerRaw === DENTAL_ELIAS_VIRTUAL_ID ||
    providerKey === 'elias' ||
    /الياس|إلياس|elias|elyas/i.test(String(raw?.doctorName || ''))
  return {
    id: raw?.id ? String(raw.id) : undefined,
    procedureDescription: String(raw?.procedureDescription || '').trim(),
    totalCostSyp,
    totalCostUsd,
    costUsdSypRate,
    doctorName: isElias ? DENTAL_ELIAS_DISPLAY_NAME : String(raw?.doctorName || '').trim(),
    providerUserId: isElias ? DENTAL_ELIAS_VIRTUAL_ID : providerRaw || null,
    providerKey: isElias ? 'elias' : providerKey,
    businessDate,
    payments,
  }
}

export function treatmentHasData(t: DentalToothTreatment | undefined): boolean {
  if (!t) return false
  return (
    Boolean(t.procedureDescription.trim()) ||
    t.totalCostSyp > 0 ||
    t.totalCostUsd > 0 ||
    Boolean(t.doctorName.trim()) ||
    Boolean(t.providerUserId) ||
    Boolean(t.providerKey?.trim()) ||
    t.payments.length > 0
  )
}

export function normalizeTreatmentsList(
  treatments: DentalToothTreatment[] | undefined,
  legacy?: DentalToothTreatment | null,
): DentalToothTreatment[] {
  if (Array.isArray(treatments) && treatments.length > 0) {
    return treatments.map((t) => normalizeTreatment(t))
  }
  if (legacy && treatmentHasData(legacy)) return [normalizeTreatment(legacy)]
  return [emptyTreatment()]
}

export function treatmentsHaveData(list: DentalToothTreatment[] | undefined): boolean {
  return (list || []).some(treatmentHasData)
}

export function treatmentPaidTotal(t: DentalToothTreatment): number {
  return Math.round(t.payments.reduce((s, p) => s + (Number(p.amountSyp) || 0), 0))
}

export function treatmentPaidTotalUsd(t: DentalToothTreatment): number {
  return roundUsd(t.payments.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0))
}

export function treatmentRemaining(t: DentalToothTreatment, fallbackRate?: number | null): number {
  return Math.max(0, treatmentEffectiveTotalSyp(t, fallbackRate) - treatmentPaidTotal(t))
}

export function emptyLabWork(): DentalLabWork {
  return {
    id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    labName: '',
    procedureDescription: '',
    amountSyp: 0,
    amountUsd: 0,
    usdSypRate: 0,
    businessDate: todayIsoDateLocal(),
    doctorName: '',
    providerUserId: null,
    providerKey: '',
  }
}

/** تكلفة المخبر المكافئة بالليرة = ل.س + دولار×سعر الصرف */
export function labEffectiveAmountSyp(lab: DentalLabWork, fallbackRate?: number | null): number {
  const syp = Math.max(0, Math.round(Number(lab.amountSyp) || 0))
  const usd = Math.max(0, Number(lab.amountUsd) || 0)
  const rate =
    Number(lab.usdSypRate) > 0 ? Number(lab.usdSypRate) : Math.max(0, Number(fallbackRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? Math.round(usd * rate) : 0
  return syp + fromUsd
}

export function normalizeLabWork(
  raw: Partial<DentalLabWork> | null | undefined,
  fallbackRate?: number | null,
): DentalLabWork {
  let businessDate = String(raw?.businessDate || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) businessDate = todayIsoDateLocal()
  const providerRaw = raw?.providerUserId != null ? String(raw.providerUserId).trim() : ''
  const providerKey = String(raw?.providerKey || '').trim()
  const isElias =
    providerRaw === DENTAL_ELIAS_VIRTUAL_ID ||
    providerKey === 'elias' ||
    /الياس|إلياس|elias|elyas/i.test(String(raw?.doctorName || ''))
  const amountSyp = Math.max(0, Math.round(Number(raw?.amountSyp) || 0))
  const amountUsd = Math.max(0, roundUsd(Number(raw?.amountUsd) || 0))
  let usdSypRate = Math.max(0, Number(raw?.usdSypRate) || 0)
  if (amountUsd > 0 && !(usdSypRate > 0)) {
    usdSypRate = Math.max(0, Number(fallbackRate) || 0)
  }
  if (!(amountUsd > 0)) usdSypRate = 0
  return {
    id: raw?.id ? String(raw.id) : undefined,
    labName: String(raw?.labName || '').trim(),
    procedureDescription: String(raw?.procedureDescription || '').trim(),
    amountSyp,
    amountUsd,
    usdSypRate,
    businessDate,
    doctorName: isElias ? DENTAL_ELIAS_DISPLAY_NAME : String(raw?.doctorName || '').trim(),
    providerUserId: isElias ? DENTAL_ELIAS_VIRTUAL_ID : providerRaw || null,
    providerKey: isElias ? 'elias' : providerKey,
  }
}

export function labWorkHasData(row: DentalLabWork | undefined): boolean {
  if (!row) return false
  return (
    Boolean(row.labName.trim()) ||
    Boolean(row.procedureDescription.trim()) ||
    row.amountSyp > 0 ||
    row.amountUsd > 0
  )
}

export function normalizeLabWorksList(
  list: DentalLabWork[] | undefined,
  fallbackRate?: number | null,
): DentalLabWork[] {
  return (list || []).map((x) => normalizeLabWork(x, fallbackRate)).filter(labWorkHasData)
}

export function defaultTooth(fdi: number): DentalToothState {
  return {
    fdi,
    status: 'present',
    statusOrigin: 'preexisting',
    implantColor: null,
    surfaces: [],
    note: '',
    treatments: [emptyTreatment()],
    labWorks: [],
  }
}

export function normalizeSurfaceMark(raw: Partial<DentalSurfaceMark> | null | undefined): DentalSurfaceMark {
  const view = raw?.view === 'occlusal' ? 'occlusal' : 'buccal'
  const region = String(raw?.region || 'O').toUpperCase() as SurfaceRegion
  return {
    view,
    region: (['M', 'D', 'O', 'B', 'L', 'I'].includes(region) ? region : 'O') as SurfaceRegion,
    label: String(raw?.label || 'حشوة كومبوزيت').trim() || 'حشوة كومبوزيت',
    origin: raw?.origin === 'clinic' ? 'clinic' : 'preexisting',
  }
}

export function teethMapFromChart(
  teeth: Array<DentalToothState & { treatment?: DentalToothTreatment }> | undefined,
): Map<number, DentalToothState> {
  const map = new Map<number, DentalToothState>()
  for (const fdi of FDI_ALL) map.set(fdi, defaultTooth(fdi))
  for (const t of teeth || []) {
    if (!map.has(t.fdi)) continue
    map.set(t.fdi, {
      fdi: t.fdi,
      status: t.status === 'missing' || t.status === 'implant' ? t.status : 'present',
      statusOrigin: t.statusOrigin === 'clinic' ? 'clinic' : 'preexisting',
      implantColor: t.status === 'implant' ? (t.implantColor === 'red' ? 'red' : 'teal') : null,
      surfaces: Array.isArray(t.surfaces) ? t.surfaces.map((s) => normalizeSurfaceMark(s)) : [],
      note: String(t.note || ''),
      treatments: normalizeTreatmentsList(t.treatments, t.treatment),
      labWorks: Array.isArray(t.labWorks) ? t.labWorks.map((x) => normalizeLabWork(x)) : [],
    })
  }
  return map
}

export function chartTeethPayload(map: Map<number, DentalToothState>): DentalToothState[] {
  return [...map.values()]
    .filter(
      (t) =>
        t.status !== 'present' ||
        t.surfaces.length > 0 ||
        Boolean(t.note.trim()) ||
        treatmentsHaveData(t.treatments) ||
        normalizeLabWorksList(t.labWorks).length > 0,
    )
    .map((t) => ({
      fdi: t.fdi,
      status: t.status,
      statusOrigin: t.status === 'present' ? 'preexisting' : t.statusOrigin || 'preexisting',
      implantColor: t.status === 'implant' ? t.implantColor : null,
      surfaces: t.status === 'present' ? t.surfaces.map((s) => normalizeSurfaceMark(s)) : [],
      note: t.note,
      treatments: (t.treatments || []).map((x) => normalizeTreatment(x)).filter(treatmentHasData),
      labWorks: normalizeLabWorksList(t.labWorks),
    }))
    .sort((a, b) => a.fdi - b.fdi)
}

/** عرض السن حسب طبقة العرض (حالة الدخول / عمل العيادة / الكل) */
export function toothForViewLayer(tooth: DentalToothState, layer: ChartViewLayer): DentalToothState {
  if (layer === 'all') return tooth

  if (layer === 'baseline') {
    const status =
      tooth.status !== 'present' && tooth.statusOrigin === 'clinic' ? 'present' : tooth.status
    return {
      ...tooth,
      status,
      statusOrigin: 'preexisting',
      implantColor: status === 'implant' ? tooth.implantColor : null,
      surfaces: tooth.surfaces.filter((s) => s.origin !== 'clinic'),
      /** أخفِ مؤشرات الإجراءات في طبقة الدخول */
      treatments: [],
      labWorks: [],
    }
  }

  // clinic layer — الإجراءات دائماً عمل عيادة
  const status =
    tooth.status !== 'present' && tooth.statusOrigin === 'clinic'
      ? tooth.status
      : 'present'
  return {
    ...tooth,
    status,
    statusOrigin: status === 'present' ? 'preexisting' : 'clinic',
    implantColor: status === 'implant' ? tooth.implantColor : null,
    surfaces: tooth.surfaces.filter((s) => s.origin === 'clinic'),
    treatments: tooth.treatments,
    labWorks: tooth.labWorks,
  }
}

export function toothHasClinicWork(t: DentalToothState): boolean {
  return (
    treatmentsHaveData(t.treatments) ||
    normalizeLabWorksList(t.labWorks).length > 0 ||
    t.surfaces.some((s) => s.origin === 'clinic') ||
    (t.status !== 'present' && t.statusOrigin === 'clinic')
  )
}

export function toothStatusLabel(t: DentalToothState): string {
  const originHint =
    t.status !== 'present'
      ? t.statusOrigin === 'clinic'
        ? ' (عمل العيادة)'
        : ' (عند القدوم)'
      : ''
  if (t.status === 'missing') return `سن مفقود${originHint}`
  if (t.status === 'implant')
    return `${t.implantColor === 'red' ? 'زراعة (حمراء)' : 'زراعة'}${originHint}`
  const preexisting = t.surfaces.filter((s) => s.origin !== 'clinic')
  const clinicSurf = t.surfaces.filter((s) => s.origin === 'clinic')
  const parts: string[] = []
  if (preexisting.length) parts.push(`دخول: ${preexisting.map((s) => s.label).join(' · ')}`)
  if (clinicSurf.length) parts.push(`عيادة: ${clinicSurf.map((s) => s.label).join(' · ')}`)
  const active = (t.treatments || []).filter(treatmentHasData)
  if (active.length > 0) {
    if (active.length === 1) {
      const one = active[0]
      const rem = treatmentRemaining(one)
      if (one.totalCostSyp > 0 || one.totalCostUsd > 0) {
        parts.push(
          rem > 0
            ? `إجراء — متبقي ${rem.toLocaleString('ar-SY')} ل.س`
            : 'إجراء — مسدّد بالكامل',
        )
      } else {
        parts.push(one.procedureDescription.trim().slice(0, 40) || 'إجراء مسجّل')
      }
    } else {
      parts.push(`${active.length} إجراءات`)
    }
  }
  if (parts.length) return parts.join(' · ')
  if (t.note.trim()) return t.note.trim()
  return 'سليم'
}
