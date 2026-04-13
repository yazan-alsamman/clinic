import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import { canAccessTab } from '../data/nav'
import { LaserAreaPicker } from '../components/LaserAreaPicker'
import { api, ApiError } from '../api/client'
import type { LaserCategory, Patient, Role } from '../types'

type Tab = 'overview' | 'account' | 'laser' | 'dermatology' | 'dental'

const laserTypes = ['Mix', 'Yag', 'Alex'] as const

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
  costUsd: number
  discountPercent: number
  sessionTypeLabel: string
  billingItemId?: string | null
  billingItemStatus?: string | null
  collectedAmountUsd?: number | null
  manualAreaLabels?: string[]
}

type ClinicalDermRow = {
  id: string
  businessDate: string
  areaTreatment: string
  sessionType: string
  costUsd: number
  discountPercent: number
  providerName: string
  notes: string
  createdAt: string
}

type DermatologyMaterialOption = {
  id: string
  sku: string
  name: string
  unit: string
  quantity: number
  unitCost: number
  active: boolean
}

type DermatologySelectedMaterial = {
  inventoryItemId: string
  quantity: string
  chargedUnitPriceUsd: string
}

type DermatologySessionRow = {
  id: string
  businessDate: string
  department: string
  procedureDescription: string
  sessionFeeUsd: number
  materialCostUsdTotal: number
  materialChargeUsdTotal: number
  amountDueUsd: number
  billingStatus: string
  providerName: string
  notes: string
  createdAt: string
  materials: Array<{
    name: string
    quantity: number
    chargedUnitPriceUsd?: number
    lineChargeUsd?: number
  }>
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

function formatLaserCollectedUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return '—'
  return `${amount.toLocaleString('ar-SY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
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
  return r === 'super_admin' || r === 'reception' || r === 'dermatology' || r === 'dental_branch'
}

function showOverviewLaser(r: Role | undefined) {
  return r === 'super_admin' || r === 'reception' || r === 'laser'
}

function showOverviewDerm(r: Role | undefined) {
  return r === 'super_admin' || r === 'reception' || r === 'dermatology'
}

function showOverviewDentalSummary(r: Role | undefined) {
  return r === 'super_admin' || r === 'reception' || r === 'dental_branch'
}

function clinicalHistoryIntro(r: Role | undefined): string {
  if (r === 'laser') return 'جلسات الليزر المسجّلة لهذا المريض.'
  if (r === 'dermatology')
    return 'مواعيدك وإجراءاتك الجلدية المسجّلة لهذا المريض (حسب اسمك كمقدّم في النظام).'
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
    <tr><th>الاسم الكامل</th><td>${escapeHtmlPdf(patient.name)}</td></tr>
    <tr><th>تاريخ الميلاد</th><td>${escapeHtmlPdf(patient.dob?.trim() ? patient.dob : '—')}</td></tr>
    <tr><th>الحالة الاجتماعية</th><td>${escapeHtmlPdf(patient.marital?.trim() ? patient.marital : '—')}</td></tr>
    <tr><th>المهنة</th><td>${escapeHtmlPdf(patient.occupation?.trim() ? patient.occupation : '—')}</td></tr>
    <tr><th>الهاتف</th><td dir="ltr" style="text-align:right">${escapeHtmlPdf(patient.phone?.trim() ? patient.phone : '—')}</td></tr>
    <tr><th>الجنس</th><td>${escapeHtmlPdf(genderLabel)}</td></tr>
  `

  const historyBlock = `
    <h2>التاريخ الطبي العام</h2>
    <table>
      <tr><th style="width:28%">سوابق مرضية</th><td>${escapeHtmlPdf(patient.medicalHistory?.trim() ? patient.medicalHistory : '—')}</td></tr>
      <tr><th>سوابق جراحية</th><td>${escapeHtmlPdf(patient.surgicalHistory?.trim() ? patient.surgicalHistory : '—')}</td></tr>
      <tr><th>تحسس</th><td>${escapeHtmlPdf(patient.allergies?.trim() ? patient.allergies : '—')}</td></tr>
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
                  <td>${escapeHtmlPdf(formatLaserCollectedUsd(s.collectedAmountUsd ?? null))}</td>
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
                  `<tr><td>${escapeHtmlPdf(v.businessDate)}</td><td>${escapeHtmlPdf(v.sessionType || '—')}</td><td>${escapeHtmlPdf(v.areaTreatment || '—')}</td><td>${escapeHtmlPdf(v.providerName)}</td><td>${v.costUsd}</td><td>${v.discountPercent}%</td><td>${escapeHtmlPdf(v.notes?.trim() || '—')}</td></tr>`,
              )
              .join('')
      parts.push(
        `<h2>معاينات وإجراءات الجلدية</h2><table><thead><tr><th>يوم العمل</th><th>نوع الجلسة</th><th>المنطقة / المعالجة</th><th>المقدّم</th><th>الكلفة (USD)</th><th>الحسم</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table>`,
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
  const { user } = useAuth()
  const { businessDate: clinicBusinessDate } = useClinic()
  const role = user?.role as Role | undefined
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [laserType, setLaserType] = useState<(typeof laserTypes)[number]>('Mix')
  const [room, setRoom] = useState<'1' | '2'>('1')
  const [laserCatalog, setLaserCatalog] = useState<LaserCategory[]>([])
  const [laserAreaIds, setLaserAreaIds] = useState<string[]>([])
  const [pw, setPw] = useState('')
  const [pulse, setPulse] = useState('')
  const [shotCount, setShotCount] = useState('')
  const [laserNotes, setLaserNotes] = useState('')
  const [nextTreatmentHint, setNextTreatmentHint] = useState('—')
  const [savingLaser, setSavingLaser] = useState(false)
  const [laserSessionErr, setLaserSessionErr] = useState('')
  const [laserSessionOk, setLaserSessionOk] = useState('')
  const [laserCostUsd, setLaserCostUsd] = useState('')
  const [laserDiscountPercent, setLaserDiscountPercent] = useState('0')
  const [laserPickerKey, setLaserPickerKey] = useState(0)
  const [laserManualAreas, setLaserManualAreas] = useState<string[]>([])
  const [laserManualInput, setLaserManualInput] = useState('')
  const [dentalPlan, setDentalPlan] = useState<DentalPlanDto>(null)
  const [planDraft, setPlanDraft] = useState(
    'تقويم للفكين — حشو 11، 12 — متابعة تنظيف دوري.',
  )
  const [approvingPlan, setApprovingPlan] = useState(false)
  const [dermProcedureDescription, setDermProcedureDescription] = useState('')
  const [dermNotes, setDermNotes] = useState('')
  const [dermSessionFeeUsd, setDermSessionFeeUsd] = useState('')
  const [dermMaterialsCatalog, setDermMaterialsCatalog] = useState<DermatologyMaterialOption[]>([])
  const [dermSelectedMaterials, setDermSelectedMaterials] = useState<DermatologySelectedMaterial[]>([])
  const [dermSaving, setDermSaving] = useState(false)
  const [dermErr, setDermErr] = useState('')
  const [dermOk, setDermOk] = useState('')
  const [dermSessions, setDermSessions] = useState<DermatologySessionRow[]>([])
  const [dermSessionsLoading, setDermSessionsLoading] = useState(false)
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
  const [overviewEdit, setOverviewEdit] = useState(false)
  const [overviewSaving, setOverviewSaving] = useState(false)
  const [overviewSaveErr, setOverviewSaveErr] = useState('')
  const [pdfExporting, setPdfExporting] = useState(false)
  const [overviewDraft, setOverviewDraft] = useState({
    name: '',
    dob: '',
    marital: '',
    occupation: '',
    medicalHistory: '',
    surgicalHistory: '',
    allergies: '',
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
      name: patient.name,
      dob: patient.dob || '',
      marital: patient.marital || '',
      occupation: patient.occupation || '',
      medicalHistory: patient.medicalHistory || '',
      surgicalHistory: patient.surgicalHistory || '',
      allergies: patient.allergies || '',
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
    setOverviewSaving(true)
    setOverviewSaveErr('')
    try {
      const data = await api<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: overviewDraft.name.trim() || 'مريض',
          dob: overviewDraft.dob,
          marital: overviewDraft.marital,
          occupation: overviewDraft.occupation,
          medicalHistory: overviewDraft.medicalHistory,
          surgicalHistory: overviewDraft.surgicalHistory,
          allergies: overviewDraft.allergies,
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

  const onLaserAreasChange = useCallback((ids: string[]) => {
    setLaserAreaIds(ids)
  }, [])

  function addLaserManualArea() {
    const t = laserManualInput.trim().slice(0, 120)
    if (!t) return
    setLaserManualAreas((prev) => (prev.includes(t) ? prev : [...prev, t].slice(0, 20)))
    setLaserManualInput('')
  }

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
      try {
        const data = await api<{ categories: LaserCategory[] }>('/api/laser/catalog')
        if (!cancelled) setLaserCatalog(data.categories)
      } catch {
        if (!cancelled) setLaserCatalog([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, role])

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
    if (tab !== 'dermatology' || !id || !role || !canAccessTab(role, 'dermatology')) return
    let cancelled = false
    setDermSessionsLoading(true)
    setDermErr('')
    ;(async () => {
      try {
        const [itemsRes, sessionsRes] = await Promise.all([
          api<{ items: DermatologyMaterialOption[] }>('/api/inventory/items?activeOnly=1&inStockOnly=1'),
          api<{ sessions: DermatologySessionRow[] }>(
            `/api/clinical/sessions/patient/${encodeURIComponent(id)}`,
          ),
        ])
        if (cancelled) return
        setDermMaterialsCatalog(itemsRes.items)
        setDermSessions(
          sessionsRes.sessions.filter((s) => s.department === 'dermatology'),
        )
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

  const visibleTabs = useMemo(() => {
    const allTabs: { key: Tab; label: string }[] = [
      { key: 'overview', label: 'نظرة عامة' },
      { key: 'account', label: 'الحساب' },
      { key: 'laser', label: 'الليزر' },
      { key: 'dermatology', label: 'الجلدية' },
      { key: 'dental', label: 'الأسنان' },
    ]
    if (!role) {
      return allTabs.filter((t) => t.key === 'overview')
    }
    const showAccount = role === 'super_admin' || role === 'reception'
    return allTabs.filter(
      (t) =>
        t.key === 'overview' ||
        (t.key === 'account' && showAccount) ||
        (t.key === 'laser' && canAccessTab(role, 'laser')) ||
        (t.key === 'dermatology' && canAccessTab(role, 'dermatology')) ||
        (t.key === 'dental' && canAccessTab(role, 'dental')),
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

  const laserNetDuePreview = useMemo(() => {
    const g = parseFloat(laserCostUsd)
    const d = parseFloat(laserDiscountPercent) || 0
    if (!(g > 0)) return null
    const net = g * (1 - Math.min(100, Math.max(0, d)) / 100)
    if (!(net > 0)) return null
    return Math.round(net * 100) / 100
  }, [laserCostUsd, laserDiscountPercent])

  const dentalPlanApproved = dentalPlan?.status === 'approved'
  const dentalPlanSummary =
    dentalPlan?.items
      ?.map((i) => i.label || i.note)
      .filter(Boolean)
      .join(' — ') || '—'

  const dermMaterialChargeTotal = useMemo(
    () =>
      Math.round(
        dermSelectedMaterials.reduce((sum, line) => {
          const q = Math.max(0, parseFloat(line.quantity) || 0)
          const p = Math.max(0, parseFloat(line.chargedUnitPriceUsd) || 0)
          return sum + q * p
        }, 0) * 100,
      ) / 100,
    [dermSelectedMaterials],
  )
  const dermGrossTotal = useMemo(() => {
    const fee = Math.max(0, parseFloat(dermSessionFeeUsd) || 0)
    return Math.round((fee + dermMaterialChargeTotal) * 100) / 100
  }, [dermMaterialChargeTotal, dermSessionFeeUsd])

  function toggleDermMaterial(materialId: string, checked: boolean) {
    setDermSelectedMaterials((prev) => {
      const exists = prev.some((x) => x.inventoryItemId === materialId)
      if (checked && !exists) {
        return [...prev, { inventoryItemId: materialId, quantity: '1', chargedUnitPriceUsd: '0' }]
      }
      if (!checked && exists) return prev.filter((x) => x.inventoryItemId !== materialId)
      return prev
    })
  }

  function updateDermMaterialLine(
    materialId: string,
    field: 'quantity' | 'chargedUnitPriceUsd',
    value: string,
  ) {
    setDermSelectedMaterials((prev) =>
      prev.map((line) => (line.inventoryItemId === materialId ? { ...line, [field]: value } : line)),
    )
  }

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

      <div className="tabs" role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
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
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.25rem' }}>
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
                    {role === 'dermatology' || role === 'dental_branch' ? (
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
                                {formatLaserCollectedUsd(s.collectedAmountUsd ?? null)}
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
                    {role === 'dermatology' ? (
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
                            <th>الكلفة (USD)</th>
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
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{v.costUsd}</td>
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
            </header>

            <div className="laser-session-workspace__grid">
              <section className="card laser-panel">
                <h3 className="card-title" style={{ fontSize: '0.95rem' }}>
                  معلومات الجلسة
                </h3>
                <div className="grid-2" style={{ marginTop: '0.5rem' }}>
                  <div>
                    <span className="form-label">رقم المعالجة</span>
                    <input className="input" readOnly value={nextTreatmentHint} />
                  </div>
                  <div>
                    <span className="form-label">التاريخ</span>
                    <input className="input" readOnly value={new Date().toISOString().slice(0, 10)} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="form-label">المعالج المسؤول</span>
                    <input className="input" readOnly value={user?.name ?? '—'} />
                  </div>
                </div>
                <span className="form-label" style={{ marginTop: '1rem', display: 'block' }}>
                  نوع الليزر
                </span>
            <div className="segmented" style={{ marginBottom: '1rem' }}>
              {laserTypes.map((lt) => (
                <label key={lt}>
                  <input
                    type="radio"
                    name="laserType"
                    checked={laserType === lt}
                    onChange={() => setLaserType(lt)}
                  />
                  <span>{lt}</span>
                </label>
              ))}
            </div>
              </section>

              <section className="card laser-panel">
            <div className="fieldset">
              <legend>المعايير التقنية</legend>
              <div className="grid-2">
                <div>
                  <label className="form-label" htmlFor="pw">
                    P.W
                  </label>
                  <input
                    id="pw"
                    className="input"
                    placeholder="0"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="pulse">
                    Pulse
                  </label>
                  <input
                    id="pulse"
                    className="input"
                    placeholder="0"
                    value={pulse}
                    onChange={(e) => setPulse(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="shots">
                    عدد الضربات
                  </label>
                  <input
                    id="shots"
                    className="input"
                    inputMode="numeric"
                    placeholder="0"
                    value={shotCount}
                    onChange={(e) => setShotCount(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <label className="form-label" htmlFor="lnotes">
              ملاحظات (تنبيهات للحالة)
            </label>
            <textarea
              id="lnotes"
              className="textarea"
              placeholder="..."
              value={laserNotes}
              onChange={(e) => setLaserNotes(e.target.value)}
            />
              </section>

              <section className="card laser-panel laser-panel--wide">
            <h3 className="card-title" style={{ marginTop: 0 }}>
              الغرفة
            </h3>
            <div className="tabs" style={{ border: 'none', marginBottom: '0.5rem' }}>
              <button
                type="button"
                className={`tab${room === '1' ? ' active' : ''}`}
                onClick={() => setRoom('1')}
              >
                غرفة 1
              </button>
              <button
                type="button"
                className={`tab${room === '2' ? ' active' : ''}`}
                onClick={() => setRoom('2')}
              >
                غرفة 2
              </button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              المعيّنون: غرفة {room} — أخصائية (يمكن لمدير النظام إعادة التوزيع)
            </p>
            <h3 className="card-title" style={{ marginTop: '1.5rem' }}>
              اختيار المناطق
            </h3>
            <LaserAreaPicker
              key={laserPickerKey}
              catalog={laserCatalog.length ? laserCatalog : undefined}
              onAreasChange={onLaserAreasChange}
              extraSelectedCount={laserManualAreas.length}
            />
            <div className="laser-manual-areas">
              <label className="form-label" htmlFor="laser-manual-area">
                منطقة يدوية (اختياري)
              </label>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                أضف وصفاً حرّاً إن لم تكن المنطقة في القائمة.
              </p>
              <div className="laser-manual-areas__row">
                <input
                  id="laser-manual-area"
                  className="input"
                  placeholder="مثال: منطقة تحت الكتف"
                  value={laserManualInput}
                  onChange={(e) => setLaserManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addLaserManualArea()
                    }
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => addLaserManualArea()}>
                  إضافة
                </button>
              </div>
              {laserManualAreas.length > 0 ? (
                <div className="laser-manual-chips">
                  {laserManualAreas.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="laser-manual-chip"
                      onClick={() => setLaserManualAreas((prev) => prev.filter((x) => x !== t))}
                      title="إزالة"
                    >
                      {t} ×
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
              </section>

              <section className="card laser-panel">
            <div className="fieldset" style={{ marginTop: 0 }}>
              <legend>المبلغ وبند الفوترة</legend>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
                يُحفظ مع الجلسة في نفس الخطوة. المبلغ المستحق بعد الحسم يظهر في «التحصيل» للاستقبال حتى تأكيد
                الدفع والترحيل المحاسبي.
              </p>
              <div className="grid-2">
                <div>
                  <label className="form-label" htmlFor="laser-cost-usd">
                    المبلغ الإجمالي (USD)
                  </label>
                  <input
                    id="laser-cost-usd"
                    className="input"
                    inputMode="decimal"
                    placeholder="مثال: 150"
                    value={laserCostUsd}
                    onChange={(e) => setLaserCostUsd(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="laser-discount-pct">
                    حسم %
                  </label>
                  <input
                    id="laser-discount-pct"
                    className="input"
                    inputMode="numeric"
                    placeholder="0"
                    value={laserDiscountPercent}
                    onChange={(e) => setLaserDiscountPercent(e.target.value)}
                  />
                </div>
              </div>
              {laserNetDuePreview != null ? (
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
                  <strong>المستحق للتحصيل:</strong> {laserNetDuePreview} USD
                </p>
              ) : null}
            </div>
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
              disabled={
                savingLaser ||
                (role !== 'super_admin' && role !== 'laser' && role !== 'reception')
              }
              title={
                role !== 'super_admin' && role !== 'laser' && role !== 'reception'
                  ? 'الحفظ متاح للاستقبال ومشغّل الليزر والمدير'
                  : undefined
              }
              onClick={async () => {
                if (!id) return
                setLaserSessionErr('')
                setLaserSessionOk('')
                const gross = parseFloat(laserCostUsd)
                if (!(gross > 0)) {
                  setLaserSessionErr('أدخل المبلغ الإجمالي (USD) أكبر من صفر.')
                  return
                }
                const disc = parseFloat(laserDiscountPercent) || 0
                const net = gross * (1 - Math.min(100, Math.max(0, disc)) / 100)
                if (!(net > 0)) {
                  setLaserSessionErr('المبلغ بعد الحسم يجب أن يكون أكبر من صفر.')
                  return
                }
                setSavingLaser(true)
                try {
                  const created = await api<{
                    billingItem: { amountDueUsd: number }
                  }>('/api/laser/sessions', {
                    method: 'POST',
                    body: JSON.stringify({
                      patientId: id,
                      room,
                      laserType,
                      pw,
                      pulse,
                      shotCount,
                      notes: laserNotes,
                      areaIds: laserAreaIds,
                      manualAreaLabels: laserManualAreas,
                      status: 'in_progress',
                      costUsd: gross,
                      discountPercent: disc,
                      businessDate: clinicBusinessDate ?? undefined,
                    }),
                  })
                  setLaserSessionOk(
                    `تم حفظ الجلسة وبند الفوترة. المستحق للتحصيل: ${created.billingItem.amountDueUsd} USD (صفحة التحصيل للاستقبال).`,
                  )
                  setLaserCostUsd('')
                  setLaserDiscountPercent('0')
                  setLaserNotes('')
                  setLaserAreaIds([])
                  setLaserManualAreas([])
                  setLaserManualInput('')
                  setLaserPickerKey((k) => k + 1)
                  setPw('')
                  setPulse('')
                  setShotCount('')
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
              {savingLaser ? 'جاري الحفظ…' : 'حفظ الجلسة والفوترة'}
            </button>
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
              اختر المواد (متعدد)، أدخل الكمية وسعر التحصيل لكل مادة، ثم احفظ لإنشاء بند التحصيل وخصم المخزون فوراً.
            </p>
            <div className="grid-2">
              <div>
                <label className="form-label">وصف الإجراء / الجلسة</label>
                <input
                  className="input"
                  value={dermProcedureDescription}
                  onChange={(e) => setDermProcedureDescription(e.target.value)}
                  placeholder="مثال: حقن تجميلي للوجه"
                />
              </div>
              <div>
                <label className="form-label">رسوم الجلسة الأساسية (USD)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={dermSessionFeeUsd}
                  onChange={(e) => setDermSessionFeeUsd(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div style={{ marginTop: '0.85rem' }}>
              <label className="form-label">ملاحظات طبية</label>
              <textarea
                className="textarea"
                rows={3}
                value={dermNotes}
                onChange={(e) => setDermNotes(e.target.value)}
                placeholder="ملاحظات مرتبطة بالإجراء..."
              />
            </div>
            <h3 className="card-title" style={{ marginTop: '1rem', fontSize: '0.95rem' }}>
              مواد الجلدية (المستودع المركزي)
            </h3>
            {dermMaterialsCatalog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.88rem' }}>
                لا توجد مواد فعّالة/متاحة بالمخزون حالياً.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {dermMaterialsCatalog.map((item) => {
                  const selected = dermSelectedMaterials.find((x) => x.inventoryItemId === item.id)
                  return (
                    <div
                      key={item.id}
                      style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.65rem' }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(selected)}
                          onChange={(e) => toggleDermMaterial(item.id, e.target.checked)}
                        />
                        <strong>{item.name}</strong>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          ({item.quantity} {item.unit} متاح)
                        </span>
                      </label>
                      {selected ? (
                        <div className="grid-2" style={{ marginTop: '0.5rem' }}>
                          <div>
                            <label className="form-label">الكمية المستخدمة</label>
                            <input
                              className="input"
                              inputMode="decimal"
                              value={selected.quantity}
                              onChange={(e) =>
                                updateDermMaterialLine(item.id, 'quantity', e.target.value)
                              }
                            />
                          </div>
                          <div>
                            <label className="form-label">سعر التحصيل للوحدة (USD)</label>
                            <input
                              className="input"
                              inputMode="decimal"
                              value={selected.chargedUnitPriceUsd}
                              onChange={(e) =>
                                updateDermMaterialLine(item.id, 'chargedUnitPriceUsd', e.target.value)
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ marginTop: '0.85rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              رسوم الجلسة: <strong>{Math.max(0, parseFloat(dermSessionFeeUsd) || 0)} USD</strong> — مواد محصلة:{' '}
              <strong>{dermMaterialChargeTotal} USD</strong> — الإجمالي للتحصيل: <strong>{dermGrossTotal} USD</strong>
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
                const fee = Math.max(0, parseFloat(dermSessionFeeUsd) || 0)
                if (fee <= 0) {
                  setDermErr('أدخل رسوم الجلسة الأساسية أكبر من صفر.')
                  return
                }
                const payloadMaterials = dermSelectedMaterials
                  .map((line) => ({
                    inventoryItemId: line.inventoryItemId,
                    quantity: Math.max(0, parseFloat(line.quantity) || 0),
                    chargedUnitPriceUsd: Math.max(0, parseFloat(line.chargedUnitPriceUsd) || 0),
                  }))
                  .filter((x) => x.quantity > 0)
                setDermSaving(true)
                try {
                  const created = await api<{
                    billingItem: { amountDueUsd: number; id: string }
                  }>('/api/clinical/sessions', {
                    method: 'POST',
                    body: JSON.stringify({
                      department: 'dermatology',
                      patientId: id,
                      sessionFeeUsd: fee,
                      procedureDescription: dermProcedureDescription.trim(),
                      notes: dermNotes.trim(),
                      materials: payloadMaterials,
                      businessDate: clinicBusinessDate ?? undefined,
                    }),
                  })
                  const sessionsData = await api<{ sessions: DermatologySessionRow[] }>(
                    `/api/clinical/sessions/patient/${encodeURIComponent(id)}`,
                  )
                  setDermSessions(sessionsData.sessions.filter((s) => s.department === 'dermatology'))
                  const itemsData = await api<{ items: DermatologyMaterialOption[] }>(
                    '/api/inventory/items?activeOnly=1&inStockOnly=1',
                  )
                  setDermMaterialsCatalog(itemsData.items)
                  setDermProcedureDescription('')
                  setDermSessionFeeUsd('')
                  setDermNotes('')
                  setDermSelectedMaterials([])
                  setDermOk(
                    `تم حفظ الجلسة وخصم المواد وإنشاء بند تحصيل بقيمة ${created.billingItem.amountDueUsd} USD. يظهر في صفحة التحصيل للاستقبال.`,
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
                      <th>الإجمالي (USD)</th>
                      <th>حالة التحصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dermSessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.businessDate}</td>
                        <td>{s.procedureDescription || '—'}</td>
                        <td>{s.providerName}</td>
                        <td>{s.amountDueUsd}</td>
                        <td>{s.billingStatus === 'paid' ? 'مدفوع' : 'بانتظار التحصيل'}</td>
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
                <div className="val">2٬400 USD</div>
              </div>
              <div className="stat-card">
                <div className="lbl">المدفوع</div>
                <div className="val">1٬000 USD</div>
              </div>
              <div className="stat-card" style={{ borderColor: 'var(--warning)' }}>
                <div className="lbl">المتبقي</div>
                <div className="val" style={{ color: 'var(--warning)' }}>
                  1٬400 USD
                </div>
              </div>
            </div>
            </>
            )}
          </div>
        ) : (
          <div className="no-access">
            <strong>لا تملك صلاحية ملف الأسنان</strong>
          </div>
        ))}

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
                الكلفة (USD)
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Number(laserSessionDetail.costUsd).toLocaleString('ar-SY', { maximumFractionDigits: 2 })}
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
                {formatLaserCollectedUsd(laserSessionDetail.collectedAmountUsd ?? null)}
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
