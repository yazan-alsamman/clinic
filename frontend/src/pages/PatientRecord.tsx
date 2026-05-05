import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import { canAccessTab } from '../data/nav'
import { api, ApiError } from '../api/client'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'
import type { LaserCategory, Patient, Role } from '../types'

type Tab =
  | 'overview'
  | 'account'
  | 'packages'
  | 'financial'
  | 'sessions'
  | 'laser'
  | 'dermatology'
  | 'dental'
  | 'solarium'

const laserTypes = ['Mix', 'Yag', 'Alex'] as const

function parseLaserShotsForPricing(raw: string) {
  const num = Number.parseFloat(normalizeDecimalDigits(raw))
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.round(num)
}

type DentalPlanDto = {
  id: string
  status: 'draft' | 'approved'
  items: { label?: string; note?: string; tooth?: number }[]
  approvedAt?: string | null
} | null

type ClinicalLaserRow = {
  id: string
  treatmentNumber: number
  createdAt: string
  updatedAt?: string
  laserType: string
  room: string
  status: string
  operatorName: string
  areaIds: string[]
  notes: string
  pw: string
  pulse: string
  shotCount: string
  chargeByPulseCount?: boolean
  costSyp: number
  discountPercent: number
  sessionTypeLabel: string
  billingItemId?: string | null
  billingItemStatus?: string | null
  collectedAmountSyp?: number | null
  manualAreaLabels?: string[]
  isPackageSession?: boolean
  patientPackageId?: string
  patientPackageSessionId?: string
}

type ClinicalDermRow = {
  id: string
  businessDate: string
  areaTreatment: string
  sessionType: string
  costSyp: number
  discountPercent: number
  providerName: string
  notes: string
  createdAt: string
}

type DermatologyMaterialOption = {
  id: string
  sku: string
  name: string
  department: 'laser' | 'dermatology' | 'dermatology_private' | 'dental' | 'skin' | 'solarium'
  unit: string
  quantity: number
  unitCost: number
  active: boolean
}

type DermatologySelectedMaterial = {
  inventoryItemId: string
  quantity: string
}

type LaserProcedureItem = {
  id: string
  code: string
  name: string
  groupId: string
  groupTitle: string
  kind: 'area' | 'offer'
  priceSyp: number
  priceMaleSyp: number
  priceFemaleSyp: number
  areaCount: number
  active: boolean
  sortOrder: number
}

type LaserProcedureGroup = {
  id: string
  title: string
  items: LaserProcedureItem[]
}

type LaserSessionLineInput = {
  rowId: string
  procedureOptionId: string
  optionInstance: number
  areaLabel: string
  pw: string
  pulse: string
  shotCount: string
  chargeByPulseCount: boolean
  isAddon: boolean
}

function resolveLaserItemPriceByPatientGender(
  item: Pick<LaserProcedureItem, 'priceSyp' | 'priceMaleSyp' | 'priceFemaleSyp'>,
  patientGender: '' | 'male' | 'female',
) {
  const male = Number(item.priceMaleSyp ?? item.priceSyp) || 0
  const female = Number(item.priceFemaleSyp ?? item.priceSyp) || 0
  if (patientGender === 'male') return male
  if (patientGender === 'female') return female
  return female || male
}

function createLaserLineRow(partial?: Partial<LaserSessionLineInput>): LaserSessionLineInput {
  return {
    rowId: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    procedureOptionId: '',
    optionInstance: 1,
    areaLabel: '',
    pw: '',
    pulse: '',
    shotCount: '',
    chargeByPulseCount: false,
    isAddon: false,
    ...partial,
  }
}

