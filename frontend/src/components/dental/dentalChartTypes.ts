export type ToothStatus = 'present' | 'missing' | 'implant'
export type ImplantColor = 'teal' | 'red'
export type SurfaceView = 'buccal' | 'occlusal'
export type SurfaceRegion = 'M' | 'D' | 'O' | 'B' | 'L' | 'I'

export type DentalSurfaceMark = {
  view: SurfaceView
  region: SurfaceRegion
  label: string
}

export type DentalPayment = {
  id: string
  amountSyp: number
  paidAt: string
  note: string
}

export type DentalToothTreatment = {
  id?: string
  procedureDescription: string
  totalCostSyp: number
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

export function emptyTreatment(): DentalToothTreatment {
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    procedureDescription: '',
    totalCostSyp: 0,
    doctorName: '',
    providerUserId: null,
    providerKey: '',
    businessDate: todayIsoDateLocal(),
    payments: [],
  }
}

export function normalizeTreatment(raw: Partial<DentalToothTreatment> | null | undefined): DentalToothTreatment {
  const totalCostSyp = Math.max(0, Math.round(Number(raw?.totalCostSyp) || 0))
  const payments: DentalPayment[] = []
  let paid = 0
  for (const p of raw?.payments || []) {
    let amount = Math.max(0, Math.round(Number(p.amountSyp) || 0))
    if (!(amount > 0)) continue
    if (totalCostSyp > 0 && paid + amount > totalCostSyp) {
      amount = Math.max(0, totalCostSyp - paid)
      if (!(amount > 0)) break
    }
    payments.push({
      id: String(p.id || `p-${payments.length}`),
      amountSyp: amount,
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

export function treatmentRemaining(t: DentalToothTreatment): number {
  return Math.max(0, Math.round(Number(t.totalCostSyp) || 0) - treatmentPaidTotal(t))
}

export function emptyLabWork(): DentalLabWork {
  return {
    id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    labName: '',
    procedureDescription: '',
    amountSyp: 0,
    businessDate: todayIsoDateLocal(),
    doctorName: '',
    providerUserId: null,
    providerKey: '',
  }
}

export function normalizeLabWork(raw: Partial<DentalLabWork> | null | undefined): DentalLabWork {
  let businessDate = String(raw?.businessDate || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) businessDate = todayIsoDateLocal()
  const providerRaw = raw?.providerUserId != null ? String(raw.providerUserId).trim() : ''
  const providerKey = String(raw?.providerKey || '').trim()
  const isElias =
    providerRaw === DENTAL_ELIAS_VIRTUAL_ID ||
    providerKey === 'elias' ||
    /الياس|إلياس|elias|elyas/i.test(String(raw?.doctorName || ''))
  return {
    id: raw?.id ? String(raw.id) : undefined,
    labName: String(raw?.labName || '').trim(),
    procedureDescription: String(raw?.procedureDescription || '').trim(),
    amountSyp: Math.max(0, Math.round(Number(raw?.amountSyp) || 0)),
    businessDate,
    doctorName: isElias ? DENTAL_ELIAS_DISPLAY_NAME : String(raw?.doctorName || '').trim(),
    providerUserId: isElias ? DENTAL_ELIAS_VIRTUAL_ID : providerRaw || null,
    providerKey: isElias ? 'elias' : providerKey,
  }
}

export function labWorkHasData(row: DentalLabWork | undefined): boolean {
  if (!row) return false
  return Boolean(row.labName.trim()) || Boolean(row.procedureDescription.trim()) || row.amountSyp > 0
}

export function normalizeLabWorksList(list: DentalLabWork[] | undefined): DentalLabWork[] {
  return (list || []).map((x) => normalizeLabWork(x)).filter(labWorkHasData)
}

export function defaultTooth(fdi: number): DentalToothState {
  return {
    fdi,
    status: 'present',
    implantColor: null,
    surfaces: [],
    note: '',
    treatments: [emptyTreatment()],
    labWorks: [],
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
      implantColor: t.status === 'implant' ? (t.implantColor === 'red' ? 'red' : 'teal') : null,
      surfaces: Array.isArray(t.surfaces) ? t.surfaces : [],
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
      implantColor: t.status === 'implant' ? t.implantColor : null,
      surfaces: t.status === 'present' ? t.surfaces : [],
      note: t.note,
      treatments: (t.treatments || []).map((x) => normalizeTreatment(x)).filter(treatmentHasData),
      labWorks: normalizeLabWorksList(t.labWorks),
    }))
    .sort((a, b) => a.fdi - b.fdi)
}

export function toothStatusLabel(t: DentalToothState): string {
  if (t.status === 'missing') return 'سن مفقود'
  if (t.status === 'implant') return t.implantColor === 'red' ? 'زراعة (حمراء)' : 'زراعة'
  if (t.surfaces.length > 0) return t.surfaces.map((s) => s.label).join(' · ')
  const active = (t.treatments || []).filter(treatmentHasData)
  if (active.length > 0) {
    if (active.length === 1) {
      const one = active[0]
      const rem = treatmentRemaining(one)
      if (one.totalCostSyp > 0) {
        return rem > 0
          ? `إجراء — متبقي ${rem.toLocaleString('ar-SY')} ل.س`
          : 'إجراء — مسدّد بالكامل'
      }
      return one.procedureDescription.trim().slice(0, 40) || 'إجراء مسجّل'
    }
    return `${active.length} إجراءات`
  }
  if (t.note.trim()) return t.note.trim()
  return 'سليم'
}
