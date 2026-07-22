export type ToothStatus = 'present' | 'missing' | 'implant'
export type ImplantColor = 'teal' | 'red'
export type SurfaceView = 'buccal' | 'occlusal'
export type SurfaceRegion = 'M' | 'D' | 'O' | 'B' | 'L' | 'I'

export type DentalSurfaceMark = {
  view: SurfaceView
  region: SurfaceRegion
  label: string
}

export type DentalToothState = {
  fdi: number
  status: ToothStatus
  implantColor: ImplantColor | null
  surfaces: DentalSurfaceMark[]
  note: string
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

export function defaultTooth(fdi: number): DentalToothState {
  return { fdi, status: 'present', implantColor: null, surfaces: [], note: '' }
}

export function teethMapFromChart(teeth: DentalToothState[] | undefined): Map<number, DentalToothState> {
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
        Boolean(t.note.trim()),
    )
    .map((t) => ({
      fdi: t.fdi,
      status: t.status,
      implantColor: t.status === 'implant' ? t.implantColor : null,
      surfaces: t.status === 'present' ? t.surfaces : [],
      note: t.note,
    }))
    .sort((a, b) => a.fdi - b.fdi)
}

export function toothStatusLabel(t: DentalToothState): string {
  if (t.status === 'missing') return 'سن مفقود'
  if (t.status === 'implant') return t.implantColor === 'red' ? 'زراعة (حمراء)' : 'زراعة'
  if (t.surfaces.length > 0) return t.surfaces.map((s) => s.label).join(' · ')
  if (t.note.trim()) return t.note.trim()
  return 'سليم'
}