function splitOfferAreaLabels(offerName: string) {
  const raw = String(offerName || '').trim()
  if (!raw) return []
  return raw
    .replace(/\s+و\s+/g, '|')
    .split(/\s*(?:\||\+|،|,|\/|\\)\s*/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

type DermatologySessionRow = {
  id: string
  businessDate: string
  department: string
  procedureDescription: string
  sessionFeeSyp: number
  materialCostSypTotal: number
  materialChargeSypTotal: number
  amountDueSyp: number
  billingStatus: string
  providerName: string
  providerUserId?: string
  notes: string
  createdAt: string
  createdByReceptionUserId?: string | null
  isPackagePrepaid?: boolean
  materials: Array<{
    name: string
    quantity: number
    chargedUnitPriceSyp?: number
    lineChargeSyp?: number
  }>
}

type PatientPackageSession = {
  id: string
  label: string
  completedByReception: boolean
  completedAt: string | null
  completedByUserId: string | null
  linkedLaserSessionId: string | null
  linkedBillingItemId: string | null
}

type PatientPackage = {
  id: string
  department: 'laser'
  title: string
  sessionsCount: number
  packageTotalSyp: number
  paidAmountSyp: number
  settlementDeltaSyp: number
  notes: string
  createdAt: string | null
  sessions: PatientPackageSession[]
}

function clinicalDeptLabelAr(d: string) {
  const m: Record<string, string> = {
    laser: 'ليزر',
    dermatology: 'جلدية',
    dental: 'أسنان',
    solarium: 'سولاريوم',
  }
  return m[d] || d
}

function inventoryDepartmentsQueryForClinicalDept(dept: string) {
  if (dept === 'laser') return 'laser'
  if (dept === 'dental') return 'dental'
  if (dept === 'dermatology') return 'dermatology,skin,solarium'
  if (dept === 'solarium') return 'solarium,skin'
  return 'dermatology,skin,solarium'
}

function canEditClinicalSessionRow(me: { id?: string; role?: Role }, row: DermatologySessionRow) {
  if (!me.id || !me.role) return false
  if (me.role === 'super_admin' || me.role === 'reception') return true
  return row.providerUserId === me.id
}

type ClinicalApptRow = {
  id: string
  businessDate: string
  time: string
  endTime: string
  providerName: string
  procedureType: string
}

const laserStatusAr: Record<string, string> = {
  scheduled: 'مجدولة',
  in_progress: 'قيد التنفيذ',
  completed_pending_collection: 'تمت بدون تحصيل',
  completed: 'مكتمل',
}

function formatLaserCollectedSyp(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return '—'
  return `${Math.round(Number(amount)).toLocaleString('ar-SY')} ل.س`
}

function formatClinicDate(iso: string | undefined) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('ar-SY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

type ClinicalDentalSummary = {
  status: 'draft' | 'approved'
  items: { label?: string; note?: string; tooth?: number }[]
  approvedAt?: string | null
} | null

function showOverviewAppointments(r: Role | undefined) {
  return (
    r === 'super_admin' ||
    r === 'reception' ||
    r === 'dermatology' ||
    r === 'dermatology_manager' ||
    r === 'dermatology_assistant_manager' ||
    r === 'dental_branch'
  )
}

function showOverviewLaser(r: Role | undefined) {
  return r === 'super_admin' || r === 'reception' || r === 'laser'
}

function showOverviewDerm(r: Role | undefined) {
  return (
    r === 'super_admin' ||
    r === 'reception' ||
    r === 'dermatology' ||
    r === 'dermatology_manager' ||
    r === 'dermatology_assistant_manager'
  )
}

function showOverviewDentalSummary(r: Role | undefined) {
  return r === 'super_admin' || r === 'reception' || r === 'dental_branch'
}

function clinicalHistoryIntro(r: Role | undefined): string {
  if (r === 'laser') return 'جلسات الليزر المسجّلة لهذا المريض.'
  if (r === 'dermatology')
    return 'مواعيدك وإجراءاتك الجلدية المسجّلة لهذا المريض (حسب اسمك كمقدّم في النظام).'
  if (r === 'dermatology_manager' || r === 'dermatology_assistant_manager')
    return 'عرض المواعيد وإجراءات الجلدية لهذا المريض ضمن صلاحيات إدارة القسم.'
  if (r === 'dental_branch')
    return 'مواعيدك المحجوزة وملخص خطة الأسنان لهذا المريض (حسب اسمك كمقدّم).'
  return 'مواعيد محجوزة، جلسات ليزر، إجراءات جلدية، وخطة أسنان إن وُجدت.'
}

function resolveLaserAreaLabels(ids: string[], catalog: LaserCategory[]): string {
  if (!ids.length) return '—'
  const m = new Map<string, string>()
  for (const c of catalog) {
    for (const a of c.areas) m.set(a.id, a.label)
  }
  return ids.map((id) => m.get(id) ?? id).join(' — ')
}

function resolveLaserAreasDisplay(
  ids: string[],
  manual: string[] | undefined,
  catalog: LaserCategory[],
): string {
  const cat = resolveLaserAreaLabels(ids, catalog)
  const man = (manual ?? []).filter(Boolean).join(' — ')
  if (cat !== '—' && man) return `${cat} — ${man}`
  if (man) return man
  return cat
}

const GENDER_LABELS: Record<'male' | 'female' | '', string> = {
  '': 'غير محدد',
  male: 'ذكر',
  female: 'أنثى',
}

const YES_NO_LABELS: Record<'' | 'yes' | 'no', string> = {
  '': 'غير محدد',
  yes: 'نعم',
  no: 'لا',
}

const PREGNANCY_LABELS: Record<'' | 'pregnant' | 'not_pregnant' | 'planning_pregnancy', string> = {
  '': 'غير محدد',
  pregnant: 'حامل',
  not_pregnant: 'غير حامل',
  planning_pregnancy: 'تخطط للحمل',
}

const LACTATION_LABELS: Record<'' | 'lactating' | 'not_lactating', string> = {
  '': 'غير محدد',
  lactating: 'مرضع',
  not_lactating: 'غير مرضع',
}

function isFemaleMarried(gender: '' | 'male' | 'female' | undefined, marital: string | undefined): boolean {
  if (gender !== 'female') return false
  const m = String(marital || '')
    .trim()
    .toLowerCase()
  return ['متزوجة', 'متزوج', 'married'].includes(m)
}

type ClinicalHistorySnapshot = {
  laserSessions: ClinicalLaserRow[]
  dermatologyVisits: ClinicalDermRow[]
  appointments: ClinicalApptRow[]
  dentalPlan: ClinicalDentalSummary
}

function escapeHtmlPdf(text: string): string {
  const el = document.createElement('div')
  el.textContent = text
  return el.innerHTML
}

function buildPatientRecordPrintHtml(opts: {
  patient: Patient
  clinicalHistory: ClinicalHistorySnapshot | null
  laserCatalog: LaserCategory[]
  role: Role | undefined
  exporterName?: string
  exportedAtLabel: string
}): string {
  const { patient, clinicalHistory, laserCatalog, role, exporterName, exportedAtLabel } = opts
  const g =
    patient.gender === 'male' || patient.gender === 'female' ? patient.gender : ('' as const)
  const genderLabel = GENDER_LABELS[g]

  const demographicsRows = `
    <tr><th>رقم الإضبارة</th><td>${escapeHtmlPdf(patient.fileNumber || '—')}</td></tr>
    <tr><th>الاسم الكامل</th><td>${escapeHtmlPdf(patient.name)}</td></tr>
    <tr><th>تاريخ الميلاد</th><td>${escapeHtmlPdf(patient.dob?.trim() ? patient.dob : '—')}</td></tr>
    <tr><th>الحالة الاجتماعية</th><td>${escapeHtmlPdf(patient.marital?.trim() ? patient.marital : '—')}</td></tr>
    <tr><th>المهنة</th><td>${escapeHtmlPdf(patient.occupation?.trim() ? patient.occupation : '—')}</td></tr>
    <tr><th>الهاتف</th><td dir="ltr" style="text-align:right">${escapeHtmlPdf(patient.phone?.trim() ? patient.phone : '—')}</td></tr>
    <tr><th>الجنس</th><td>${escapeHtmlPdf(genderLabel)}</td></tr>
  `
  const femaleMarried = isFemaleMarried(g, patient.marital)
  const pregnancyLabel = PREGNANCY_LABELS[
    patient.pregnancyStatus === 'pregnant' ||
    patient.pregnancyStatus === 'not_pregnant' ||
    patient.pregnancyStatus === 'planning_pregnancy'
      ? patient.pregnancyStatus
      : ''
  ]
  const lactationLabel = LACTATION_LABELS[
    patient.lactationStatus === 'lactating' || patient.lactationStatus === 'not_lactating'
      ? patient.lactationStatus
      : ''
  ]
  const previousTreatmentsLabel = YES_NO_LABELS[
    patient.previousTreatments === 'yes' || patient.previousTreatments === 'no' ? patient.previousTreatments : ''
  ]
  const recentDermTreatmentsLabel = YES_NO_LABELS[
    patient.recentDermTreatments === 'yes' || patient.recentDermTreatments === 'no'
      ? patient.recentDermTreatments
      : ''
  ]
  const isotretinoinHistoryLabel = YES_NO_LABELS[
    patient.isotretinoinHistory === 'yes' || patient.isotretinoinHistory === 'no' ? patient.isotretinoinHistory : ''
  ]

  const historyBlock = `
    <h2>التاريخ الطبي العام</h2>
    <table>
      <tr><th style="width:28%">سوابق مرضية</th><td>${escapeHtmlPdf(patient.medicalHistory?.trim() ? patient.medicalHistory : '—')}</td></tr>
      <tr><th>سوابق جراحية</th><td>${escapeHtmlPdf(patient.surgicalHistory?.trim() ? patient.surgicalHistory : '—')}</td></tr>
      <tr><th>تحسس</th><td>${escapeHtmlPdf(patient.allergies?.trim() ? patient.allergies : '—')}</td></tr>
      <tr><th>سوابق دوائية</th><td>${escapeHtmlPdf(patient.drugHistory?.trim() ? patient.drugHistory : '—')}</td></tr>
      <tr><th>هل يوجد معالجات سابقة؟</th><td>${escapeHtmlPdf(previousTreatmentsLabel)}</td></tr>
      <tr><th>علاجات جلدية قريبة</th><td>${escapeHtmlPdf(recentDermTreatmentsLabel)}</td></tr>
      <tr><th>قصة علاج بالريتان</th><td>${escapeHtmlPdf(isotretinoinHistoryLabel)}</td></tr>
      ${
        femaleMarried
          ? `<tr><th>الحمل</th><td>${escapeHtmlPdf(pregnancyLabel)}</td></tr><tr><th>الإرضاع</th><td>${escapeHtmlPdf(lactationLabel)}</td></tr>`
          : ''
      }
    </table>
  `

  let clinicalBlock = ''
  if (!clinicalHistory) {
    clinicalBlock = `<p class="note">لم يُحمَّل السجل السريري (مواعيد، ليزر، جلدية، أسنان) أو تعذر جلبه.</p>`
  } else {
    const parts: string[] = []

    if (showOverviewAppointments(role)) {
      const rows =
        clinicalHistory.appointments.length === 0
          ? '<tr><td colspan="4" class="muted">لا مواعيد في النطاق المعروض.</td></tr>'
          : clinicalHistory.appointments
              .map(
                (a) =>
                  `<tr><td>${escapeHtmlPdf(a.businessDate)}</td><td>${escapeHtmlPdf(a.providerName)}</td><td>${escapeHtmlPdf(a.procedureType || '—')}</td><td>${escapeHtmlPdf(a.time + (a.endTime ? ` — ${a.endTime}` : ''))}</td></tr>`,
              )
              .join('')
      parts.push(
        `<h2>المواعيد المحجوزة</h2><table><thead><tr><th>التاريخ</th><th>المقدّم</th><th>نوع الإجراء</th><th>الوقت</th></tr></thead><tbody>${rows}</tbody></table>`,
      )
    }

    if (showOverviewLaser(role)) {
      const rows =
        clinicalHistory.laserSessions.length === 0
          ? '<tr><td colspan="8" class="muted">لا جلسات ليزر مسجّلة.</td></tr>'
          : clinicalHistory.laserSessions
              .map((s) => {
                const areas = resolveLaserAreasDisplay(
                  s.areaIds ?? [],
                  s.manualAreaLabels,
                  laserCatalog,
                )
                return `<tr>
                  <td>${s.treatmentNumber}</td>
                  <td>${escapeHtmlPdf(formatClinicDate(s.createdAt))}</td>
                  <td>${escapeHtmlPdf(`${s.laserType} — غرفة ${s.room}`)}</td>
                  <td>${escapeHtmlPdf(laserStatusAr[s.status] ?? s.status)}</td>
                  <td>${escapeHtmlPdf(s.operatorName)}</td>
                  <td>${escapeHtmlPdf(areas)}</td>
                  <td>${escapeHtmlPdf(formatLaserCollectedSyp(s.collectedAmountSyp ?? null))}</td>
                  <td>${escapeHtmlPdf(s.notes?.trim() || '—')}</td>
                </tr>`
              })
              .join('')
      parts.push(
        `<h2>جلسات الليزر</h2><table><thead><tr><th>رقم المعالجة</th><th>التاريخ والوقت</th><th>النوع / الغرفة</th><th>الحالة</th><th>المعالج</th><th>المناطق</th><th>التحصيل</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table>`,
      )
    }

    if (showOverviewDerm(role)) {
      const rows =
        clinicalHistory.dermatologyVisits.length === 0
          ? '<tr><td colspan="7" class="muted">لا معاينات جلدية في النطاق المعروض.</td></tr>'
          : clinicalHistory.dermatologyVisits
              .map(
                (v) =>
                  `<tr><td>${escapeHtmlPdf(v.businessDate)}</td><td>${escapeHtmlPdf(v.sessionType || '—')}</td><td>${escapeHtmlPdf(v.areaTreatment || '—')}</td><td>${escapeHtmlPdf(v.providerName)}</td><td>${v.costSyp}</td><td>${v.discountPercent}%</td><td>${escapeHtmlPdf(v.notes?.trim() || '—')}</td></tr>`,
              )
              .join('')
      parts.push(
        `<h2>معاينات وإجراءات الجلدية</h2><table><thead><tr><th>يوم العمل</th><th>نوع الجلسة</th><th>المنطقة / المعالجة</th><th>المقدّم</th><th>الكلفة (ل.س)</th><th>الحسم</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table>`,
      )
    }

    if (showOverviewDentalSummary(role)) {
      const dp = clinicalHistory.dentalPlan
      let inner = '<p class="muted">لا خطة أسنان مسجّلة لهذا المريض.</p>'
      if (dp) {
        const status = dp.status === 'approved' ? 'معتمدة' : 'مسودّة'
        const approved = dp.approvedAt ? ` — ${escapeHtmlPdf(formatClinicDate(dp.approvedAt))}` : ''
        const items =
          dp.items?.length ?
            `<ul>${dp.items.map((it) => `<li>${escapeHtmlPdf(it.label || it.note || `سن ${it.tooth ?? '—'}`)}</li>`).join('')}</ul>`
          : '<p class="muted">لا بنود في الخطة.</p>'
        inner = `<p><strong>الحالة:</strong> ${status}${approved}</p>${items}`
      }
      parts.push(`<h2>خطة الأسنان (ملخص)</h2>${inner}`)
    }

    clinicalBlock = `<h2 style="margin-top:1.25rem">سجل الجلسات والمعاينات والمواعيد</h2>${parts.join('')}`
  }

  const meta = [
    escapeHtmlPdf(exportedAtLabel),
    exporterName ? `المصدِّر: ${escapeHtmlPdf(exporterName)}` : '',
  ]
    .filter(Boolean)
    .join(' — ')

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>ملف المريض — ${escapeHtmlPdf(patient.name)}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 16px; font-size: 12px; color: #111; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    h2 { font-size: 1rem; margin: 1rem 0 0.5rem; }
    .meta { font-size: 0.85rem; color: #444; margin-bottom: 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 10px; }
    th, td { border: 1px solid #333; padding: 6px 8px; text-align: right; vertical-align: top; }
    th { background: #eee; }
    .note { color: #666; font-size: 0.9rem; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>ملف المريض</h1>
  <div class="meta">${meta}</div>
  <h2>البيانات الشخصية</h2>
  <table><tbody>${demographicsRows}</tbody></table>
  ${historyBlock}
  ${clinicalBlock}
</body>
</html>`
}

function openHtmlPrintWindow(html: string) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => {
    w.print()
    w.close()
  }, 300)
}

export function PatientRecord() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { businessDate: clinicBusinessDate } = useClinic()
  const role = user?.role as Role | undefined
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => {
    const requested = searchParams.get('tab')
    if (!requested) return
    const allowed: Tab[] = [
      'overview',
      'account',
      'financial',
      'sessions',
      'laser',
      'dermatology',
      'dental',
      'solarium',
    ]
    if (allowed.includes(requested as Tab)) {
      setTab(requested as Tab)
    }
  }, [searchParams])

  const [laserType, setLaserType] = useState<(typeof laserTypes)[number]>('Mix')
  const room: '1' | '2' = '1'
  const [laserCatalog, setLaserCatalog] = useState<LaserCategory[]>([])
  const [laserProcedureGroups, setLaserProcedureGroups] = useState<LaserProcedureGroup[]>([])
  const [laserProcedureLoading, setLaserProcedureLoading] = useState(false)
  const [laserProcedureErr, setLaserProcedureErr] = useState('')
  const [selectedLaserItemIds, setSelectedLaserItemIds] = useState<string[]>([])
  /** مناطق/عروض خارج الباكج — تُحسب على المريض فقط */
  const [selectedLaserAddonItemIds, setSelectedLaserAddonItemIds] = useState<string[]>([])
  const bookedLaserProcedureText = (searchParams.get('laserProc') || '').trim()
  const bookedLaserSlotId = (searchParams.get('laserSlotId') || '').trim()
  const [laserAreaModalOpen, setLaserAreaModalOpen] = useState(false)
  const [laserLineItems, setLaserLineItems] = useState<LaserSessionLineInput[]>([])
  const [laserPricePerPulseSyp, setLaserPricePerPulseSyp] = useState(0)
  const [laserNotes, setLaserNotes] = useState('')
  const [nextTreatmentHint, setNextTreatmentHint] = useState('—')
  const [savingLaser, setSavingLaser] = useState(false)
  const [laserSessionErr, setLaserSessionErr] = useState('')
  const [laserSessionOk, setLaserSessionOk] = useState('')
  const [dentalPlan, setDentalPlan] = useState<DentalPlanDto>(null)
  const [planDraft, setPlanDraft] = useState(
    'تقويم للفكين — حشو 11، 12 — متابعة تنظيف دوري.',
  )
  const [approvingPlan, setApprovingPlan] = useState(false)
  const [dermProcedureDescription, setDermProcedureDescription] = useState('')
  const [dermSessionFeeSyp, setDermSessionFeeSyp] = useState('')
  const [dermMaterialsCatalog, setDermMaterialsCatalog] = useState<DermatologyMaterialOption[]>([])
  const [dermSelectedMaterials, setDermSelectedMaterials] = useState<DermatologySelectedMaterial[]>([])
  const [dermSaving, setDermSaving] = useState(false)
  const [dermErr, setDermErr] = useState('')
  const [dermOk, setDermOk] = useState('')
  const [dermSessions, setDermSessions] = useState<DermatologySessionRow[]>([])
  const [dermSessionsLoading, setDermSessionsLoading] = useState(false)
  const [recvAllSessions, setRecvAllSessions] = useState<DermatologySessionRow[]>([])
  const [laserClinSessions, setLaserClinSessions] = useState<DermatologySessionRow[]>([])
  const [dentalClinSessions, setDentalClinSessions] = useState<DermatologySessionRow[]>([])
  const [solSessions, setSolSessions] = useState<DermatologySessionRow[]>([])
  const [recvDept, setRecvDept] = useState<'laser' | 'dermatology' | 'dental' | 'solarium'>('dermatology')
  const [recvProviders, setRecvProviders] = useState<{ id: string; name: string }[]>([])
  const [recvProviderId, setRecvProviderId] = useState('')
  const [recvFeeSyp, setRecvFeeSyp] = useState('')
  const [recvSaving, setRecvSaving] = useState(false)
  const [recvErr, setRecvErr] = useState('')
  const [recvOk, setRecvOk] = useState('')
  const [sessionEditOpen, setSessionEditOpen] = useState(false)
  const [sessionEditId, setSessionEditId] = useState<string | null>(null)
  const [sessionEditDept, setSessionEditDept] = useState('')
  const [sessionEditProc, setSessionEditProc] = useState('')
  const [sessionEditNotes, setSessionEditNotes] = useState('')
  const [sessionEditCatalog, setSessionEditCatalog] = useState<DermatologyMaterialOption[]>([])
  const [sessionEditSelected, setSessionEditSelected] = useState<DermatologySelectedMaterial[]>([])
  const [sessionEditSaving, setSessionEditSaving] = useState(false)
  const [sessionEditErr, setSessionEditErr] = useState('')
  const [clinicalHistory, setClinicalHistory] = useState<{
    laserSessions: ClinicalLaserRow[]
    dermatologyVisits: ClinicalDermRow[]
    appointments: ClinicalApptRow[]
    dentalPlan: ClinicalDentalSummary
  } | null>(null)
  const [clinicalHistoryErr, setClinicalHistoryErr] = useState('')
  const [clinicalHistoryLoading, setClinicalHistoryLoading] = useState(false)
  type PortalAccountDto = {
    hasPortal: boolean
    username: string
    portalEnabled: boolean
    mustChangePassword: boolean
    lastLoginAt: string | null
  }
  const [portalAccount, setPortalAccount] = useState<PortalAccountDto | null>(null)
  const [portalAccountLoading, setPortalAccountLoading] = useState(false)
  const [portalAccountErr, setPortalAccountErr] = useState('')
  const [portalRevealCreds, setPortalRevealCreds] = useState<{ username: string; password: string } | null>(
    null,
  )
  const [portalActionBusy, setPortalActionBusy] = useState(false)
  type FinancialEntry = {
    id: string
    billingItemId: string
    businessDate: string
    procedureLabel: string
    amountDueSyp: number
    appliedAmountSyp: number
    receivedAmountSyp: number
    settlementDeltaSyp: number
    settlementType: 'exact' | 'debt' | 'credit' | string
    method: string
    receivedAt: string | null
    receivedByName: string
  }
  const [financialEntries, setFinancialEntries] = useState<FinancialEntry[]>([])
  const [financialLoading, setFinancialLoading] = useState(false)
  const [financialErr, setFinancialErr] = useState('')
  const [financialSettleOpen, setFinancialSettleOpen] = useState(false)
  const [financialSettleSyp, setFinancialSettleSyp] = useState('')
  const [financialSettleBusy, setFinancialSettleBusy] = useState(false)
  const [financialSettleErr, setFinancialSettleErr] = useState('')
  const [packageBusy, setPackageBusy] = useState(false)
  const [packageErr, setPackageErr] = useState('')
  const [packageOk, setPackageOk] = useState('')
  const [packageTitle, setPackageTitle] = useState('')
  const [packageSessionsCount, setPackageSessionsCount] = useState('6')
  const [packageTotalSyp, setPackageTotalSyp] = useState('')
  const [packagePaidSyp, setPackagePaidSyp] = useState('')
  const [packageNotes, setPackageNotes] = useState('')
  const [laserSessionDetail, setLaserSessionDetail] = useState<ClinicalLaserRow | null>(null)
  const [laserSessionCompleting, setLaserSessionCompleting] = useState(false)
  const [laserDetailActionErr, setLaserDetailActionErr] = useState('')
  const [toothState, setToothState] = useState<Record<number, 'healthy' | 'planned' | 'treated'>>(() => {
    const o: Record<number, 'healthy' | 'planned' | 'treated'> = {}
    for (let i = 1; i <= 32; i += 1) o[i] = 'healthy'
    o[11] = 'planned'
    o[12] = 'planned'
    o[26] = 'treated'
    return o
  })

  const canEditPatientProfile = role === 'super_admin' || role === 'reception'

  const refreshClinicalSessionLists = useCallback(async () => {
    if (!id) return
    try {
      const res = await api<{ sessions: DermatologySessionRow[] }>(
        `/api/clinical/sessions/patient/${encodeURIComponent(id)}`,
      )
      const rows = res.sessions
      if (role === 'super_admin' || role === 'reception') setRecvAllSessions(rows)
      setDermSessions(rows.filter((s) => s.department === 'dermatology'))
      setLaserClinSessions(rows.filter((s) => s.department === 'laser'))
      setDentalClinSessions(rows.filter((s) => s.department === 'dental'))
      setSolSessions(rows.filter((s) => s.department === 'solarium'))
    } catch {
      /* lists unchanged */
    }
  }, [id, role])

  async function openSessionEdit(row: DermatologySessionRow) {
    setSessionEditErr('')
    setSessionEditId(row.id)
    setSessionEditDept(row.department)
    setSessionEditProc(row.procedureDescription || '')
    setSessionEditNotes(row.notes || '')
    setSessionEditSelected([])
    try {
      const q = inventoryDepartmentsQueryForClinicalDept(row.department)
      const cat = await api<{ items: DermatologyMaterialOption[] }>(
        `/api/inventory/items?activeOnly=1&inStockOnly=1&departments=${encodeURIComponent(q)}`,
      )
      setSessionEditCatalog(cat.items)
    } catch {
      setSessionEditCatalog([])
    }
    setSessionEditOpen(true)
  }

  function toggleSessionEditMaterial(materialId: string, checked: boolean) {
    setSessionEditSelected((prev) => {
      const exists = prev.some((x) => x.inventoryItemId === materialId)
      if (checked && !exists) return [...prev, { inventoryItemId: materialId, quantity: '1' }]
      if (!checked && exists) return prev.filter((x) => x.inventoryItemId !== materialId)
      return prev
    })
  }

  function updateSessionEditMaterialLine(materialId: string, value: string) {
    setSessionEditSelected((prev) =>
      prev.map((line) => (line.inventoryItemId === materialId ? { ...line, quantity: value } : line)),
    )
  }

  const [overviewEdit, setOverviewEdit] = useState(false)
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewSaveErr, setOverviewSaveErr] = useState('')
  const [pdfExporting, setPdfExporting] = useState(false)
  const [overviewDraft, setOverviewDraft] = useState({
    fileNumber: '',
    name: '',
    dob: '',
    marital: '',
    occupation: '',
    medicalHistory: '',
    surgicalHistory: '',
    allergies: '',
    drugHistory: '',
    pregnancyStatus: '' as '' | 'pregnant' | 'not_pregnant' | 'planning_pregnancy',
    lactationStatus: '' as '' | 'lactating' | 'not_lactating',
    previousTreatments: '' as '' | 'yes' | 'no',
    recentDermTreatments: '' as '' | 'yes' | 'no',
    isotretinoinHistory: '' as '' | 'yes' | 'no',
    phone: '',
    gender: '' as '' | 'male' | 'female',
  })

  useEffect(() => {
    setOverviewEdit(false)
    setOverviewSaveErr('')
  }, [id])

  const startOverviewEdit = useCallback(() => {
    if (!patient) return
    setOverviewDraft({
      fileNumber: patient.fileNumber || '',
      name: patient.name,
      dob: patient.dob || '',
      marital: patient.marital || '',
      occupation: patient.occupation || '',
      medicalHistory: patient.medicalHistory || '',
      surgicalHistory: patient.surgicalHistory || '',
      allergies: patient.allergies || '',
      drugHistory: patient.drugHistory || '',
      pregnancyStatus:
        patient.pregnancyStatus === 'pregnant' ||
        patient.pregnancyStatus === 'not_pregnant' ||
        patient.pregnancyStatus === 'planning_pregnancy'
          ? patient.pregnancyStatus
          : '',
      lactationStatus:
        patient.lactationStatus === 'lactating' || patient.lactationStatus === 'not_lactating'
          ? patient.lactationStatus
          : '',
      previousTreatments:
        patient.previousTreatments === 'yes' || patient.previousTreatments === 'no'
          ? patient.previousTreatments
          : '',
      recentDermTreatments:
        patient.recentDermTreatments === 'yes' || patient.recentDermTreatments === 'no'
          ? patient.recentDermTreatments
          : '',
      isotretinoinHistory:
        patient.isotretinoinHistory === 'yes' || patient.isotretinoinHistory === 'no'
          ? patient.isotretinoinHistory
          : '',
      phone: patient.phone || '',
      gender: patient.gender === 'male' || patient.gender === 'female' ? patient.gender : '',
    })
    setOverviewSaveErr('')
    setOverviewEdit(true)
  }, [patient])

  const cancelOverviewEdit = useCallback(() => {
    setOverviewEdit(false)
    setOverviewSaveErr('')
  }, [])

  const saveOverview = useCallback(async () => {
    if (!id || !patient) return
    if (!overviewDraft.fileNumber.trim()) {
      setOverviewSaveErr('رقم الإضبارة مطلوب')
      return
    }
    setOverviewSaving(true)
    setOverviewSaveErr('')
    try {
      const data = await api<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fileNumber: overviewDraft.fileNumber,
          name: overviewDraft.name.trim() || 'مريض',
          dob: overviewDraft.dob,
          marital: overviewDraft.marital,
          occupation: overviewDraft.occupation,
          medicalHistory: overviewDraft.medicalHistory,
          surgicalHistory: overviewDraft.surgicalHistory,
          allergies: overviewDraft.allergies,
          drugHistory: overviewDraft.drugHistory,
          pregnancyStatus: isFemaleMarried(overviewDraft.gender, overviewDraft.marital)
            ? overviewDraft.pregnancyStatus
            : '',
          lactationStatus: isFemaleMarried(overviewDraft.gender, overviewDraft.marital)
            ? overviewDraft.lactationStatus
            : '',
          previousTreatments: overviewDraft.previousTreatments,
          recentDermTreatments: overviewDraft.recentDermTreatments,
          isotretinoinHistory: overviewDraft.isotretinoinHistory,
          phone: overviewDraft.phone,
          gender: overviewDraft.gender,
        }),
      })
      setPatient(data.patient)
      setOverviewEdit(false)
    } catch (e) {
      setOverviewSaveErr(e instanceof ApiError ? e.message : 'تعذر الحفظ')
    } finally {
      setOverviewSaving(false)
    }
  }, [id, patient, overviewDraft])
  const showFemaleMarriedOverview = isFemaleMarried(
    overviewEdit ? overviewDraft.gender : patient?.gender,
    overviewEdit ? overviewDraft.marital : patient?.marital,
  )

  const exportPatientPdf = useCallback(async () => {
    if (!id || !patient) return
    setPdfExporting(true)
    let ch: ClinicalHistorySnapshot | null = clinicalHistory
    let catalog = laserCatalog
    try {
      try {
        ch = await api<ClinicalHistorySnapshot>(
          `/api/patients/${encodeURIComponent(id)}/clinical-history`,
        )
      } catch {
        ch = clinicalHistory
      }
      if (!catalog.length && showOverviewLaser(role)) {
        try {
          const c = await api<{ categories: LaserCategory[] }>('/api/laser/catalog')
          catalog = c.categories
        } catch {
          catalog = []
        }
      }
      const html = buildPatientRecordPrintHtml({
        patient,
        clinicalHistory: ch,
        laserCatalog: catalog,
        role,
        exporterName: user?.name,
        exportedAtLabel: new Date().toLocaleString('ar-SY', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      })
      openHtmlPrintWindow(html)
    } finally {
      setPdfExporting(false)
    }
  }, [id, patient, clinicalHistory, laserCatalog, role, user?.name])

  const laserItemById = useMemo(() => {
    const map = new Map<string, LaserProcedureItem>()
    for (const g of laserProcedureGroups) {
      for (const item of g.items) map.set(item.id, item)
    }
    return map
  }, [laserProcedureGroups])

  const selectedLaserAddonItems = useMemo(
    () =>
      selectedLaserAddonItemIds
        .map((id) => laserItemById.get(id))
        .filter((x): x is LaserProcedureItem => Boolean(x)),
    [selectedLaserAddonItemIds, laserItemById],
  )

  const pricingGender: '' | 'male' | 'female' =
    patient?.gender === 'male' || patient?.gender === 'female' ? patient.gender : ''

  const laserAddonTotalSyp = useMemo(
    () =>
      selectedLaserAddonItems.reduce(
        (sum, item) => sum + resolveLaserItemPriceByPatientGender(item, pricingGender),
        0,
      ),
    [selectedLaserAddonItems, pricingGender],
  )

  const combinedLaserSaveIds = useMemo(
    () => [...new Set([...selectedLaserItemIds, ...selectedLaserAddonItemIds])],
    [selectedLaserItemIds, selectedLaserAddonItemIds],
  )

  const combinedLaserSaveItems = useMemo(
    () =>
      combinedLaserSaveIds
        .map((id) => laserItemById.get(id))
        .filter((x): x is LaserProcedureItem => Boolean(x)),
    [combinedLaserSaveIds, laserItemById],
  )

  useEffect(() => {
    setLaserLineItems((prev) => {
      const mappedPrev = new Map<string, LaserSessionLineInput>(
        prev
          .filter((row) => row.procedureOptionId)
          .map((row) => [
            `${row.procedureOptionId}|${row.isAddon ? 1 : 0}|${row.optionInstance || 1}` as string,
            row,
          ]),
      )
      const nextMappedRows = combinedLaserSaveItems.flatMap((item) => {
        const isAddon = selectedLaserAddonItemIds.includes(item.id)
        const neededRows = item.kind === 'offer' ? Math.max(1, Math.trunc(Number(item.areaCount) || 1)) : 1
        const parsedNames = item.kind === 'offer' ? splitOfferAreaLabels(item.name) : []
        return Array.from({ length: neededRows }, (_, idx) => {
          const optionInstance = idx + 1
          const key = `${item.id}|${isAddon ? 1 : 0}|${optionInstance}`
          const parsedLabel = parsedNames[idx] || ''
          const fallbackLabel = neededRows > 1 ? `${item.name} (${optionInstance})` : item.name
          return createLaserLineRow({
            ...(mappedPrev.get(key) || {}),
            procedureOptionId: item.id,
            optionInstance,
            areaLabel: parsedLabel || fallbackLabel,
            isAddon,
          })
        })
      })
      return nextMappedRows
    })
  }, [combinedLaserSaveItems, selectedLaserAddonItemIds])

  const toggleLaserMainArea = useCallback((itemId: string) => {
    setSelectedLaserItemIds((prev) => (prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId]))
    setSelectedLaserAddonItemIds((prev) => prev.filter((x) => x !== itemId))
  }, [])

  const toggleLaserAddonArea = useCallback((itemId: string) => {
    setSelectedLaserAddonItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId],
    )
    setSelectedLaserItemIds((prev) => prev.filter((x) => x !== itemId))
  }, [])

  const openLaserSessionDetail = useCallback(
    async (s: ClinicalLaserRow) => {
      setLaserDetailActionErr('')
      setLaserSessionDetail(s)
      if (
        laserCatalog.length === 0 &&
        (role === 'super_admin' || role === 'reception' || role === 'laser')
      ) {
        try {
          const data = await api<{ categories: LaserCategory[] }>('/api/laser/catalog')
          setLaserCatalog(data.categories)
        } catch {
          /* أسماء المناطق اختيارية */
        }
      }
    },
    [laserCatalog.length, role],
  )

  const completeLaserSessionClinically = useCallback(async () => {
    if (!id || !laserSessionDetail) return
    setLaserDetailActionErr('')
    setLaserSessionCompleting(true)
    try {
      await api<{ session: { status: string } }>(
        `/api/laser/sessions/${encodeURIComponent(laserSessionDetail.id)}/status`,
        { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) },
      )
      const data = await api<{
        laserSessions: ClinicalLaserRow[]
        dermatologyVisits: ClinicalDermRow[]
        appointments: ClinicalApptRow[]
        dentalPlan: ClinicalDentalSummary
      }>(`/api/patients/${encodeURIComponent(id)}/clinical-history`)
      setClinicalHistory(data)
      const row = data.laserSessions.find((x) => x.id === laserSessionDetail.id)
      if (row) setLaserSessionDetail(row)
    } catch (e) {
      setLaserDetailActionErr(e instanceof ApiError ? e.message : 'تعذر تحديث حالة الجلسة')
    } finally {
      setLaserSessionCompleting(false)
    }
  }, [id, laserSessionDetail])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ patient: Patient }>(`/api/patients/${id}`)
        if (!cancelled) {
          setPatient(data.patient)
          setLoadErr('')
        }
      } catch {
        if (!cancelled) {
          setPatient(null)
          setLoadErr('تعذر تحميل المريض')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ plan: DentalPlanDto }>(`/api/dental/plans/${id}`)
        if (cancelled) return
        setDentalPlan(data.plan)
        if (data.plan?.items?.length) {
          const text = data.plan.items.map((i) => i.label || i.note || '').filter(Boolean).join('\n')
          if (text) setPlanDraft(text)
        }
      } catch {
        if (!cancelled) setDentalPlan(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!id || tab !== 'overview') return
    let cancelled = false
    setClinicalHistoryLoading(true)
    setClinicalHistoryErr('')
    ;(async () => {
      try {
        const data = await api<{
          laserSessions: ClinicalLaserRow[]
          dermatologyVisits: ClinicalDermRow[]
          appointments: ClinicalApptRow[]
          dentalPlan: ClinicalDentalSummary
        }>(`/api/patients/${encodeURIComponent(id)}/clinical-history`)
        if (!cancelled) {
          setClinicalHistory(data)
          setClinicalHistoryErr('')
        }
      } catch {
        if (!cancelled) {
          setClinicalHistory(null)
          setClinicalHistoryErr('تعذر تحميل سجل الجلسات والمعاينات')
        }
      } finally {
        if (!cancelled) setClinicalHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, tab])

  useEffect(() => {
    if (tab !== 'laser' || !role || !canAccessTab(role, 'laser')) return
    let cancelled = false
    ;(async () => {
      setLaserProcedureLoading(true)
      setLaserProcedureErr('')
      try {
        const [catalogData, procData, pricingData] = await Promise.all([
          api<{ categories: LaserCategory[] }>('/api/laser/catalog'),
          api<{ groups: LaserProcedureGroup[] }>('/api/laser/procedure-options'),
          api<{ pricePerPulseSyp: number }>('/api/laser/pricing-settings').catch(() => ({
            pricePerPulseSyp: 0,
          })),
        ])
        if (!cancelled) {
          setLaserCatalog(catalogData.categories)
          setLaserProcedureGroups(procData.groups || [])
          setLaserPricePerPulseSyp(Math.max(0, Math.round(Number(pricingData.pricePerPulseSyp) || 0)))
          setSelectedLaserItemIds((prev) => {
            const validPrev = prev.filter((id) => (procData.groups || []).some((g) => g.items.some((x) => x.id === id)))
            if (!bookedLaserProcedureText) return validPrev

            const byName = new Map<string, string>()
            for (const g of procData.groups || []) {
              for (const item of g.items || []) {
                byName.set(String(item.name || '').trim().toLowerCase(), String(item.id))
              }
            }
            const normalize = (x: string) =>
              x
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ')
            const fullRaw = normalize(bookedLaserProcedureText)

            // 1) Try exact full-string match first (important when offer names themselves include "+")
            const exactFullId = byName.get(fullRaw)
            if (exactFullId) return [exactFullId]

            // 2) Fallback: split by common separators used in booking summaries
            const parsedNames = bookedLaserProcedureText
              .split(/\s*(?:\+|،|,|\/|\\|\||-)\s*/g)
              .map((x) => normalize(x))
              .filter(Boolean)
            const matchedIds = parsedNames
              .map((name) => byName.get(name))
              .filter((id): id is string => Boolean(id))

            return matchedIds.length > 0 ? [...new Set(matchedIds)] : validPrev
          })
        }
      } catch {
        if (!cancelled) {
          setLaserCatalog([])
          setLaserProcedureGroups([])
          setSelectedLaserItemIds([])
          setLaserPricePerPulseSyp(0)
          setLaserProcedureErr('تعذر تحميل مناطق وعروض الليزر')
        }
      } finally {
        if (!cancelled) setLaserProcedureLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, role, bookedLaserProcedureText])

  useEffect(() => {
    if (tab !== 'laser' || !id || !role || !canAccessTab(role, 'laser')) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ sessions: { treatmentNumber: number }[] }>(
          `/api/laser/sessions?patientId=${encodeURIComponent(id)}`,
        )
        if (cancelled) return
        const nums = data.sessions.map((s) => s.treatmentNumber)
        const max = nums.length ? Math.max(...nums) : 0
        setNextTreatmentHint(max ? `آخر: ${max} — التالي عند الحفظ` : 'يُنشأ تلقائياً عند الحفظ')
      } catch {
        if (!cancelled) setNextTreatmentHint('—')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, id, role])

  useEffect(() => {
    if (!id || !role) return
    const needSessions =
      tab === 'sessions' ||
      tab === 'dermatology' ||
      tab === 'laser' ||
      tab === 'dental' ||
      tab === 'solarium'
    if (needSessions) void refreshClinicalSessionLists()
  }, [tab, id, role, refreshClinicalSessionLists])

  useEffect(() => {
    if (tab !== 'sessions' || !role || (role !== 'reception' && role !== 'super_admin')) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ providers: { id: string; name: string }[] }>(
          `/api/clinical/provider-options?department=${encodeURIComponent(recvDept)}`,
        )
        if (cancelled) return
        setRecvProviders(data.providers)
        setRecvProviderId((prev) => {
          if (prev && data.providers.some((p) => p.id === prev)) return prev
          return data.providers[0]?.id ?? ''
        })
      } catch {
        if (!cancelled) {
          setRecvProviders([])
          setRecvProviderId('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, role, recvDept])

  useEffect(() => {
    if (tab !== 'dermatology' || !id || !role || !canAccessTab(role, 'dermatology')) return
    let cancelled = false
    setDermSessionsLoading(true)
    setDermErr('')
    ;(async () => {
      try {
          const itemsRes = await api<{ items: DermatologyMaterialOption[] }>(
            '/api/inventory/items?activeOnly=1&inStockOnly=1&departments=dermatology_private',
          )
        if (cancelled) return
        setDermMaterialsCatalog(itemsRes.items)
      } catch {
        if (!cancelled) setDermErr('تعذر تحميل مواد الجلدية أو الجلسات')
      } finally {
        if (!cancelled) setDermSessionsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, role, tab])

  useEffect(() => {
    if (!id || tab !== 'account') return
    if (role !== 'super_admin' && role !== 'reception') return
    let cancelled = false
    setPortalAccountLoading(true)
    setPortalAccountErr('')
    ;(async () => {
      try {
        const data = await api<{ account: PortalAccountDto }>(
          `/api/patients/${encodeURIComponent(id)}/portal-account`,
        )
        if (!cancelled) setPortalAccount(data.account)
      } catch {
        if (!cancelled) {
          setPortalAccount(null)
          setPortalAccountErr('تعذر تحميل بيانات الحساب')
        }
      } finally {
        if (!cancelled) setPortalAccountLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, tab, role])

  const refreshFinancialLedger = useCallback(async () => {
    if (!id) return
    try {
      const data = await api<{
        summary: { outstandingDebtSyp: number; prepaidCreditSyp: number }
        entries: FinancialEntry[]
      }>(`/api/patients/${encodeURIComponent(id)}/financial-ledger`)
      setFinancialEntries(data.entries || [])
      setPatient((prev) =>
        prev
          ? {
              ...prev,
              outstandingDebtSyp: Number(data.summary?.outstandingDebtSyp) || 0,
              prepaidCreditSyp: Number(data.summary?.prepaidCreditSyp) || 0,
            }
          : prev,
      )
      setFinancialErr('')
    } catch {
      setFinancialEntries([])
      setFinancialErr('تعذر تحميل السجل المالي')
    }
  }, [id])

  useEffect(() => {
    if (!id || tab !== 'financial') return
    if (role !== 'super_admin' && role !== 'reception') return
    let cancelled = false
    setFinancialLoading(true)
    ;(async () => {
      try {
        const data = await api<{
          summary: { outstandingDebtSyp: number; prepaidCreditSyp: number }
          entries: FinancialEntry[]
        }>(`/api/patients/${encodeURIComponent(id)}/financial-ledger`)
        if (cancelled) return
        setFinancialEntries(data.entries || [])
        setPatient((prev) =>
          prev
            ? {
                ...prev,
                outstandingDebtSyp: Number(data.summary?.outstandingDebtSyp) || 0,
                prepaidCreditSyp: Number(data.summary?.prepaidCreditSyp) || 0,
              }
            : prev,
        )
        setFinancialErr('')
      } catch {
        if (!cancelled) {
          setFinancialEntries([])
          setFinancialErr('تعذر تحميل السجل المالي')
        }
      } finally {
        if (!cancelled) setFinancialLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, tab, role])

  const visibleTabs = useMemo(() => {
    const allTabs: { key: Tab; label: string }[] = [
      { key: 'overview', label: 'نظرة عامة' },
      { key: 'account', label: 'الحساب' },
      { key: 'packages', label: 'باكج' },
      { key: 'financial', label: 'مالية' },
      { key: 'sessions', label: 'جلسات / تحصيل' },
      { key: 'laser', label: 'الليزر' },
      { key: 'dermatology', label: 'الجلدية' },
      { key: 'dental', label: 'الأسنان' },
      { key: 'solarium', label: 'السولاريوم' },
    ]
    if (!role) {
      return allTabs.filter((t) => t.key === 'overview')
    }
    const showAccount = role === 'super_admin' || role === 'reception'
    const showSessionsTab = role === 'super_admin' || role === 'reception'
    return allTabs.filter(
      (t) =>
        t.key === 'overview' ||
        (t.key === 'account' && showAccount) ||
        (t.key === 'packages' && showAccount) ||
        (t.key === 'sessions' && showSessionsTab) ||
        (t.key === 'financial' && showAccount) ||
        (t.key === 'laser' && canAccessTab(role, 'laser')) ||
        (t.key === 'dermatology' && canAccessTab(role, 'dermatology')) ||
        (t.key === 'dental' && canAccessTab(role, 'dental')) ||
        (t.key === 'solarium' && canAccessTab(role, 'solarium')),
    )
  }, [role])

  useEffect(() => {
    const allowed = visibleTabs.some((t) => t.key === tab)
    if (!allowed) setTab('overview')
  }, [tab, visibleTabs])

  const cycleTooth = useCallback((n: number) => {
    setToothState((prev) => {
      const order: ('healthy' | 'planned' | 'treated')[] = ['healthy', 'planned', 'treated']
      const i = order.indexOf(prev[n] ?? 'healthy')
      return { ...prev, [n]: order[(i + 1) % order.length] }
    })
  }, [])

  const patientPackages: PatientPackage[] = useMemo(() => {
    if (!patient) return []
    const rows = Array.isArray(patient.sessionPackages) ? patient.sessionPackages : []
    return rows
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .map((x) => ({
        id: String(x.id),
        department: 'laser',
        title: String(x.title || ''),
        sessionsCount: Number(x.sessionsCount) || 0,
        packageTotalSyp: Number(x.packageTotalSyp) || 0,
        paidAmountSyp: Number(x.paidAmountSyp) || 0,
        settlementDeltaSyp: Number(x.settlementDeltaSyp) || 0,
        notes: String(x.notes || ''),
        createdAt: x.createdAt ?? null,
        sessions: Array.isArray(x.sessions)
          ? x.sessions.map((s) => ({
              id: String(s.id),
              label: String(s.label || ''),
              completedByReception: s.completedByReception === true,
              completedAt: s.completedAt ?? null,
              completedByUserId: s.completedByUserId ?? null,
              linkedLaserSessionId: s.linkedLaserSessionId ?? null,
              linkedBillingItemId: s.linkedBillingItemId ?? null,
            }))
          : [],
      }))
  }, [patient])

  const activeLaserPackage = useMemo(() => {
    return patientPackages.find(
      (pkg) => pkg.department === 'laser' && pkg.sessions.some((s) => !s.linkedLaserSessionId),
    )
  }, [patientPackages])

  const laserLineItemsWithPricing = useMemo(
    () => {
      const distributedAreaPriceByIndex = new Map<number, number>()
      const nonPulseGrouped = new Map<string, number[]>()

      laserLineItems.forEach((row, idx) => {
        if (!row.procedureOptionId || row.chargeByPulseCount) return
        const k = `${row.procedureOptionId}|${row.isAddon ? 1 : 0}`
        if (!nonPulseGrouped.has(k)) nonPulseGrouped.set(k, [])
        nonPulseGrouped.get(k)?.push(idx)
      })

      for (const [, indexes] of nonPulseGrouped.entries()) {
        if (!indexes.length) continue
        const sample = laserLineItems[indexes[0]]
        if (!sample?.procedureOptionId) continue
        const linked = laserItemById.get(sample.procedureOptionId)
        const fullAreaPrice = linked ? resolveLaserItemPriceByPatientGender(linked, pricingGender) : 0
        const count = indexes.length
        const base = Math.floor(fullAreaPrice / count)
        const remainder = fullAreaPrice - base * count
        indexes.forEach((idx, pos) => {
          distributedAreaPriceByIndex.set(idx, base + (pos < remainder ? 1 : 0))
        })
      }

      return laserLineItems.map((row, idx) => {
        const linked = row.procedureOptionId ? laserItemById.get(row.procedureOptionId) : undefined
        const areaPrice = linked ? resolveLaserItemPriceByPatientGender(linked, pricingGender) : 0
        const shots = parseLaserShotsForPricing(row.shotCount)
        const ppuSyp = Math.max(0, Math.round(Number(laserPricePerPulseSyp) || 0))
        const pulseCost = row.chargeByPulseCount && shots > 0 && ppuSyp > 0 ? ppuSyp * shots : 0
        const distributedAreaPrice = distributedAreaPriceByIndex.get(idx)
        const lineCostSyp = row.chargeByPulseCount ? pulseCost : distributedAreaPrice ?? areaPrice
        return { ...row, lineCostSyp, shots }
      })
    },
    [laserLineItems, laserItemById, pricingGender, laserPricePerPulseSyp],
  )

  const selectedLaserTotalSyp = useMemo(
    () => laserLineItemsWithPricing.reduce((sum, row) => sum + (Number(row.lineCostSyp) || 0), 0),
    [laserLineItemsWithPricing],
  )

  useEffect(() => {
    if (!activeLaserPackage) setSelectedLaserAddonItemIds([])
  }, [activeLaserPackage])

  const dentalPlanApproved = dentalPlan?.status === 'approved'
  const dentalPlanSummary =
    dentalPlan?.items
      ?.map((i) => i.label || i.note)
      .filter(Boolean)
      .join(' — ') || '—'

  function addDermMaterialRow() {
    setDermSelectedMaterials((prev) => [...prev, { inventoryItemId: '', quantity: '1' }])
  }

  function removeDermMaterialRow(idx: number) {
    setDermSelectedMaterials((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateDermMaterialRow(
    idx: number,
    field: 'inventoryItemId' | 'quantity',
    value: string,
  ) {
    setDermSelectedMaterials((prev) => prev.map((line, i) => (i === idx ? { ...line, [field]: value } : line)))
  }

  const dermMaterialsCostTotal = useMemo(
    () =>
      Math.round(
        dermSelectedMaterials.reduce((sum, line) => {
          const qty = Math.max(0, Number.parseFloat(String(line.quantity || '')) || 0)
          if (!line.inventoryItemId || qty <= 0) return sum
          const item = dermMaterialsCatalog.find((x) => x.id === line.inventoryItemId)
          if (!item) return sum
          const unitCost = Math.max(0, Math.round(Number(item.unitCost) || 0))
          return sum + qty * unitCost
        }, 0),
      ),
    [dermSelectedMaterials, dermMaterialsCatalog],
  )

  if (loadErr || (!patient && !loadErr)) {
    if (!patient && !loadErr) {
      return (
        <div className="empty-state">
          جاري التحميل…
        </div>
      )
    }
    return (
      <div className="empty-state">
        {loadErr || 'المريض غير موجود'}
        <div>
          <Link to="/patients" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '1rem' }}>
            العودة للبحث
          </Link>
        </div>
      </div>
    )
  }

  if (!patient || !role) return null

  const renderMoneySyp = (sypValue: number) => {
    const n = Math.round(Number(sypValue) || 0)
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString('ar-SY')} ل.س</span>
    )
  }

  const financialNonMatchingEntries = financialEntries.filter((x) => {
    if (x.settlementType === 'debt' || x.settlementType === 'credit') return true
    return Math.abs(Number(x.settlementDeltaSyp) || 0) > 0.0001
  })
  let remainingDebt = Number(patient.outstandingDebtSyp) || 0
  let remainingCredit = Number(patient.prepaidCreditSyp) || 0
  const financialOpenEntries = financialNonMatchingEntries
    .map((entry) => {
      const delta = Number(entry.settlementDeltaSyp) || 0
      if (delta < 0) {
        if (!(remainingDebt > 0)) return null
        const unresolved = Math.min(Math.abs(delta), remainingDebt)
        remainingDebt -= unresolved
        return {
          ...entry,
          settlementType: 'debt',
          settlementDeltaSyp: -Math.round(unresolved * 100) / 100,
        }
      }
      if (delta > 0) {
        if (!(remainingCredit > 0)) return null
        const unresolved = Math.min(delta, remainingCredit)
        remainingCredit -= unresolved
        return {
          ...entry,
          settlementType: 'credit',
          settlementDeltaSyp: Math.round(unresolved * 100) / 100,
        }
      }
      return null
    })
    .filter((x): x is FinancialEntry => x != null)

  if (remainingDebt > 0.0001) {
    financialOpenEntries.push({
      id: 'synthetic-debt',
      billingItemId: '',
      businessDate: clinicBusinessDate || '',
      procedureLabel: 'ذمة متبقية على المريض',
      amountDueSyp: remainingDebt,
      appliedAmountSyp: 0,
      receivedAmountSyp: 0,
      settlementDeltaSyp: -Math.round(remainingDebt * 100) / 100,
      settlementType: 'debt',
      method: 'manual',
      receivedAt: null,
      receivedByName: '',
    })
  }
  if (remainingCredit > 0.0001) {
    financialOpenEntries.push({
      id: 'synthetic-credit',
      billingItemId: '',
      businessDate: clinicBusinessDate || '',
      procedureLabel: 'رصيد إضافي متبقٍ للمريض',
      amountDueSyp: 0,
      appliedAmountSyp: 0,
      receivedAmountSyp: remainingCredit,
      settlementDeltaSyp: Math.round(remainingCredit * 100) / 100,
      settlementType: 'credit',
      method: 'manual',
      receivedAt: null,
      receivedByName: '',
    })
  }

  const debtNow = Math.round(Number(patient.outstandingDebtSyp) || 0)
  const settlePreviewSyp = Math.max(0, Math.round(parseFloat(financialSettleSyp) || 0))
  const settleEnteredSyp = settlePreviewSyp
  const settleWillCoverSyp = Math.min(debtNow, settleEnteredSyp)
  const settleWillRemainDebtSyp = Math.max(0, debtNow - settleEnteredSyp)
  const settleWillAddCreditSyp = Math.max(0, settleEnteredSyp - debtNow)

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/patients" style={{ fontSize: '0.9rem' }}>
          ← المرضى
        </Link>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.15rem' }}>
            {patient.name}
          </h1>
          <p className="page-desc" style={{ margin: 0 }}>
            ملف المريض — تبويبات حسب الصلاحية
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pdfExporting}
          onClick={() => void exportPatientPdf()}
        >
          {pdfExporting ? 'جاري التجهيز…' : 'تصدير الملف PDF'}
        </button>
      </div>

      <div className="tabs patient-record-tabs" role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-tab-key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="card">
          {canEditPatientProfile ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                flexWrap: 'wrap',
                marginBottom: '0.85rem',
              }}
            >
              {!overviewEdit ? (
                <button type="button" className="btn btn-secondary" onClick={startOverviewEdit}>
                  تعديل البيانات
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={overviewSaving}
                    onClick={cancelOverviewEdit}
                  >
                    إلغاء
                  </button>
                  <button type="button" className="btn btn-primary" disabled={overviewSaving} onClick={() => void saveOverview()}>
                    {overviewSaving ? 'جاري الحفظ…' : 'حفظ'}
                  </button>
                </>
              )}
            </div>
          ) : null}
          {overviewSaveErr ? (
            <p style={{ color: 'var(--danger)', margin: '0 0 0.75rem', fontSize: '0.9rem' }}>{overviewSaveErr}</p>
          ) : null}
          {canEditPatientProfile && overviewEdit ? (
            <>
              <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div>
                  <label className="form-label" htmlFor="ov-file-number">
                    رقم الإضبارة
                  </label>
                  <input
                    id="ov-file-number"
                    className="input"
                    value={overviewDraft.fileNumber}
                    onChange={(e) => setOverviewDraft((d) => ({ ...d, fileNumber: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="ov-name">
                    الاسم الكامل
                  </label>
                  <input
                    id="ov-name"
                    className="input"
                    value={overviewDraft.name}
                    onChange={(e) => setOverviewDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </div>
                <div className="grid-2">
                  <div>
                    <label className="form-label" htmlFor="ov-dob">
                      تاريخ الميلاد
                    </label>
                    <input
                      id="ov-dob"
                      type="date"
                      className="input"
                      value={overviewDraft.dob}
                      onChange={(e) => setOverviewDraft((d) => ({ ...d, dob: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ov-marital">
                      الحالة الاجتماعية
                    </label>
                    <input
                      id="ov-marital"
                      className="input"
                      value={overviewDraft.marital}
                      onChange={(e) => setOverviewDraft((d) => ({ ...d, marital: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ov-occupation">
                      المهنة
                    </label>
                    <input
                      id="ov-occupation"
                      className="input"
                      value={overviewDraft.occupation}
                      onChange={(e) => setOverviewDraft((d) => ({ ...d, occupation: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ov-phone">
                      الهاتف
                    </label>
                    <input
                      id="ov-phone"
                      className="input"
                      dir="ltr"
                      style={{ textAlign: 'right' }}
                      value={overviewDraft.phone}
                      onChange={(e) => setOverviewDraft((d) => ({ ...d, phone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ov-gender">
                      الجنس
                    </label>
                    <select
                      id="ov-gender"
                      className="input"
                      value={overviewDraft.gender}
                      onChange={(e) =>
                        setOverviewDraft((d) => ({
                          ...d,
                          gender: e.target.value as '' | 'male' | 'female',
                        }))
                      }
                    >
                      <option value="">{GENDER_LABELS['']}</option>
                      <option value="male">{GENDER_LABELS.male}</option>
                      <option value="female">{GENDER_LABELS.female}</option>
                    </select>
                  </div>
                </div>
              </div>
              <h3 className="card-title" style={{ fontSize: '0.95rem' }}>
                التاريخ الطبي العام
              </h3>
              <div className="grid-2">
                <div className="fieldset">
                  <legend>سوابق مرضية</legend>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={overviewDraft.medicalHistory}
                    onChange={(e) => setOverviewDraft((d) => ({ ...d, medicalHistory: e.target.value }))}
                  />
                </div>
                <div className="fieldset">
                  <legend>سوابق جراحية</legend>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={overviewDraft.surgicalHistory}
                    onChange={(e) => setOverviewDraft((d) => ({ ...d, surgicalHistory: e.target.value }))}
                  />
                </div>
                <div className="fieldset" style={{ gridColumn: '1 / -1' }}>
                  <legend>تحسس</legend>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={overviewDraft.allergies}
                    onChange={(e) => setOverviewDraft((d) => ({ ...d, allergies: e.target.value }))}
                  />
                </div>
                <div className="fieldset" style={{ gridColumn: '1 / -1' }}>
                  <legend>سوابق دوائية</legend>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={overviewDraft.drugHistory}
                    onChange={(e) => setOverviewDraft((d) => ({ ...d, drugHistory: e.target.value }))}
                  />
                </div>
                <div className="fieldset">
                  <legend>هل يوجد معالجات سابقة؟</legend>
                  <select
                    className="input"
                    value={overviewDraft.previousTreatments}
                    onChange={(e) =>
                      setOverviewDraft((d) => ({
                        ...d,
                        previousTreatments: e.target.value as '' | 'yes' | 'no',
                      }))
                    }
                  >
                    <option value="">{YES_NO_LABELS['']}</option>
                    <option value="yes">{YES_NO_LABELS.yes}</option>
                    <option value="no">{YES_NO_LABELS.no}</option>
                  </select>
                </div>
                <div className="fieldset">
                  <legend>علاجات جلدية قريبة</legend>
                  <select
                    className="input"
                    value={overviewDraft.recentDermTreatments}
                    onChange={(e) =>
                      setOverviewDraft((d) => ({
                        ...d,
                        recentDermTreatments: e.target.value as '' | 'yes' | 'no',
                      }))
                    }
                  >
                    <option value="">{YES_NO_LABELS['']}</option>
                    <option value="yes">{YES_NO_LABELS.yes}</option>
                    <option value="no">{YES_NO_LABELS.no}</option>
                  </select>
                </div>
                <div className="fieldset">
                  <legend>قصة علاج بالريتان</legend>
                  <select
                    className="input"
                    value={overviewDraft.isotretinoinHistory}
                    onChange={(e) =>
                      setOverviewDraft((d) => ({
                        ...d,
                        isotretinoinHistory: e.target.value as '' | 'yes' | 'no',
                      }))
                    }
                  >
                    <option value="">{YES_NO_LABELS['']}</option>
                    <option value="yes">{YES_NO_LABELS.yes}</option>
                    <option value="no">{YES_NO_LABELS.no}</option>
                  </select>
                </div>
                {showFemaleMarriedOverview ? (
                  <>
                    <div className="fieldset">
                      <legend>الحمل</legend>
                      <select
                        className="input"
                        value={overviewDraft.pregnancyStatus}
                        onChange={(e) =>
                          setOverviewDraft((d) => ({
                            ...d,
                            pregnancyStatus: e.target.value as '' | 'pregnant' | 'not_pregnant' | 'planning_pregnancy',
                          }))
                        }
                      >
                        <option value="">{PREGNANCY_LABELS['']}</option>
                        <option value="pregnant">{PREGNANCY_LABELS.pregnant}</option>
                        <option value="not_pregnant">{PREGNANCY_LABELS.not_pregnant}</option>
                        <option value="planning_pregnancy">{PREGNANCY_LABELS.planning_pregnancy}</option>
                      </select>
                    </div>
                    <div className="fieldset">
                      <legend>الإرضاع</legend>
                      <select
                        className="input"
                        value={overviewDraft.lactationStatus}
                        onChange={(e) =>
                          setOverviewDraft((d) => ({
                            ...d,
                            lactationStatus: e.target.value as '' | 'lactating' | 'not_lactating',
                          }))
                        }
                      >
                        <option value="">{LACTATION_LABELS['']}</option>
                        <option value="lactating">{LACTATION_LABELS.lactating}</option>
                        <option value="not_lactating">{LACTATION_LABELS.not_lactating}</option>
                      </select>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div>
                  <span className="form-label">رقم الإضبارة</span>
                  <div style={{ fontWeight: 600 }}>{patient.fileNumber || '—'}</div>
                </div>
                <div>
                  <span className="form-label">الاسم الكامل</span>
                  <div style={{ fontWeight: 600 }}>{patient.name}</div>
                </div>
                <div className="grid-2">
                  <div>
                    <span className="form-label">تاريخ الميلاد</span>
                    <div>{patient.dob?.trim() ? patient.dob : '—'}</div>
                  </div>
                  <div>
                    <span className="form-label">الحالة الاجتماعية</span>
                    <div>{patient.marital?.trim() ? patient.marital : '—'}</div>
                  </div>
                  <div>
                    <span className="form-label">المهنة</span>
                    <div>{patient.occupation?.trim() ? patient.occupation : '—'}</div>
                  </div>
                  <div>
                    <span className="form-label">الهاتف</span>
                    <div dir="ltr" style={{ textAlign: 'right' }}>
                      {patient.phone?.trim() ? patient.phone : '—'}
                    </div>
                  </div>
                  <div>
                    <span className="form-label">الجنس</span>
                    <div>
                      {GENDER_LABELS[
                        patient.gender === 'male' || patient.gender === 'female' ? patient.gender : ''
                      ]}
                    </div>
                  </div>
                </div>
              </div>
              <h3 className="card-title" style={{ fontSize: '0.95rem' }}>
                التاريخ الطبي العام
              </h3>
              <div className="grid-2">
                <div className="fieldset">
                  <legend>سوابق مرضية</legend>
                  <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {patient.medicalHistory?.trim() ? patient.medicalHistory : '—'}
                  </p>
                </div>
                <div className="fieldset">
                  <legend>سوابق جراحية</legend>
                  <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {patient.surgicalHistory?.trim() ? patient.surgicalHistory : '—'}
                  </p>
                </div>
                <div className="fieldset" style={{ gridColumn: '1 / -1' }}>
                  <legend>تحسس</legend>
                  <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {patient.allergies?.trim() ? patient.allergies : '—'}
                  </p>
                </div>
                <div className="fieldset" style={{ gridColumn: '1 / -1' }}>
                  <legend>سوابق دوائية</legend>
                  <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {patient.drugHistory?.trim() ? patient.drugHistory : '—'}
                  </p>
                </div>
                <div className="fieldset">
                  <legend>هل يوجد معالجات سابقة؟</legend>
                  <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {YES_NO_LABELS[
                      patient.previousTreatments === 'yes' || patient.previousTreatments === 'no'
                        ? patient.previousTreatments
                        : ''
                    ]}
                  </p>
                </div>
                <div className="fieldset">
                  <legend>علاجات جلدية قريبة</legend>
                  <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {YES_NO_LABELS[
                      patient.recentDermTreatments === 'yes' || patient.recentDermTreatments === 'no'
                        ? patient.recentDermTreatments
                        : ''
                    ]}
                  </p>
                </div>
                <div className="fieldset">
                  <legend>قصة علاج بالريتان</legend>
                  <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {YES_NO_LABELS[
                      patient.isotretinoinHistory === 'yes' || patient.isotretinoinHistory === 'no'
                        ? patient.isotretinoinHistory
                        : ''
                    ]}
                  </p>
                </div>
                {showFemaleMarriedOverview ? (
                  <>
                    <div className="fieldset">
                      <legend>الحمل</legend>
                      <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                        {PREGNANCY_LABELS[
                          patient.pregnancyStatus === 'pregnant' ||
                          patient.pregnancyStatus === 'not_pregnant' ||
                          patient.pregnancyStatus === 'planning_pregnancy'
                            ? patient.pregnancyStatus
                            : ''
                        ]}
                      </p>
                    </div>
                    <div className="fieldset">
                      <legend>الإرضاع</legend>
                      <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                        {LACTATION_LABELS[
                          patient.lactationStatus === 'lactating' || patient.lactationStatus === 'not_lactating'
                            ? patient.lactationStatus
                            : ''
                        ]}
                      </p>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          )}

          <h3 className="card-title" style={{ fontSize: '0.95rem', marginTop: '1.5rem' }}>
            سجل الجلسات والمعاينات والمواعيد
          </h3>
          <p className="page-desc" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
            {clinicalHistoryIntro(role)}
          </p>
          {clinicalHistoryLoading ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل السجل…</p>
          ) : clinicalHistoryErr ? (
            <p style={{ color: 'var(--danger)', margin: 0 }}>{clinicalHistoryErr}</p>
          ) : clinicalHistory ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {showOverviewAppointments(role) ? (
                <div>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    المواعيد المحجوزة
                    {role === 'dermatology' ||
                    role === 'dermatology_manager' ||
                    role === 'dermatology_assistant_manager' ||
                    role === 'dental_branch' ? (
                      <span style={{ fontWeight: 400, fontSize: '0.8rem', marginRight: '0.35rem' }}>
                        (المسجّلة باسمك كمقدّم)
                      </span>
                    ) : null}
                  </h4>
                  {clinicalHistory.appointments.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      لا مواعيد في النطاق المعروض.
                    </p>
                  ) : (
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>التاريخ</th>
                            <th>المقدّم</th>
                            <th>نوع الإجراء</th>
                            <th>الوقت</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clinicalHistory.appointments.map((a) => (
                            <tr key={a.id}>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{a.businessDate}</td>
                              <td>{a.providerName}</td>
                              <td>{a.procedureType || '—'}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {a.time}
                                {a.endTime ? ` — ${a.endTime}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {showOverviewLaser(role) ? (
                <div>
                  <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    جلسات الليزر
                  </h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                    اضغط على صف لعرض كل بيانات الجلسة.
                  </p>
                  {clinicalHistory.laserSessions.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      لا جلسات ليزر مسجّلة.
                    </p>
                  ) : (
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>رقم المعالجة</th>
                            <th>التاريخ والوقت</th>
                            <th>النوع / الغرفة</th>
                            <th>الحالة</th>
                            <th>المعالج</th>
                            <th>المناطق</th>
                            <th>التحصيل</th>
                            <th>ملاحظات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clinicalHistory.laserSessions.map((s) => (
                            <tr
                              key={s.id}
                              style={{ cursor: 'pointer' }}
                              title="عرض التفاصيل الكاملة"
                              onClick={() => void openLaserSessionDetail(s)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  void openLaserSessionDetail(s)
                                }
                              }}
                              tabIndex={0}
                              role="button"
                            >
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.treatmentNumber}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                {formatClinicDate(s.createdAt)}
                              </td>
                              <td>
                                {s.laserType} — غرفة {s.room}
                              </td>
                              <td>{laserStatusAr[s.status] ?? s.status}</td>
                              <td>{s.operatorName}</td>
                              <td style={{ fontSize: '0.85rem', maxWidth: 200 }}>
                                {s.areaIds?.length
                                  ? `${s.areaIds.length} منطقة: ${s.areaIds.join('، ')}`
                                  : '—'}
                              </td>
                              <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                {formatLaserCollectedSyp(s.collectedAmountSyp ?? null)}
                              </td>
                              <td style={{ fontSize: '0.85rem' }}>{s.notes?.trim() || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {showOverviewDerm(role) ? (
                <div>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    معاينات وإجراءات الجلدية
                    {role === 'dermatology' ||
                    role === 'dermatology_manager' ||
                    role === 'dermatology_assistant_manager' ? (
                      <span style={{ fontWeight: 400, fontSize: '0.8rem', marginRight: '0.35rem' }}>
                        (المسجّلة باسمك كمقدّم)
                      </span>
                    ) : null}
                  </h4>
                  {clinicalHistory.dermatologyVisits.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      لا معاينات جلدية في النطاق المعروض.
                    </p>
                  ) : (
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>يوم العمل</th>
                            <th>نوع الجلسة</th>
                            <th>المنطقة / المعالجة</th>
                            <th>المقدّم</th>
                            <th>الكلفة (ل.س)</th>
                            <th>الحسم</th>
                            <th>ملاحظات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clinicalHistory.dermatologyVisits.map((v) => (
                            <tr key={v.id}>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{v.businessDate}</td>
                              <td>{v.sessionType || '—'}</td>
                              <td>{v.areaTreatment || '—'}</td>
                              <td>{v.providerName}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{v.costSyp}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{v.discountPercent}%</td>
                              <td style={{ fontSize: '0.85rem' }}>{v.notes?.trim() || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {showOverviewDentalSummary(role) ? (
                <div>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    خطة الأسنان (ملخص)
                  </h4>
                  {!clinicalHistory.dentalPlan ? (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      لا خطة أسنان مسجّلة لهذا المريض.
                    </p>
                  ) : (
                    <div
                      style={{
                        padding: '0.75rem 1rem',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        fontSize: '0.9rem',
                      }}
                    >
                      <p style={{ margin: '0 0 0.5rem' }}>
                        الحالة:{' '}
                        <strong>
                          {clinicalHistory.dentalPlan.status === 'approved' ? 'معتمدة' : 'مسودّة'}
                        </strong>
                        {clinicalHistory.dentalPlan.approvedAt
                          ? ` — ${formatClinicDate(clinicalHistory.dentalPlan.approvedAt)}`
                          : null}
                      </p>
                      {clinicalHistory.dentalPlan.items?.length ? (
                        <ul style={{ margin: 0, paddingRight: '1.25rem' }}>
                          {clinicalHistory.dentalPlan.items.map((it, idx) => (
                            <li key={idx}>
                              {it.label || it.note || `سن ${it.tooth ?? '—'}`}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: 0, color: 'var(--text-muted)' }}>لا بنود في الخطة.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {tab === 'account' && (role === 'super_admin' || role === 'reception') && (
        <div className="card">
          <h2 className="card-title">حساب بوابة المريض</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.35rem', lineHeight: 1.55 }}>
            يستخدم المريض اسم المستخدم وكلمة المرور للدخول إلى{' '}
            <strong dir="ltr" style={{ fontSize: '0.85rem' }}>
              /login
            </strong>
            — لا تُشارك البيانات إلا مع المريض مباشرة. كلمة المرور لا تُخزَّن نصاً ولا يمكن استرجاعها؛ يمكن
            إنشاء كلمة جديدة عند الحاجة.
          </p>
          {portalAccountLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
          ) : portalAccountErr ? (
            <p style={{ color: 'var(--danger)' }}>{portalAccountErr}</p>
          ) : portalAccount ? (
            <div style={{ display: 'grid', gap: '1rem', marginTop: '0.75rem' }}>
              <div
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  gridTemplateColumns: 'minmax(6rem, auto) 1fr',
                  fontSize: '0.9rem',
                  alignItems: 'start',
                }}
              >
                <span className="form-label" style={{ margin: 0 }}>
                  اسم المستخدم
                </span>
                <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {portalAccount.hasPortal ? portalAccount.username : '—'}
                </span>
                <span className="form-label" style={{ margin: 0 }}>
                  حالة الحساب
                </span>
                <span>
                  {portalAccount.hasPortal
                    ? portalAccount.portalEnabled
                      ? 'مفعّل'
                      : 'موقوف'
                    : 'غير مُنشأ'}
                </span>
                <span className="form-label" style={{ margin: 0 }}>
                  آخر دخول
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {portalAccount.lastLoginAt ? formatClinicDate(portalAccount.lastLoginAt) : '—'}
                </span>
                <span className="form-label" style={{ margin: 0 }}>
                  ملاحظة أمنية
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                  {portalAccount.mustChangePassword
                    ? 'يُطلب من المريض تغيير كلمة المرور عند أول دخول بعد آخر إصدار.'
                    : 'لا يوجد إلزام بتغيير كلمة المرور حالياً.'}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {!portalAccount.hasPortal ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={portalActionBusy}
                    onClick={() => {
                      if (!id) return
                      setPortalActionBusy(true)
                      ;(async () => {
                        try {
                          const data = await api<{
                            account: PortalAccountDto
                            portalCredentials: { username: string; password: string }
                          }>(`/api/patients/${encodeURIComponent(id)}/portal/provision`, { method: 'POST' })
                          setPortalAccount(data.account)
                          setPortalRevealCreds({
                            username: data.portalCredentials.username,
                            password: data.portalCredentials.password,
                          })
                        } catch (e) {
                          window.alert(e instanceof ApiError ? e.message : 'تعذر الإنشاء')
                        } finally {
                          setPortalActionBusy(false)
                        }
                      })()
                    }}
                  >
                    {portalActionBusy ? 'جاري الإنشاء…' : 'إنشاء حساب بوابة'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={portalActionBusy}
                      onClick={() => {
                        if (!id || !portalAccount.username) return
                        void navigator.clipboard.writeText(portalAccount.username)
                      }}
                    >
                      نسخ اسم المستخدم
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={portalActionBusy}
                      onClick={() => {
                        if (!id) return
                        setPortalActionBusy(true)
                        ;(async () => {
                          try {
                            const data = await api<{
                              username: string
                              password: string
                              account: PortalAccountDto
                            }>(`/api/patients/${encodeURIComponent(id)}/portal/regenerate-password`, {
                              method: 'POST',
                            })
                            setPortalAccount(data.account)
                            setPortalRevealCreds({ username: data.username, password: data.password })
                          } catch (e) {
                            window.alert(e instanceof ApiError ? e.message : 'تعذر التجديد')
                          } finally {
                            setPortalActionBusy(false)
                          }
                        })()
                      }}
                    >
                      {portalActionBusy ? 'جاري التجديد…' : 'إصدار كلمة مرور جديدة'}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {tab === 'packages' && (role === 'super_admin' || role === 'reception') && (
        <div className="card">
          <h2 className="card-title">باكج جلسات الليزر</h2>
          <p style={{ marginTop: '-0.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            يقوم الاستقبال بتحديد عدد الجلسات وسعر الباكج والمبلغ المدفوع. عند دفع أقل من إجمالي الباكج يتم إضافة
            الفرق إلى ذمم المريض تلقائياً.
          </p>
          <div className="grid-2" style={{ marginTop: '0.75rem' }}>
            <div>
              <label className="form-label">اسم الباكج (اختياري)</label>
              <input
                className="input"
                value={packageTitle}
                onChange={(e) => setPackageTitle(e.target.value)}
                placeholder="مثال: باكج ليزر 6 جلسات"
              />
            </div>
            <div>
              <label className="form-label">عدد الجلسات</label>
              <input
                className="input"
                inputMode="numeric"
                value={packageSessionsCount}
                onChange={(e) => setPackageSessionsCount(e.target.value)}
                placeholder="6"
              />
            </div>
            <div>
              <label className="form-label">إجمالي سعر الباكج (ل.س)</label>
              <input
                className="input"
                inputMode="decimal"
                value={packageTotalSyp}
                onChange={(e) => setPackageTotalSyp(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className="form-label">المدفوع حالياً (ل.س)</label>
              <input
                className="input"
                inputMode="decimal"
                value={packagePaidSyp}
                onChange={(e) => setPackagePaidSyp(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <label className="form-label">ملاحظات</label>
            <textarea
              className="textarea"
              rows={2}
              value={packageNotes}
              onChange={(e) => setPackageNotes(e.target.value)}
              placeholder="ملاحظات إضافية على الباكج..."
            />
          </div>
          {packageErr ? <p style={{ color: 'var(--danger)', marginTop: '0.65rem' }}>{packageErr}</p> : null}
          {packageOk ? <p style={{ color: 'var(--success)', marginTop: '0.65rem' }}>{packageOk}</p> : null}
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '0.9rem' }}
            disabled={packageBusy}
            onClick={async () => {
              if (!id) return
              setPackageErr('')
              setPackageOk('')
              const sessionsCount = Math.max(1, parseInt(packageSessionsCount || '0', 10) || 0)
              if (!sessionsCount) {
                setPackageErr('حدد عدد جلسات صالح.')
                return
              }
              const totalSyp = Math.max(0, Math.round(parseFloat(packageTotalSyp) || 0))
              const paidSyp = Math.max(0, Math.round(parseFloat(packagePaidSyp) || 0))
              if (!(totalSyp > 0)) {
                setPackageErr('أدخل إجمالي سعر الباكج بالليرة.')
                return
              }
              if (paidSyp < 0 || paidSyp > totalSyp) {
                setPackageErr('المبلغ المدفوع يجب أن يكون بين 0 وإجمالي الباكج.')
                return
              }
              setPackageBusy(true)
              try {
                const data = await api<{
                  package: PatientPackage
                  summary: { outstandingDebtSyp: number; prepaidCreditSyp: number }
                }>(`/api/patients/${encodeURIComponent(id)}/packages`, {
                  method: 'POST',
                  body: JSON.stringify({
                    department: 'laser',
                    title: packageTitle.trim() || undefined,
                    sessionsCount,
                    packageTotalSyp: totalSyp,
                    paidAmountSyp: paidSyp,
                    notes: packageNotes.trim(),
                  }),
                })
                setPatient((prev) =>
                  prev
                    ? {
                        ...prev,
                        outstandingDebtSyp: Number(data.summary?.outstandingDebtSyp) || 0,
                        prepaidCreditSyp: Number(data.summary?.prepaidCreditSyp) || 0,
                        sessionPackages: [...(Array.isArray(prev.sessionPackages) ? prev.sessionPackages : []), data.package],
                      }
                    : prev,
                )
                setPackageOk('تم حفظ الباكج بنجاح.')
                setPackageTitle('')
                setPackageSessionsCount('6')
                setPackageTotalSyp('')
                setPackagePaidSyp('')
                setPackageNotes('')
              } catch (e) {
                setPackageErr(e instanceof ApiError ? e.message : 'تعذر حفظ الباكج')
              } finally {
                setPackageBusy(false)
              }
            }}
          >
            {packageBusy ? 'جاري الحفظ…' : 'حفظ الباكج'}
          </button>

          <h3 className="card-title" style={{ marginTop: '1.35rem', fontSize: '0.95rem' }}>
            الباكجات المسجلة
          </h3>
          {patientPackages.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد باكجات مسجلة لهذا المريض.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.8rem' }}>
              {patientPackages.map((pkg) => (
                <div key={pkg.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.8rem' }}>
                  {(() => {
                    const remainingSessions = pkg.sessions.filter((s) => !s.completedByReception).length
                    return (
                      <p style={{ margin: '0 0 0.45rem', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                        الجلسات المتبقية: <strong style={{ color: 'var(--text)' }}>{remainingSessions}</strong> من{' '}
                        <strong style={{ color: 'var(--text)' }}>{pkg.sessionsCount || pkg.sessions.length}</strong>
                      </p>
                    )
                  })()}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <strong>{pkg.title || `باكج ليزر (${pkg.sessionsCount} جلسة)`}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {pkg.createdAt ? formatClinicDate(pkg.createdAt) : '—'}
                    </span>
                  </div>
                  <p style={{ margin: '0.45rem 0', fontSize: '0.88rem' }}>
                    إجمالي الباكج: <strong>{renderMoneySyp(pkg.packageTotalSyp)}</strong> — المدفوع:{' '}
                    <strong>{renderMoneySyp(pkg.paidAmountSyp)}</strong>
                  </p>
                  <p style={{ margin: '0 0 0.45rem', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                    حالة التسوية:{' '}
                    {pkg.settlementDeltaSyp < 0
                      ? `ذمة ${Math.abs(pkg.settlementDeltaSyp).toLocaleString('ar-SY')} ل.س`
                      : pkg.settlementDeltaSyp > 0
                        ? `رصيد إضافي ${pkg.settlementDeltaSyp.toLocaleString('ar-SY')} ل.س`
                        : 'متوازن'}
                  </p>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {pkg.sessions.map((s) => (
                      <label
                        key={s.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: '0.45rem 0.55rem',
                          fontSize: '0.88rem',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={s.completedByReception}
                          disabled={s.completedByReception || packageBusy}
                          onChange={async (e) => {
                            if (!id) return
                            const nextCompleted = e.target.checked
                            if (!nextCompleted) return
                            setPackageErr('')
                            setPackageOk('')
                            setPackageBusy(true)
                            try {
                              const data = await api<{ package: PatientPackage }>(
                                `/api/patients/${encodeURIComponent(id)}/packages/${encodeURIComponent(pkg.id)}/sessions/${encodeURIComponent(s.id)}`,
                                {
                                  method: 'PATCH',
                                  body: JSON.stringify({ completed: true }),
                                },
                              )
                              setPatient((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      sessionPackages: (prev.sessionPackages || []).map((x) =>
                                        x.id === pkg.id ? data.package : x,
                                      ),
                                    }
                                  : prev,
                              )
                              setPackageOk('تم تثبيت إتمام جلسة الباكج.')
                            } catch (err) {
                              setPackageErr(err instanceof ApiError ? err.message : 'تعذر تحديث جلسة الباكج')
                            } finally {
                              setPackageBusy(false)
                            }
                          }}
                        />
                        <span>
                          {s.label}
                          {s.linkedLaserSessionId ? (
                            <span style={{ color: 'var(--text-muted)' }}> — مرتبطة بجلسة ليزر</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}> — بانتظار تسجيل الجلسة</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                  {pkg.notes ? (
                    <p style={{ margin: '0.55rem 0 0', color: 'var(--text-muted)', fontSize: '0.83rem' }}>
                      {pkg.notes}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'financial' && (role === 'super_admin' || role === 'reception') && (
        <div className="card">
          <h2 className="card-title">السجل المالي للمريض</h2>
          <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
            <div>
              <span className="form-label">إجمالي الذمم</span>
              <div style={{ marginTop: '0.15rem', fontWeight: 700 }}>
                {renderMoneySyp(Number(patient.outstandingDebtSyp) || 0)}
              </div>
            </div>
            <div>
              <span className="form-label">الرصيد الإضافي</span>
              <div style={{ marginTop: '0.15rem', fontWeight: 700 }}>
                {renderMoneySyp(Number(patient.prepaidCreditSyp) || 0)}
              </div>
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginTop: '-0.15rem' }}>
            اضغط على أي سطر لإضافة دفعة وتسوية الذمة تلقائياً.
          </p>
          {financialErr ? <p style={{ color: 'var(--danger)', marginTop: 0 }}>{financialErr}</p> : null}
          {financialLoading ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
          ) : financialOpenEntries.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد جلسات غير مطابقة حالياً.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الإجراء</th>
                    <th>سعر الجلسة</th>
                    <th>المستلم</th>
                    <th>الفرق</th>
                    <th>التصنيف</th>
                  </tr>
                </thead>
                <tbody>
                  {financialOpenEntries.map((x) => (
                    <tr
                      key={x.id}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setFinancialSettleErr('')
                        setFinancialSettleSyp('')
                        setFinancialSettleOpen(true)
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        setFinancialSettleErr('')
                        setFinancialSettleSyp('')
                        setFinancialSettleOpen(true)
                      }}
                    >
                      <td>{x.businessDate || '—'}</td>
                      <td>{x.procedureLabel || '—'}</td>
                      <td>{renderMoneySyp(Number(x.amountDueSyp) || 0)}</td>
                      <td>{renderMoneySyp(Number(x.receivedAmountSyp) || 0)}</td>
                      <td>{renderMoneySyp(Number(x.settlementDeltaSyp) || 0)}</td>
                      <td>
                        {x.settlementType === 'debt'
                          ? 'ذمة'
                          : x.settlementType === 'credit'
                            ? 'رصيد إضافي'
                            : 'غير مطابق'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {financialSettleOpen && (role === 'super_admin' || role === 'reception') && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (financialSettleBusy) return
            setFinancialSettleOpen(false)
          }}
        >
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="card-title" style={{ marginTop: 0 }}>
              إضافة دفعة إلى حساب المريض
            </h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '-0.2rem', fontSize: '0.87rem' }}>
              يتم مقارنة المبلغ المُدخل مع إجمالي الذمة الحالية ومعالجته تلقائياً (جزئي/مطابق/فائض).
            </p>

            <div style={{ marginTop: '0.5rem' }}>
              <label className="form-label">المبلغ المدخل (ل.س)</label>
              <input
                className="input"
                inputMode="decimal"
                value={financialSettleSyp}
                onChange={(e) => setFinancialSettleSyp(e.target.value)}
                placeholder="0"
                disabled={financialSettleBusy}
                style={{ marginTop: '0.25rem' }}
              />
            </div>

            <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.35rem', fontSize: '0.87rem' }}>
              <div>
                الذمة الحالية: <strong>{renderMoneySyp(debtNow)}</strong>
              </div>
              <div>
                سيُغطّى من الذمة: <strong>{renderMoneySyp(settleWillCoverSyp)}</strong>
              </div>
              <div>
                الذمة المتبقية بعد العملية: <strong>{renderMoneySyp(settleWillRemainDebtSyp)}</strong>
              </div>
              <div>
                الرصيد الإضافي الناتج: <strong>{renderMoneySyp(settleWillAddCreditSyp)}</strong>
              </div>
            </div>

            {financialSettleErr ? (
              <p style={{ color: 'var(--danger)', marginTop: '0.6rem' }}>{financialSettleErr}</p>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.85rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={financialSettleBusy}
                onClick={() => setFinancialSettleOpen(false)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={financialSettleBusy}
                onClick={async () => {
                  if (!id) return
                  setFinancialSettleErr('')
                  const syp = Math.max(0, Math.round(parseFloat(financialSettleSyp) || 0))
                  if (!(syp > 0)) {
                    setFinancialSettleErr('أدخل مبلغاً بالليرة.')
                    return
                  }
                  setFinancialSettleBusy(true)
                  try {
                    const result = await api<{
                      summary: { outstandingDebtSyp: number; prepaidCreditSyp: number }
                    }>(`/api/patients/${encodeURIComponent(id)}/financial-settlement`, {
                      method: 'POST',
                      body: JSON.stringify({
                        amountSyp: syp,
                      }),
                    })
                    setPatient((prev) =>
                      prev
                        ? {
                            ...prev,
                            outstandingDebtSyp: Number(result.summary?.outstandingDebtSyp) || 0,
                            prepaidCreditSyp: Number(result.summary?.prepaidCreditSyp) || 0,
                          }
                        : prev,
                    )
                    await refreshFinancialLedger()
                    setFinancialSettleOpen(false)
                  } catch (e) {
                    setFinancialSettleErr(e instanceof ApiError ? e.message : 'تعذر تنفيذ التسوية')
                  } finally {
                    setFinancialSettleBusy(false)
                  }
                }}
              >
                {financialSettleBusy ? 'جاري المعالجة…' : 'تأكيد التسوية'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'sessions' &&
        (role === 'super_admin' || role === 'reception' ? (
          <div className="card">
            <h2 className="card-title">جلسات وتحصيل (استقبال)</h2>
            <p style={{ marginTop: '-0.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              أنشئ بند تحصيل للمريض بأي قسم مع تحديد المقدّم. يمكن لاحقاً إكمال الوصف الطبي والمواد من الاستقبال أو من
              المقدّم نفسه. مبلغ التحصيل لا يتغيّر عند إضافة المواد.
            </p>
            <div className="grid-2" style={{ marginTop: '0.75rem' }}>
              <div>
                <label className="form-label">القسم</label>
                <select
                  className="input"
                  value={recvDept}
                  onChange={(e) =>
                    setRecvDept(e.target.value as 'laser' | 'dermatology' | 'dental' | 'solarium')
                  }
                >
                  <option value="laser">ليزر</option>
                  <option value="dermatology">جلدية</option>
                  <option value="dental">أسنان</option>
                  <option value="solarium">سولاريوم</option>
                </select>
              </div>
              <div>
                <label className="form-label">المقدّم (أخصائي القسم)</label>
                <select
                  className="input"
                  value={recvProviderId}
                  onChange={(e) => setRecvProviderId(e.target.value)}
                  disabled={!recvProviders.length}
                >
                  {recvProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">المستحق (ل.س)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={recvFeeSyp}
                  onChange={(e) => setRecvFeeSyp(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <p style={{ marginTop: '0.45rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              أدخل المبلغ بالليرة السورية.
            </p>
            {recvErr ? <p style={{ color: 'var(--danger)', marginTop: '0.65rem' }}>{recvErr}</p> : null}
            {recvOk ? <p style={{ color: 'var(--success)', marginTop: '0.65rem' }}>{recvOk}</p> : null}
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '0.85rem' }}
              disabled={recvSaving || !recvProviderId}
              onClick={async () => {
                if (!id) return
                setRecvErr('')
                setRecvOk('')
                const feeSyp = Math.max(0, Math.round(parseFloat(recvFeeSyp) || 0))
                if (!(feeSyp > 0)) {
                  setRecvErr('أدخل مبلغ التحصيل بالليرة.')
                  return
                }
                setRecvSaving(true)
                try {
                  await api('/api/clinical/sessions/reception', {
                    method: 'POST',
                    body: JSON.stringify({
                      patientId: id,
                      department: recvDept,
                      providerUserId: recvProviderId,
                      sessionFeeSyp: feeSyp,
                      businessDate: clinicBusinessDate ?? undefined,
                    }),
                  })
                  setRecvOk('تم إنشاء الجلسة وبند التحصيل.')
                  setRecvFeeSyp('')
                  await refreshClinicalSessionLists()
                } catch (e) {
                  setRecvErr(e instanceof ApiError ? e.message : 'تعذر الإنشاء')
                } finally {
                  setRecvSaving(false)
                }
              }}
            >
              {recvSaving ? 'جاري الحفظ…' : 'إنشاء بند التحصيل'}
            </button>
            <h3 className="card-title" style={{ marginTop: '1.5rem', fontSize: '0.95rem' }}>
              كل الجلسات السريرية لهذا المريض
            </h3>
            {recvAllSessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد جلسات مسجّلة.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>القسم</th>
                      <th>الوصف</th>
                      <th>المقدّم</th>
                      <th>المستحق</th>
                      <th>التحصيل</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recvAllSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.businessDate}</td>
                        <td>{clinicalDeptLabelAr(s.department)}</td>
                        <td>{s.procedureDescription || '—'}</td>
                        <td>{s.providerName}</td>
                        <td>{Number(s.amountDueSyp || 0).toLocaleString('ar-SY')} ل.س</td>
                        <td>{s.isPackagePrepaid ? 'مدفوعة مسبقاً (باكج)' : s.billingStatus === 'paid' ? 'مدفوع' : 'معلّق'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: '0.8rem' }}
                            onClick={() => void openSessionEdit(s)}
                          >
                            تكميل
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null)}

      {tab === 'laser' &&
        (canAccessTab(role, 'laser') ? (
          <div className="laser-session-workspace">
            <header className="laser-session-workspace__head">
              <h2 className="page-title" style={{ marginBottom: '0.35rem' }}>
                سجل جلسة ليزر
              </h2>
              <p className="page-desc" style={{ margin: 0 }}>
                جلسة وفوترة ومناطق لـ <strong>{patient.name}</strong>
                {clinicBusinessDate ? (
                  <>
                    {' '}
                    — يوم العمل: <span dir="ltr">{clinicBusinessDate}</span>
                  </>
                ) : null}
              </p>
              {activeLaserPackage ? (
                <p style={{ margin: '0.45rem 0 0', color: 'var(--success)', fontSize: '0.86rem' }}>
                  هذه الجلسة تُسجّل ضمن الباكج: <strong>{activeLaserPackage.title || 'باكج ليزر'}</strong> — سعر الجلسة الأساسية
                  مدفوع مسبقاً. يمكنك إضافة مناطق أو عروض <strong>خارج الباكج</strong> من نافذة الاختيار؛ يُعرض سعر
                  الإضافات فقط ويُحصّلها الاستقبال عند «إنقاص جلسة و دفع».
                </p>
              ) : null}
            </header>

            <div className="laser-session-workspace__grid">
              <section className="card laser-panel laser-panel--wide" style={{ gridColumn: '1 / -1' }}>
                <h3 className="card-title" style={{ marginTop: 0 }}>
                  إدخال بيانات جلسة الليزر
                </h3>
                <p style={{ marginTop: '-0.25rem', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                  رقم المعالجة: {nextTreatmentHint} — المعالج: {user?.name ?? '—'}
                </p>
                <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>نوع الليزر</th>
                        <th>المناطق</th>
                        <th>P.W</th>
                        <th>Pulse</th>
                        <th>الضربات</th>
                        <th>محاسبة على الضربات</th>
                        <th>سعر السطر</th>
                        <th>حذف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laserLineItemsWithPricing.map((row) => (
                        <tr key={row.rowId}>
                        <td>
                          <select
                            className="select"
                            value={laserType}
                            onChange={(e) => setLaserType(e.target.value as (typeof laserTypes)[number])}
                            style={{ maxWidth: 220 }}
                          >
                            {laserTypes.map((lt) => (
                              <option key={lt} value={lt}>
                                {lt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{row.areaLabel || '—'}</span>
                          {row.isAddon ? (
                            <div style={{ marginTop: '0.2rem', fontSize: '0.78rem', color: 'var(--amber)' }}>
                              خارج الباكج
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <input
                            className="input"
                            type="text"
                            inputMode="text"
                            placeholder="مثال: 11/7"
                            value={row.pw}
                            onChange={(e) =>
                              setLaserLineItems((prev) =>
                                prev.map((x) => (x.rowId === row.rowId ? { ...x, pw: e.target.value } : x)),
                              )
                            }
                            style={{ maxWidth: 130 }}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            type="text"
                            inputMode="text"
                            placeholder="مثال: 13/8"
                            value={row.pulse}
                            onChange={(e) =>
                              setLaserLineItems((prev) =>
                                prev.map((x) => (x.rowId === row.rowId ? { ...x, pulse: e.target.value } : x)),
                              )
                            }
                            style={{ maxWidth: 130 }}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            inputMode="numeric"
                            placeholder="0"
                            value={row.shotCount}
                            onChange={(e) =>
                              setLaserLineItems((prev) =>
                                prev.map((x) => (x.rowId === row.rowId ? { ...x, shotCount: e.target.value } : x)),
                              )
                            }
                            style={{ maxWidth: 120 }}
                          />
                        </td>
                        <td>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <input
                              type="checkbox"
                              checked={row.chargeByPulseCount}
                              onChange={(e) =>
                                setLaserLineItems((prev) =>
                                  prev.map((x) =>
                                    x.rowId === row.rowId ? { ...x, chargeByPulseCount: e.target.checked } : x,
                                  ),
                                )
                              }
                            />
                            نعم
                          </label>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {(Number(row.lineCostSyp) || 0).toLocaleString('ar-SY')} ل.س
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setLaserLineItems((prev) => prev.filter((x) => x.rowId !== row.rowId))
                              if (row.procedureOptionId) {
                                setSelectedLaserItemIds((prev) => prev.filter((id) => id !== row.procedureOptionId))
                                setSelectedLaserAddonItemIds((prev) =>
                                  prev.filter((id) => id !== row.procedureOptionId),
                                )
                              }
                            }}
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setLaserAreaModalOpen(true)}>
                    اختيار المناطق / العروض
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setLaserAreaModalOpen(true)}
                  >
                    + إضافة سطر
                  </button>
                </div>
                <div style={{ marginTop: '0.45rem', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                  {combinedLaserSaveItems.length > 0
                    ? `مناطق مختارة: ${combinedLaserSaveItems.map((x) => x.name).join(' + ')}`
                    : 'لم يتم اختيار مناطق بعد'}
                </div>
                <div style={{ marginTop: '0.75rem' }}>
                  <textarea
                    className="textarea"
                    placeholder="ملاحظات عامة للجلسة..."
                    value={laserNotes}
                    onChange={(e) => setLaserNotes(e.target.value)}
                  />
                </div>
                <div
                  style={{
                    marginTop: '0.65rem',
                    padding: '0.55rem 0.65rem',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-solid)',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                    لكل سطر يمكنك تفعيل <strong>محاسبة على الضربات</strong>. عند التفعيل يصبح سعر السطر = عدد الضربات ×
                    سعر الضربة المسجّل في النظام ({' '}
                    <strong>{laserPricePerPulseSyp.toLocaleString('ar-SY')} ل.س</strong> ).
                  </p>
                </div>
                {activeLaserPackage ? (
                  <div style={{ marginTop: '0.8rem', fontSize: '0.9rem' }}>
                    <p style={{ margin: '0 0 0.35rem', color: 'var(--success)' }}>
                      <strong>جلسة ضمن باكج مدفوع مسبقاً</strong> — لا يُحسب سعر المناطق ضمن الباكج على هذه الجلسة.
                    </p>
                    <p style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                      <strong>إضافات خارج الباكج:</strong>{' '}
                      {laserAddonTotalSyp > 0 ? (
                        <>{laserAddonTotalSyp.toLocaleString('ar-SY')} ل.س</>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>لا توجد إضافات خارج الباكج</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <div style={{ marginTop: '0.8rem', fontSize: '0.9rem' }}>
                    <strong>سعر الجلسة:</strong>{' '}
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {selectedLaserTotalSyp > 0 ? selectedLaserTotalSyp.toLocaleString('ar-SY') : '0'} ل.س
                    </span>
                  </div>
                )}
                {laserProcedureErr ? (
                  <p style={{ color: 'var(--danger)', marginTop: '0.55rem', marginBottom: 0 }}>{laserProcedureErr}</p>
                ) : null}
            {laserSessionErr ? (
              <p style={{ color: 'var(--danger)', fontSize: '0.9rem', marginTop: '0.75rem', marginBottom: 0 }}>
                {laserSessionErr}
              </p>
            ) : null}
            {laserSessionOk ? (
              <p style={{ color: 'var(--success)', fontSize: '0.9rem', marginTop: '0.75rem', marginBottom: 0 }}>
                {laserSessionOk}
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1.25rem', width: '100%', maxWidth: 420 }}
              disabled={savingLaser}
              onClick={async () => {
                if (!id) return
                setLaserSessionErr('')
                setLaserSessionOk('')
                if (laserProcedureLoading) {
                  setLaserSessionErr('انتظر تحميل المناطق أولاً.')
                  return
                }
                if (laserLineItemsWithPricing.length === 0) {
                  setLaserSessionErr('أضف سطر منطقة/عرض واحد على الأقل.')
                  return
                }
                const emptyNamedRow = laserLineItemsWithPricing.find(
                  (row) => !(row.areaLabel || '').trim(),
                )
                if (emptyNamedRow) {
                  setLaserSessionErr('يوجد سطر بدون اسم منطقة/عرض. أكمل الاسم أو احذف السطر.')
                  return
                }
                if (!activeLaserPackage) {
                  const pulseRows = laserLineItemsWithPricing.filter((row) => row.chargeByPulseCount)
                  if (pulseRows.length > 0) {
                    const ppuSyp = Math.max(0, Math.round(Number(laserPricePerPulseSyp) || 0))
                    if (!(ppuSyp > 0)) {
                      setLaserSessionErr(
                        'سعر الضربة غير محدد — يضبطه المدير في «الغرف وتعيين أخصائيي الليزر» ضمن أسعار المناطق (بالليرة).',
                      )
                      return
                    }
                    const invalidPulseRow = pulseRows.find((row) => !(parseLaserShotsForPricing(row.shotCount) > 0))
                    if (invalidPulseRow) {
                      setLaserSessionErr(
                        `عند «محاسبة على الضربات» أدخل عدد ضربات أكبر من صفر للسطر: ${invalidPulseRow.areaLabel}.`,
                      )
                      return
                    }
                  }
                  if (!(selectedLaserTotalSyp > 0)) {
                    setLaserSessionErr('اختر مناطق/عروض بسعر صالح أو فعّل محاسبة الضربات مع عدد ضربات صحيح.')
                    return
                  }
                }
                setSavingLaser(true)
                try {
                  const created = await api<{
                    billingItem: { amountDueSyp: number; isPackagePrepaid?: boolean }
                  }>('/api/laser/sessions', {
                    method: 'POST',
                    body: JSON.stringify({
                      patientId: id,
                      scheduleSlotId: bookedLaserSlotId || undefined,
                      room,
                      laserType,
                      pw: laserLineItemsWithPricing.map((x) => x.pw).filter(Boolean).join(' | '),
                      pulse: laserLineItemsWithPricing.map((x) => x.pulse).filter(Boolean).join(' | '),
                      shotCount: laserLineItemsWithPricing.map((x) => x.shotCount).filter(Boolean).join(' | '),
                      notes: laserNotes,
                      areaIds: [],
                      procedureOptionIds: selectedLaserItemIds,
                      addonProcedureOptionIds: activeLaserPackage ? selectedLaserAddonItemIds : undefined,
                      laserLineItems: laserLineItemsWithPricing.map((row) => ({
                        procedureOptionId: row.procedureOptionId || undefined,
                        areaLabel: row.areaLabel,
                        pw: row.pw,
                        pulse: row.pulse,
                        shotCount: row.shotCount,
                        chargeByPulseCount: row.chargeByPulseCount,
                        isAddon: row.isAddon,
                      })),
                      manualAreaLabels: combinedLaserSaveItems.map((x) => x.name),
                      addonManualLabels: activeLaserPackage ? selectedLaserAddonItems.map((x) => x.name) : undefined,
                      additionalCostSyp: activeLaserPackage ? laserAddonTotalSyp : undefined,
                      status: activeLaserPackage ? 'completed_pending_collection' : 'in_progress',
                      costSyp: selectedLaserTotalSyp,
                      chargeByPulseCount: !activeLaserPackage && laserLineItemsWithPricing.some((x) => x.chargeByPulseCount),
                      discountPercent: 0,
                      businessDate: clinicBusinessDate ?? undefined,
                    }),
                  })
                  const due = Number(created.billingItem?.amountDueSyp || 0)
                  const dueFmt = due.toLocaleString('ar-SY')
                  setLaserSessionOk(
                    created.billingItem?.isPackagePrepaid
                      ? due > 0.0001
                        ? `تم حفظ الجلسة ضمن الباكج مع إضافات خارج الباكج. المستحق للتحصيل: ${dueFmt} ل.س — في التحصيل استخدم «إنقاص جلسة و دفع».`
                        : 'تم حفظ الجلسة ضمن الباكج كجلسة مدفوعة مسبقاً. في التحصيل استخدم «إنقاص جلسة» عند عدم وجود إضافات.'
                      : `تم حفظ الجلسة وبند الفوترة. المستحق للتحصيل: ${dueFmt} ل.س (صفحة التحصيل للاستقبال).`,
                  )
                  setLaserNotes('')
                  setSelectedLaserItemIds([])
                  setSelectedLaserAddonItemIds([])
                  setLaserLineItems([])
                  const data = await api<{ sessions: { treatmentNumber: number }[] }>(
                    `/api/laser/sessions?patientId=${encodeURIComponent(id)}`,
                  )
                  const nums = data.sessions.map((s) => s.treatmentNumber)
                  const max = nums.length ? Math.max(...nums) : 0
                  setNextTreatmentHint(max ? `آخر محفوظ: ${max}` : '—')
                } catch (e) {
                  if (e instanceof ApiError) {
                    if (e.status === 423) {
                      setLaserSessionErr(
                        e.message || 'يوم العمل غير مفعّل — اطلب من المدير تفعيل اليوم قبل حفظ الجلسة.',
                      )
                    } else {
                      setLaserSessionErr(e.message || 'تعذر حفظ الجلسة')
                    }
                  } else {
                    setLaserSessionErr('تعذر حفظ الجلسة')
                  }
                } finally {
                  setSavingLaser(false)
                }
              }}
            >
              {savingLaser ? 'جاري الحفظ…' : activeLaserPackage ? 'حفظ الجلسة (ضمن الباكج)' : 'حفظ الجلسة والفوترة'}
            </button>
              </section>

              {laserAreaModalOpen ? (
                <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setLaserAreaModalOpen(false)}>
                  <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ marginTop: 0 }}>اختيار مناطق / عروض الليزر</h3>
                    {laserProcedureLoading ? (
                      <p style={{ color: 'var(--text-muted)' }}>جاري تحميل المناطق…</p>
                    ) : (
                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                          {activeLaserPackage
                            ? 'المناطق التالية تُسجّل ضمن الجلسة (ضمن الباكج أو كجلسة واحدة). لإضافة سعر اختر قسم «خارج الباكج» أدناه.'
                            : 'اختر المناطق أو العروض المطلوبة.'}
                        </p>
                        {laserProcedureGroups.map((g) => (
                          <div key={g.id}>
                            <p style={{ margin: '0 0 0.4rem', color: 'var(--text-muted)', fontSize: '0.86rem' }}>{g.title}</p>
                            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                              {g.items.map((item) => {
                                const selected = selectedLaserItemIds.includes(item.id)
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={`btn ${selected ? 'btn-primary' : 'btn-secondary'}`}
                                    style={{
                                      fontSize: '0.82rem',
                                      padding: '0.38rem 0.58rem',
                                      borderRadius: 999,
                                      borderColor: selected ? 'var(--cyan)' : 'var(--border)',
                                    }}
                                    onClick={() => toggleLaserMainArea(item.id)}
                                  >
                                    {item.name}
                                    {activeLaserPackage ? null : (
                                      <span style={{ opacity: 0.85 }}>
                                        {' '}
                                        —{' '}
                                        {resolveLaserItemPriceByPatientGender(item, pricingGender).toLocaleString('en-US')}{' '}
                                        ل.س
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                        {activeLaserPackage ? (
                          <>
                            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0.25rem 0' }} />
                            <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--amber)' }}>
                              خارج الباكج — تُحسب على المريض
                            </p>
                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                              اختر هنا فقط المناطق الإضافية غير المشمولة بالباكج؛ يظهر السعر ويُحصّل في الاستقبال.
                            </p>
                            {laserProcedureGroups.map((g) => (
                              <div key={`addon-${g.id}`}>
                                <p style={{ margin: '0 0 0.4rem', color: 'var(--text-muted)', fontSize: '0.86rem' }}>{g.title}</p>
                                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                  {g.items.map((item) => {
                                    const selected = selectedLaserAddonItemIds.includes(item.id)
                                    return (
                                      <button
                                        key={`addon-${item.id}`}
                                        type="button"
                                        className={`btn ${selected ? 'btn-primary' : 'btn-secondary'}`}
                                        style={{
                                          fontSize: '0.82rem',
                                          padding: '0.38rem 0.58rem',
                                          borderRadius: 999,
                                          borderColor: selected ? 'var(--cyan)' : 'var(--border)',
                                        }}
                                        onClick={() => toggleLaserAddonArea(item.id)}
                                      >
                                        {item.name} —{' '}
                                        {resolveLaserItemPriceByPatientGender(item, pricingGender).toLocaleString('en-US')}{' '}
                                        ل.س
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </>
                        ) : null}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                      <button type="button" className="btn btn-primary" onClick={() => setLaserAreaModalOpen(false)}>
                        تم
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              <section className="card laser-panel laser-panel--wide" style={{ gridColumn: '1 / -1' }}>
                <h3 className="card-title" style={{ fontSize: '0.95rem' }}>
                  بنود التحصيل السريرية (ليزر)
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0 }}>
                  جلسات أنشأها الاستقبال أو سجّلت كإجراء ليزر — أكمل الوصف والمواد عند الحاجة.
                </p>
                {laserClinSessions.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.88rem' }}>لا توجد بنود.</p>
                ) : (
                  <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>الوصف</th>
                          <th>المستحق</th>
                          <th>التحصيل</th>
                          <th>إجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {laserClinSessions.map((s) => (
                          <tr key={s.id}>
                            <td>{s.businessDate}</td>
                            <td>{s.procedureDescription || '—'}</td>
                            <td>{Number(s.amountDueSyp || 0).toLocaleString('ar-SY')} ل.س</td>
                            <td>{s.isPackagePrepaid ? 'مدفوعة مسبقاً (باكج)' : s.billingStatus === 'paid' ? 'مدفوع' : 'معلّق'}</td>
                            <td>
                              {canEditClinicalSessionRow(
                                { id: user?.id, role },
                                s,
                              ) ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.8rem' }}
                                  onClick={() => void openSessionEdit(s)}
                                >
                                  تكميل
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="no-access">
            <strong>لا تملك صلاحية عرض تفاصيل الليزر</strong>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              تفاصيل الجلسات والضربات متاحة لفريق الليزر والمدير فقط.
            </p>
          </div>
        ))}

      {tab === 'dermatology' &&
        (canAccessTab(role, 'dermatology') ? (
          <div className="card">
            <h2 className="card-title">جلسة جلدية مع مواد مستودع</h2>
            <p style={{ marginTop: '-0.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              أدخل وصف الإجراء، ثم اختر المواد من مستودع الجلدية وأدخل الكمية حسب الوحدة المحددة للمادة.
            </p>
            <div>
              <label className="form-label">وصف الإجراء / الجلسة</label>
              <input
                className="input"
                value={dermProcedureDescription}
                onChange={(e) => setDermProcedureDescription(e.target.value)}
                placeholder="مثال: حقن تجميلي للوجه"
              />
            </div>
            <h3 className="card-title" style={{ marginTop: '1rem', fontSize: '0.95rem' }}>
              مواد مستودع الجلدية
            </h3>
            {dermMaterialsCatalog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.88rem' }}>
                لا توجد مواد فعّالة/متاحة حالياً في مستودع الجلدية.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>اسم المادة</th>
                        <th>الكمية</th>
                        <th>إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dermSelectedMaterials.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ color: 'var(--text-muted)' }}>
                            لا توجد مواد مضافة بعد.
                          </td>
                        </tr>
                      ) : (
                        dermSelectedMaterials.map((line, idx) => {
                          const selectedItem = dermMaterialsCatalog.find((x) => x.id === line.inventoryItemId)
                          return (
                            <tr key={`derm-mat-${idx}`}>
                              <td>
                                <select
                                  className="input"
                                  value={line.inventoryItemId}
                                  onChange={(e) => updateDermMaterialRow(idx, 'inventoryItemId', e.target.value)}
                                >
                                  <option value="">— اختر المادة —</option>
                                  {dermMaterialsCatalog.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name} ({item.quantity} {item.unit})
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                  <input
                                    className="input"
                                    inputMode="decimal"
                                    value={line.quantity}
                                    onChange={(e) => updateDermMaterialRow(idx, 'quantity', e.target.value)}
                                    placeholder="0"
                                  />
                                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                    {selectedItem?.unit || 'وحدة'}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ fontSize: '0.8rem' }}
                                  onClick={() => removeDermMaterialRow(idx)}
                                >
                                  حذف
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div>
                  <button type="button" className="btn btn-secondary" onClick={addDermMaterialRow}>
                    إضافة مادة
                  </button>
                </div>
              </div>
            )}
            <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              سعر مواد هذه الجلسة:{' '}
              <strong style={{ color: 'var(--text)' }}>{dermMaterialsCostTotal.toLocaleString('ar-SY')} ل.س</strong>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <label className="form-label">سعر الجلسة (ل.س)</label>
              <input
                className="input"
                inputMode="decimal"
                value={dermSessionFeeSyp}
                onChange={(e) => setDermSessionFeeSyp(e.target.value)}
                placeholder="مثال: 250000"
              />
            </div>
            {dermErr ? <p style={{ color: 'var(--danger)', marginTop: '0.65rem' }}>{dermErr}</p> : null}
            {dermOk ? <p style={{ color: 'var(--success)', marginTop: '0.65rem' }}>{dermOk}</p> : null}
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '0.9rem' }}
              disabled={dermSaving}
              onClick={async () => {
                if (!id) return
                setDermErr('')
                setDermOk('')
                const payloadMaterials = dermSelectedMaterials
                  .map((line) => ({
                    inventoryItemId: line.inventoryItemId,
                    quantity: Math.max(0, parseFloat(line.quantity) || 0),
                  }))
                  .filter((x) => Boolean(x.inventoryItemId))
                  .filter((x) => x.quantity > 0)
                if (!dermProcedureDescription.trim()) {
                  setDermErr('أدخل وصف الإجراء أولاً.')
                  return
                }
                const feeSyp = Math.max(0, Math.round(parseFloat(dermSessionFeeSyp) || 0))
                if (!(feeSyp > 0)) {
                  setDermErr('أدخل سعر الجلسة بالليرة (قيمة أكبر من صفر).')
                  return
                }
                if (payloadMaterials.length === 0) {
                  setDermErr('أضف مادة واحدة على الأقل مع الكمية.')
                  return
                }
                setDermSaving(true)
                try {
                  const created = await api<{
                    billingItem: { amountDueSyp: number; id: string }
                  }>('/api/clinical/sessions', {
                    method: 'POST',
                    body: JSON.stringify({
                      department: 'dermatology',
                      patientId: id,
                      sessionFeeSyp: feeSyp,
                      procedureDescription: dermProcedureDescription.trim(),
                      notes: '',
                      materials: payloadMaterials,
                      businessDate: clinicBusinessDate ?? undefined,
                    }),
                  })
                  const sessionsData = await api<{ sessions: DermatologySessionRow[] }>(
                    `/api/clinical/sessions/patient/${encodeURIComponent(id)}`,
                  )
                  setDermSessions(sessionsData.sessions.filter((s) => s.department === 'dermatology'))
                  const itemsData = await api<{ items: DermatologyMaterialOption[] }>(
                    '/api/inventory/items?activeOnly=1&inStockOnly=1&departments=dermatology_private',
                  )
                  setDermMaterialsCatalog(itemsData.items)
                  setDermProcedureDescription('')
                  setDermSessionFeeSyp('')
                  setDermSelectedMaterials([])
                  setDermOk(
                    `تم حفظ الجلسة وخصم المواد وإنشاء بند تحصيل بقيمة ${Number(created.billingItem.amountDueSyp).toLocaleString('ar-SY')} ل.س. يظهر في صفحة التحصيل للاستقبال.`,
                  )
                } catch (e) {
                  setDermErr(e instanceof ApiError ? e.message : 'تعذر حفظ جلسة الجلدية')
                } finally {
                  setDermSaving(false)
                }
              }}
            >
              {dermSaving ? 'جاري الحفظ…' : 'تأكيد الجلسة وخصم المواد وإنشاء الفاتورة'}
            </button>
            <h3 className="card-title" style={{ marginTop: '1.25rem', fontSize: '0.95rem' }}>
              آخر جلسات الجلدية لهذا المريض
            </h3>
            {dermSessionsLoading ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل السجل…</p>
            ) : dermSessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد جلسات جلدية مسجلة حتى الآن.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الوصف</th>
                      <th>المعالج</th>
                      <th>الإجمالي (ل.س)</th>
                      <th>حالة التحصيل</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dermSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.businessDate}</td>
                        <td>{s.procedureDescription || '—'}</td>
                        <td>{s.providerName}</td>
                        <td>{Number(s.amountDueSyp || 0).toLocaleString('ar-SY')} ل.س</td>
                        <td>
                          {s.isPackagePrepaid
                            ? 'مدفوعة مسبقاً (باكج)'
                            : s.billingStatus === 'paid'
                              ? 'مدفوع'
                              : 'بانتظار التحصيل'}
                        </td>
                        <td>
                          {canEditClinicalSessionRow({ id: user?.id, role }, s) ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: '0.8rem' }}
                              onClick={() => void openSessionEdit(s)}
                            >
                              تكميل
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="no-access">
            <strong>لا تملك صلاحية قسم الجلدية</strong>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
              تفاصيل الإجراءات والفيلر تظهر لأطباء الجلدية والمدير فقط.
            </p>
          </div>
        ))}

      {tab === 'dental' &&
        (canAccessTab(role, 'dental') ? (
          <div className="card">
            {role === 'dental_branch' && !dentalPlanApproved && (
              <div
                className="no-access"
                style={{ marginBottom: '1.25rem', textAlign: 'center' }}
              >
                <strong>بانتظار اعتماد خطة العلاج</strong>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                  ستظهر الخطة والمخطط السني هنا فور اعتماد الدكتور إلياس.
                </p>
              </div>
            )}
            {role === 'super_admin' && (
              <div
                style={{
                  padding: '1rem',
                  background: dentalPlanApproved ? 'var(--success-bg)' : 'var(--bg)',
                  borderRadius: 'var(--radius)',
                  marginBottom: '1.25rem',
                  border: `1px solid ${dentalPlanApproved ? '#86efac' : 'var(--border)'}`,
                }}
              >
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>خطة العلاج الشاملة</h3>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                  قيود المخطط الاستراتيجي: المعاينة الأولى ووضع الخطة للدكتور إلياس فقط.
                </p>
                <textarea
                  className="textarea"
                  value={planDraft}
                  onChange={(e) => setPlanDraft(e.target.value)}
                  style={{ minHeight: 72 }}
                  disabled={dentalPlanApproved}
                />
                {!dentalPlanApproved ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '0.75rem' }}
                    disabled={approvingPlan}
                    onClick={async () => {
                      if (!id) return
                      setApprovingPlan(true)
                      try {
                        const data = await api<{
                          plan: {
                            id: string
                            status: string
                            items: { label?: string }[]
                            approvedAt?: string | null
                          }
                        }>(`/api/dental/plans/${id}/approve`, {
                          method: 'POST',
                          body: JSON.stringify({
                            items: [{ label: planDraft }],
                          }),
                        })
                        setDentalPlan({
                          id: data.plan.id,
                          status: data.plan.status as 'approved',
                          items: data.plan.items,
                          approvedAt: data.plan.approvedAt,
                        })
                      } finally {
                        setApprovingPlan(false)
                      }
                    }}
                  >
                    {approvingPlan ? 'جاري الاعتماد…' : 'اعتماد الخطة ومزامنتها مع الأطباء'}
                  </button>
                ) : (
                  <p style={{ margin: '0.75rem 0 0', fontWeight: 600, color: 'var(--success)' }}>
                    ✓ تم الاعتماد — تظهر الخطة لأطباء الفروع عند فتح ملف المريض
                  </p>
                )}
              </div>
            )}
            {(role === 'dental_branch' && dentalPlanApproved) ||
            (role === 'super_admin' && dentalPlanApproved) ? (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface)',
                  paddingBottom: '0.75rem',
                  borderBottom: '1px solid var(--border)',
                  marginBottom: '1rem',
                  zIndex: 2,
                }}
              >
                <strong>الخطة المعتمدة:</strong> {dentalPlanSummary}
              </div>
            ) : null}
            {(role === 'super_admin' || dentalPlanApproved) && (
            <>
            <h3 className="card-title">مخطط الأسنان</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '-0.5rem' }}>
              سليم / مخطط / معالَج — اضغط للتبديل (عرض تجريبي)
            </p>
            <div className="tooth-grid">
              {Array.from({ length: 32 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`tooth-btn ${toothState[n]}`}
                  onClick={() => cycleTooth(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <h3 className="card-title" style={{ marginTop: '1.5rem' }}>
              الذمم المالية
            </h3>
            <div className="grid-2">
              <div className="stat-card">
                <div className="lbl">الإجمالي</div>
                <div className="val">2٬400 ل.س</div>
              </div>
              <div className="stat-card">
                <div className="lbl">المدفوع</div>
                <div className="val">1٬000 ل.س</div>
              </div>
              <div className="stat-card" style={{ borderColor: 'var(--warning)' }}>
                <div className="lbl">المتبقي</div>
                <div className="val" style={{ color: 'var(--warning)' }}>
                  1٬400 ل.س
                </div>
              </div>
            </div>
            <h3 className="card-title" style={{ marginTop: '1.5rem', fontSize: '0.95rem' }}>
              جلسات التحصيل السريرية (أسنان)
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0 }}>
              أكمل الوصف والمواد المستخدمة لبنود أنشأها الاستقبال أو سجّلت كجلسة أسنان.
            </p>
            {dentalClinSessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.88rem' }}>لا توجد جلسات مسجّلة.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الوصف</th>
                      <th>المقدّم</th>
                      <th>المستحق</th>
                      <th>التحصيل</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dentalClinSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.businessDate}</td>
                        <td>{s.procedureDescription || '—'}</td>
                        <td>{s.providerName}</td>
                        <td>{Number(s.amountDueSyp || 0).toLocaleString('ar-SY')} ل.س</td>
                        <td>{s.isPackagePrepaid ? 'مدفوعة مسبقاً (باكج)' : s.billingStatus === 'paid' ? 'مدفوع' : 'معلّق'}</td>
                        <td>
                          {canEditClinicalSessionRow({ id: user?.id, role }, s) ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: '0.8rem' }}
                              onClick={() => void openSessionEdit(s)}
                            >
                              تكميل
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>
            )}
          </div>
        ) : (
          <div className="no-access">
            <strong>لا تملك صلاحية ملف الأسنان</strong>
          </div>
        ))}

      {tab === 'solarium' &&
        (canAccessTab(role, 'solarium') ? (
          <div className="card">
            <h2 className="card-title">جلسات السولاريوم</h2>
            <p style={{ marginTop: '-0.25rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              تُنشأ بنود التحصيل عادة من الاستقبال. أكمل هنا الوصف الطبي والمواد المستخدمة من المستودع.
            </p>
            {solSessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد جلسات سولاريوم لهذا المريض.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الوصف</th>
                      <th>المقدّم</th>
                      <th>المستحق</th>
                      <th>التحصيل</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.businessDate}</td>
                        <td>{s.procedureDescription || '—'}</td>
                        <td>{s.providerName}</td>
                        <td>{Number(s.amountDueSyp || 0).toLocaleString('ar-SY')} ل.س</td>
                        <td>{s.isPackagePrepaid ? 'مدفوعة مسبقاً (باكج)' : s.billingStatus === 'paid' ? 'مدفوع' : 'معلّق'}</td>
                        <td>
                          {canEditClinicalSessionRow({ id: user?.id, role }, s) ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: '0.8rem' }}
                              onClick={() => void openSessionEdit(s)}
                            >
                              تكميل
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="no-access">
            <strong>لا تملك صلاحية قسم السولاريوم</strong>
          </div>
        ))}

      {sessionEditOpen && sessionEditId ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setSessionEditOpen(false)
            setSessionEditErr('')
          }}
        >
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>تكميل الجلسة</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
              القسم: <strong>{clinicalDeptLabelAr(sessionEditDept)}</strong> — لا يتغيّر مبلغ التحصيل عند إضافة المواد.
            </p>
            <div style={{ marginTop: '0.75rem' }}>
              <label className="form-label">وصف الإجراء / الجلسة</label>
              <input
                className="input"
                value={sessionEditProc}
                onChange={(e) => setSessionEditProc(e.target.value)}
              />
            </div>
            <div style={{ marginTop: '0.65rem' }}>
              <label className="form-label">ملاحظات</label>
              <textarea
                className="textarea"
                rows={3}
                value={sessionEditNotes}
                onChange={(e) => setSessionEditNotes(e.target.value)}
              />
            </div>
            <h4 style={{ margin: '1rem 0 0.35rem', fontSize: '0.95rem' }}>إضافة مواد (خصم مخزون)</h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              حدّد المواد الجديدة فقط؛ تُضاف إلى السجل دون تعديل المبلغ على المريض.
            </p>
            <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem', maxHeight: 220, overflowY: 'auto' }}>
              {sessionEditCatalog.map((item) => {
                const selected = sessionEditSelected.find((x) => x.inventoryItemId === item.id)
                return (
                  <div
                    key={item.id}
                    style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem' }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected)}
                        onChange={(e) => toggleSessionEditMaterial(item.id, e.target.checked)}
                      />
                      <span>
                        <strong>{item.name}</strong>{' '}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          ({item.quantity} {item.unit})
                        </span>
                      </span>
                    </label>
                    {selected ? (
                      <div style={{ marginTop: '0.35rem' }}>
                        <label className="form-label">الكمية</label>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={selected.quantity}
                          onChange={(e) => updateSessionEditMaterialLine(item.id, e.target.value)}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {sessionEditErr ? (
              <p style={{ color: 'var(--danger)', fontSize: '0.88rem', marginTop: '0.65rem' }}>{sessionEditErr}</p>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={sessionEditSaving}
                onClick={() => {
                  setSessionEditOpen(false)
                  setSessionEditErr('')
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={sessionEditSaving}
                onClick={async () => {
                  if (!sessionEditId) return
                  setSessionEditErr('')
                  setSessionEditSaving(true)
                  try {
                    const appendMaterials = sessionEditSelected
                      .map((line) => ({
                        inventoryItemId: line.inventoryItemId,
                        quantity: Math.max(0, parseFloat(line.quantity) || 0),
                      }))
                      .filter((x) => x.quantity > 0)
                    await api<{ session: DermatologySessionRow }>(
                      `/api/clinical/sessions/${encodeURIComponent(sessionEditId)}`,
                      {
                        method: 'PATCH',
                        body: JSON.stringify({
                          procedureDescription: sessionEditProc.trim(),
                          notes: sessionEditNotes.trim(),
                          appendMaterials,
                        }),
                      },
                    )
                    setSessionEditOpen(false)
                    await refreshClinicalSessionLists()
                  } catch (e) {
                    setSessionEditErr(e instanceof ApiError ? e.message : 'تعذر الحفظ')
                  } finally {
                    setSessionEditSaving(false)
                  }
                }}
              >
                {sessionEditSaving ? 'جاري الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {portalRevealCreds ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setPortalRevealCreds(null)}
        >
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>بيانات الدخول (مرة واحدة)</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              انسخ الآن. احفظها في مكان آمن أو سلّمها للمريض شخصياً.
            </p>
            <div style={{ marginTop: '0.75rem' }}>
              <span className="form-label">اسم المستخدم</span>
              <div dir="ltr" style={{ padding: '0.45rem 0.65rem', background: 'var(--surface)', borderRadius: 8 }}>
                {portalRevealCreds.username}
              </div>
            </div>
            <div style={{ marginTop: '0.65rem' }}>
              <span className="form-label">كلمة المرور</span>
              <div
                dir="ltr"
                style={{
                  padding: '0.45rem 0.65rem',
                  background: 'var(--surface)',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                }}
              >
                {portalRevealCreds.password}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `اسم المستخدم: ${portalRevealCreds.username}\nكلمة المرور: ${portalRevealCreds.password}`,
                  )
                }}
              >
                نسخ الكل
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setPortalRevealCreds(null)}>
                تم
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {laserSessionDetail ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="laser-detail-title"
          onClick={() => {
            setLaserDetailActionErr('')
            setLaserSessionDetail(null)
          }}
        >
          <div
            className="modal"
            style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="laser-detail-title" style={{ marginTop: 0 }}>
              تفاصيل جلسة الليزر — معالجة رقم {laserSessionDetail.treatmentNumber}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
              معرّف السجل: {laserSessionDetail.id}
            </p>
            <div
              style={{
                display: 'grid',
                gap: '0.65rem 1rem',
                gridTemplateColumns: 'minmax(7rem, auto) 1fr',
                fontSize: '0.9rem',
                alignItems: 'start',
              }}
            >
              <span className="form-label" style={{ margin: 0 }}>
                تاريخ الإنشاء
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatClinicDate(laserSessionDetail.createdAt)}
              </span>
              <span className="form-label" style={{ margin: 0 }}>
                آخر تحديث
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {laserSessionDetail.updatedAt
                  ? formatClinicDate(laserSessionDetail.updatedAt)
                  : '—'}
              </span>
              <span className="form-label" style={{ margin: 0 }}>
                الحالة
              </span>
              <span>{laserStatusAr[laserSessionDetail.status] ?? laserSessionDetail.status}</span>
              <span className="form-label" style={{ margin: 0 }}>
                نوع الليزر
              </span>
              <span>{laserSessionDetail.laserType}</span>
              <span className="form-label" style={{ margin: 0 }}>
                الغرفة
              </span>
              <span>{laserSessionDetail.room}</span>
              <span className="form-label" style={{ margin: 0 }}>
                المعالج
              </span>
              <span>{laserSessionDetail.operatorName}</span>
              <span className="form-label" style={{ margin: 0 }}>
                تصنيف الجلسة
              </span>
              <span>{laserSessionDetail.sessionTypeLabel?.trim() || '—'}</span>
              <span className="form-label" style={{ margin: 0 }}>
                P.W
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{laserSessionDetail.pw || '—'}</span>
              <span className="form-label" style={{ margin: 0 }}>
                Pulse
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{laserSessionDetail.pulse || '—'}</span>
              <span className="form-label" style={{ margin: 0 }}>
                عدد الضربات
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{laserSessionDetail.shotCount || '—'}</span>
              <span className="form-label" style={{ margin: 0 }}>
                محاسبة الضربات
              </span>
              <span>{laserSessionDetail.chargeByPulseCount ? 'نعم (سعر × عدد الضربات)' : 'لا'}</span>
              <span className="form-label" style={{ margin: 0 }}>
                الكلفة (ل.س)
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Number(laserSessionDetail.costSyp).toLocaleString('ar-SY', { maximumFractionDigits: 2 })}
              </span>
              <span className="form-label" style={{ margin: 0 }}>
                نسبة الحسم
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{laserSessionDetail.discountPercent}%</span>
              <span className="form-label" style={{ margin: 0 }}>
                الفوترة
              </span>
              <span style={{ fontSize: '0.88rem' }}>
                {laserSessionDetail.billingItemId
                  ? 'مسجّل بند تحصيل — يُؤكَّد في صفحة «التحصيل» ثم يُرحَّل للمحاسبة.'
                  : 'سجل قديم (بدون مسار التحصيل الحالي).'}
              </span>
              <span className="form-label" style={{ margin: 0 }}>
                التحصيل
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatLaserCollectedSyp(laserSessionDetail.collectedAmountSyp ?? null)}
              </span>
              <span className="form-label" style={{ margin: 0, alignSelf: 'start' }}>
                المناطق المعالجة
              </span>
              <span style={{ lineHeight: 1.5, wordBreak: 'break-word' }}>
                {resolveLaserAreasDisplay(
                  laserSessionDetail.areaIds || [],
                  laserSessionDetail.manualAreaLabels,
                  laserCatalog,
                )}
              </span>
              <span className="form-label" style={{ margin: 0, alignSelf: 'start' }}>
                ملاحظات
              </span>
              <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                {laserSessionDetail.notes?.trim() || '—'}
              </span>
            </div>
            {laserDetailActionErr ? (
              <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>
                {laserDetailActionErr}
              </p>
            ) : null}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                justifyContent: 'flex-end',
                marginTop: '1.25rem',
              }}
            >
              {(role === 'super_admin' || role === 'laser') &&
              (laserSessionDetail.status === 'scheduled' ||
                laserSessionDetail.status === 'in_progress') ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={laserSessionCompleting}
                  onClick={() => void completeLaserSessionClinically()}
                >
                  {laserSessionCompleting ? 'جاري الحفظ…' : 'إتمام الجلسة (انتهاء العلاج)'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setLaserDetailActionErr('')
                  setLaserSessionDetail(null)
                }}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
