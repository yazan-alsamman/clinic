import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import type { Patient } from '../types'
import { APPOINTMENT_PROCEDURE_OPTIONS } from '../utils/procedureCategory'
import { slotIntervalFromRow, intervalsOverlapHalfOpen } from '../utils/scheduleTime'

const DAY_START_MIN = 9 * 60
const DAY_END_MIN = 21 * 60
const WALK_IN_DURATION_MIN = 30

const DERMATOLOGY_PROCEDURE_OPTIONS = [
  'فيلر',
  'بوتوكس',
  'استشارة',
  'ابرة نضارة',
  'تقشير',
  'ديرما',
  'حقن شعر',
  'إزالة زوائد',
] as const

const DEFAULT_SKIN_NAMES = ['عادي', 'VIP', 'دلال', 'organic', 'كاربوكسي'] as const

type WalkKind = 'laser' | 'dermatology' | 'skin' | 'dental' | 'solarium'

type SlotRow = {
  id: string
  businessDate: string
  time: string
  endTime?: string
  providerName: string
  procedureType?: string
  patientId: string | null
  patientName: string
  roomNumber?: number | null
}

type LaserProcedureItem = {
  id: string
  name: string
  groupId: string
  groupTitle: string
  kind: 'area' | 'offer'
  priceSyp: number
  priceMaleSyp?: number
  priceFemaleSyp?: number
  active: boolean
  sortOrder: number
}

type LaserProcedureGroup = { id: string; title: string; items: LaserProcedureItem[] }

type DermatologyBoard = {
  id: string
  index: number
  title: string
  assigned: { id: string; name: string } | null
}

type SkinProcedureOption = { id: string; name: string; priceSyp: number; active: boolean; sortOrder: number }

function toHm(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function resolveLaserItemPriceByGender(item: LaserProcedureItem, gender: '' | 'male' | 'female') {
  if (gender === 'male' && item.priceMaleSyp != null) return Math.max(0, Math.round(Number(item.priceMaleSyp) || 0))
  if (gender === 'female' && item.priceFemaleSyp != null) return Math.max(0, Math.round(Number(item.priceFemaleSyp) || 0))
  return Math.max(0, Math.round(Number(item.priceSyp) || 0))
}

function intervalOverlapsBookedSlots(
  slotRows: SlotRow[],
  providerName: string,
  startMin: number,
  endMin: number,
): boolean {
  const p = providerName.trim()
  return slotRows.some((x) => {
    if (String(x.providerName || '').trim() !== p) return false
    const o = slotIntervalFromRow(x.time, x.endTime)
    if (!o) return false
    return intervalsOverlapHalfOpen(startMin, endMin, o.start, o.end)
  })
}

function patientDebtCreditSyp(p: Patient) {
  return {
    debt: Math.round(Number(p.outstandingDebtSyp) || 0),
    credit: Math.round(Number(p.prepaidCreditSyp) || 0),
  }
}

function fmtSypAmount(n: number) {
  return `${n.toLocaleString('ar-SY')} ل.س`
}

export function ReceptionWalkInSessionPage() {
  const { user } = useAuth()
  const { dayActive, businessDate: ctxBusinessDate } = useClinic()
  const navigate = useNavigate()
  const canUse = user?.role === 'super_admin' || user?.role === 'reception'
  const assignBlocked = user?.role === 'reception' && !dayActive

  const businessDate = (ctxBusinessDate || todayYmd()).trim()
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  const [kind, setKind] = useState<WalkKind>('laser')
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [patientQ, setPatientQ] = useState('')
  const [patientHits, setPatientHits] = useState<Patient[]>([])
  const [patientSearchLoading, setPatientSearchLoading] = useState(false)
  const [picked, setPicked] = useState<Patient | null>(null)
  const [declinedNewPatientForName, setDeclinedNewPatientForName] = useState<string | null>(null)
  const [newPatientGenderPending, setNewPatientGenderPending] = useState<'' | 'male' | 'female'>('')
  const [newPatientPhoneForCreate, setNewPatientPhoneForCreate] = useState('')
  const [creatingPatient, setCreatingPatient] = useState(false)

  const [laserProcedureGroups, setLaserProcedureGroups] = useState<LaserProcedureGroup[]>([])
  const [laserProcedureLoading, setLaserProcedureLoading] = useState(false)
  const [selectedLaserItemIds, setSelectedLaserItemIds] = useState<string[]>([])
  const [laserProviders, setLaserProviders] = useState<{ id: string; name: string }[]>([])
  const [selectedLaserProviderId, setSelectedLaserProviderId] = useState('')

  const [dermatologyBoards, setDermatologyBoards] = useState<DermatologyBoard[]>([])
  const [dermBoardTitle, setDermBoardTitle] = useState('')
  const [dermProcedure, setDermProcedure] = useState('')

  const [skinProcedureOptions, setSkinProcedureOptions] = useState<SkinProcedureOption[]>([])
  const [skinProcedureName, setSkinProcedureName] = useState('')

  const [dentalProcedure, setDentalProcedure] = useState('')

  const [solariumMinutes, setSolariumMinutes] = useState<6 | 12>(6)
  const [solariumProviders, setSolariumProviders] = useState<{ id: string; name: string }[]>([])
  const [solariumProviderId, setSolariumProviderId] = useState('')
  const [solariumAmountSyp, setSolariumAmountSyp] = useState('')

  const loadSlots = useCallback(async () => {
    if (!canUse) return
    setSlotsLoading(true)
    try {
      const data = await api<{ slots: SlotRow[] }>(`/api/schedule?date=${encodeURIComponent(businessDate)}`)
      setSlots(data.slots || [])
    } catch {
      setSlots([])
    } finally {
      setSlotsLoading(false)
    }
  }, [canUse, businessDate])

  useEffect(() => {
    void loadSlots()
  }, [loadSlots])

  useEffect(() => {
    if (!canUse) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ groups: LaserProcedureGroup[] }>('/api/laser/procedure-options')
        if (!cancelled) setLaserProcedureGroups(data.groups || [])
      } catch {
        if (!cancelled) setLaserProcedureGroups([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canUse])

  useEffect(() => {
    if (!canUse || kind !== 'laser') return
    let cancelled = false
    setLaserProcedureLoading(true)
    ;(async () => {
      try {
        const data = await api<{ providers: { id: string; name: string }[] }>(
          '/api/clinical/provider-options?department=laser',
        )
        if (!cancelled) {
          const rows = data.providers || []
          setLaserProviders(rows)
          setSelectedLaserProviderId((prev) => {
            if (prev && rows.some((r) => r.id === prev)) return prev
            return rows[0]?.id || ''
          })
        }
      } catch {
        if (!cancelled) {
          setLaserProviders([])
          setSelectedLaserProviderId('')
        }
      } finally {
        if (!cancelled) setLaserProcedureLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canUse, kind])

  useEffect(() => {
    if (!canUse) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ boards: DermatologyBoard[] }>('/api/schedule/dermatology-boards')
        const rows = (data.boards || []).filter((b) => b.assigned?.id)
        if (!cancelled) {
          setDermatologyBoards(rows)
          setDermBoardTitle((prev) => {
            if (prev && rows.some((r) => r.title === prev)) return prev
            return rows[0]?.title || ''
          })
        }
      } catch {
        if (!cancelled) setDermatologyBoards([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canUse])

  useEffect(() => {
    if (!canUse || kind !== 'skin') return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ options: SkinProcedureOption[] }>('/api/skin/procedure-options')
        const opts = (data.options || []).filter((x) => String(x?.name || '').trim())
        if (!cancelled) {
          setSkinProcedureOptions(opts)
          setSkinProcedureName((prev) => {
            if (prev && opts.some((o) => o.name === prev)) return prev
            return opts[0]?.name || ''
          })
        }
      } catch {
        if (!cancelled) {
          setSkinProcedureOptions([])
          setSkinProcedureName('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canUse, kind])

  useEffect(() => {
    if (!canUse || kind !== 'solarium') return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ providers: { id: string; name: string }[] }>(
          '/api/clinical/provider-options?department=solarium',
        )
        const rows = data.providers || []
        if (!cancelled) {
          setSolariumProviders(rows)
          setSolariumProviderId((prev) => {
            if (prev && rows.some((r) => r.id === prev)) return prev
            return rows[0]?.id || ''
          })
        }
      } catch {
        if (!cancelled) {
          setSolariumProviders([])
          setSolariumProviderId('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canUse, kind])

  useEffect(() => {
    const q = patientQ.trim()
    if (q.length < 2) {
      setPatientHits([])
      setPatientSearchLoading(false)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      setPatientSearchLoading(true)
      ;(async () => {
        try {
          const data = await api<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(q)}`)
          if (!cancelled) setPatientHits(data.patients.slice(0, 10))
        } catch {
          if (!cancelled) setPatientHits([])
        } finally {
          if (!cancelled) setPatientSearchLoading(false)
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [patientQ])

  useEffect(() => {
    if (declinedNewPatientForName && patientQ.trim() !== declinedNewPatientForName) {
      setDeclinedNewPatientForName(null)
    }
  }, [patientQ, declinedNewPatientForName])

  const laserItemById = useMemo(() => {
    const map = new Map<string, LaserProcedureItem>()
    for (const g of laserProcedureGroups) {
      for (const item of g.items) map.set(item.id, item)
    }
    return map
  }, [laserProcedureGroups])

  const selectedLaserItems = useMemo(
    () => selectedLaserItemIds.map((id) => laserItemById.get(id)).filter((x): x is LaserProcedureItem => Boolean(x)),
    [selectedLaserItemIds, laserItemById],
  )

  const selectedGenderForLaser: '' | 'male' | 'female' =
    picked?.gender === 'male' || picked?.gender === 'female' ? picked.gender : newPatientGenderPending

  function selectGenderForNewPatient(gender: 'male' | 'female') {
    setFormErr('')
    setNewPatientGenderPending(gender)
  }

  async function createNewPatientFromSearch() {
    const gender = newPatientGenderPending
    if (gender !== 'male' && gender !== 'female') return
    const name = patientQ.trim()
    if (name.length < 2) return
    const phoneRaw = newPatientPhoneForCreate.trim()
    const digits = phoneRaw.replace(/\D/g, '')
    if (digits.length < 7) {
      setFormErr('أدخل رقم موبايل صالحاً (7 أرقام على الأقل) لإكمال إنشاء الملف.')
      return
    }
    setFormErr('')
    setCreatingPatient(true)
    try {
      const data = await api<{ patient: Patient }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({ name, gender, phone: phoneRaw }),
      })
      setPicked(data.patient)
      setPatientHits([])
      setDeclinedNewPatientForName(null)
      setNewPatientGenderPending('')
      setNewPatientPhoneForCreate('')
      setSuccessMsg(`تم إنشاء ملف «${data.patient.name}». أكمل نوع الجلسة ثم التأكيد.`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        setFormErr('يوم العمل غير مفعّل — لا يمكن إنشاء مريض جديد.')
      } else {
        setFormErr(e instanceof ApiError ? e.message : 'تعذر إنشاء المريض')
      }
    } finally {
      setCreatingPatient(false)
    }
  }

  async function assignArriveNavigate(params: {
    providerName: string
    serviceType: 'dermatology' | 'dental'
    roomNumber?: number | null
    procedureType: string
    patientId: string
    buildUrl: (slotId: string) => string
  }) {
    const proc = params.procedureType.trim().slice(0, 200)
    const duration = WALK_IN_DURATION_MIN
    let lastErr = ''
    for (let m = DAY_START_MIN; m + duration <= DAY_END_MIN; m += 15) {
      const time = toHm(m)
      const endTime = toHm(m + duration)
      if (intervalOverlapsBookedSlots(slots, params.providerName, m, m + duration)) continue
      try {
        const data = await api<{ slot?: { id: string } }>('/api/schedule/assign', {
          method: 'POST',
          body: JSON.stringify({
            businessDate,
            time,
            endTime,
            providerName: params.providerName,
            serviceType: params.serviceType,
            roomNumber: params.roomNumber ?? undefined,
            procedureType: proc,
            patientId: params.patientId,
          }),
        })
        const slotId = data.slot?.id
        if (!slotId) throw new Error('لم يُعاد معرف الموعد')
        await api(`/api/schedule/arrive/${encodeURIComponent(slotId)}`, { method: 'POST' })
        await loadSlots()
        navigate(params.buildUrl(slotId))
        setSuccessMsg(
          'تم تسجيل الوصول — يظهر المريض لدى الأخصائي في «إنشاء جلسة»، وبعد إنهاء الجلسة يظهر المبلغ في التحصيل.',
        )
        return
      } catch (e) {
        lastErr = e instanceof ApiError ? e.message : 'فشل الحجز'
        if (e instanceof ApiError && e.status === 409) continue
        if (e instanceof ApiError && e.status === 423) {
          setFormErr(e.message || 'يوم العمل غير مفعّل')
          return
        }
        break
      }
    }
    setFormErr(lastErr || 'تعذر إيجاد وقتاً فارغاً على هذا السطر اليوم — حدّث الجدول وحاول مجدداً.')
  }

  async function submitLaser() {
    if (!picked || !selectedLaserProviderId) {
      setFormErr('اختر المريض وأخصائي الليزر')
      return
    }
    const proc = selectedLaserItems.map((i) => i.name).join(' + ').trim()
    if (!proc) {
      setFormErr('اختر منطقة أو عرضاً واحداً على الأقل')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      let lastErr = ''
      for (let m = DAY_START_MIN; m + WALK_IN_DURATION_MIN <= DAY_END_MIN; m += 15) {
        const timeStr = toHm(m)
        const optData = await api<{ providers: { roomNumber: number; userId: string; name: string }[] }>(
          `/api/schedule/laser-provider-options?time=${encodeURIComponent(timeStr)}`,
        )
        const match = optData.providers.find((p) => p.userId === selectedLaserProviderId)
        if (!match) continue
        const channel = `Laser Room ${match.roomNumber}`
        if (intervalOverlapsBookedSlots(slots, channel, m, m + WALK_IN_DURATION_MIN)) continue
        try {
          const data = await api<{ slot?: { id: string } }>('/api/schedule/assign', {
            method: 'POST',
            body: JSON.stringify({
              businessDate,
              time: timeStr,
              endTime: toHm(m + WALK_IN_DURATION_MIN),
              providerName: channel,
              serviceType: 'laser',
              roomNumber: match.roomNumber,
              procedureType: proc.slice(0, 200),
              patientId: picked.id,
            }),
          })
          const slotId = data.slot?.id
          if (!slotId) throw new Error('لم يُعاد معرف الموعد')
          await api(`/api/schedule/arrive/${encodeURIComponent(slotId)}`, { method: 'POST' })
          await loadSlots()
          navigate(
            `/patients/${picked.id}?tab=laser&laserProc=${encodeURIComponent(proc)}&laserSlotId=${encodeURIComponent(slotId)}&laserRoom=${encodeURIComponent(String(match.roomNumber))}`,
          )
          setSuccessMsg(
            'تم تسجيل الوصول — تظهر الجلسة عند أخصائي الليزر في «إنشاء جلسة»؛ بعد إنهاء الجلسة يظهر السعر في التحصيل.',
          )
          return
        } catch (e) {
          lastErr = e instanceof ApiError ? e.message : 'فشل الحجز'
          if (e instanceof ApiError && e.status === 409) continue
          if (e instanceof ApiError && e.status === 423) {
            setFormErr(e.message || 'يوم العمل غير مفعّل')
            return
          }
          break
        }
      }
      setFormErr(
        lastErr || 'تعذر إيجاد وقتاً لهذا الأخصائي ضمن الدوام — جرّب أخصائياً آخر أو حدّث الجدول.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function submitDermatology() {
    if (!picked || !dermBoardTitle.trim()) {
      setFormErr('اختر المريض وجدول الطبيب')
      return
    }
    if (!dermProcedure.trim()) {
      setFormErr('اختر نوع الإجراء')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      const procEnc = dermProcedure.trim()
      await assignArriveNavigate({
        providerName: dermBoardTitle.trim(),
        serviceType: 'dermatology',
        procedureType: procEnc,
        patientId: picked.id,
        buildUrl: (slotId) =>
          `/patients/${picked.id}?tab=dermatology&dermProc=${encodeURIComponent(procEnc)}&dermSlotId=${encodeURIComponent(slotId)}`,
      })
    } finally {
      setSaving(false)
    }
  }

  async function submitSkin() {
    if (!picked || !skinProcedureName.trim()) {
      setFormErr('اختر المريض ونوع إجراء البشرة')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      const proc = skinProcedureName.trim()
      let lastErr = ''
      for (let m = DAY_START_MIN; m + WALK_IN_DURATION_MIN <= DAY_END_MIN; m += 15) {
        const time = toHm(m)
        const endTime = toHm(m + WALK_IN_DURATION_MIN)
        const channel = 'قسم البشرة'
        if (intervalOverlapsBookedSlots(slots, channel, m, m + WALK_IN_DURATION_MIN)) continue
        try {
          const data = await api<{ slot?: { id: string } }>('/api/schedule/assign', {
            method: 'POST',
            body: JSON.stringify({
              businessDate,
              time,
              endTime,
              providerName: channel,
              serviceType: 'skin',
              procedureType: proc.slice(0, 200),
              patientId: picked.id,
            }),
          })
          const slotId = data.slot?.id
          if (!slotId) throw new Error('لم يُعاد معرف الموعد')
          await api(`/api/schedule/arrive/${encodeURIComponent(slotId)}`, { method: 'POST' })
          await loadSlots()
          navigate(`/patients/${picked.id}?tab=solarium&dermProc=${encodeURIComponent(proc)}`)
          setSuccessMsg('تم تسجيل الوصول — بند التحصيل يُنشأ تلقائياً حسب نوع الإجراء.')
          return
        } catch (e) {
          lastErr = e instanceof ApiError ? e.message : 'فشل الحجز'
          if (e instanceof ApiError && e.status === 409) continue
          if (e instanceof ApiError && e.status === 423) {
            setFormErr(e.message || 'يوم العمل غير مفعّل')
            return
          }
          break
        }
      }
      setFormErr(lastErr || 'تعذر إيجاد وقتاً فارغاً لقسم البشرة اليوم.')
    } finally {
      setSaving(false)
    }
  }

  async function submitDental() {
    if (!picked || !dentalProcedure.trim()) {
      setFormErr('اختر المريض ونوع الإجراء')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      await assignArriveNavigate({
        providerName: 'أسنان',
        serviceType: 'dental',
        procedureType: dentalProcedure.trim(),
        patientId: picked.id,
        buildUrl: () => `/patients/${picked.id}?tab=dental`,
      })
    } finally {
      setSaving(false)
    }
  }

  async function submitSolarium() {
    if (!picked || !solariumProviderId) {
      setFormErr('اختر المريض ومقدّم السولاريوم')
      return
    }
    const fee = Math.max(0, Math.round(Number(solariumAmountSyp.replace(/[^\d.]/g, '')) || 0))
    if (!(fee > 0)) {
      setFormErr('أدخل المبلغ المقبوض بالليرة (أكبر من صفر)')
      return
    }
    setSaving(true)
    setFormErr('')
    try {
      const procLabel = `سولاريوم — ${solariumMinutes} دقيقة`
      const sessionRes = await api<{ billingItem?: { id: string } }>('/api/clinical/sessions/reception', {
        method: 'POST',
        body: JSON.stringify({
          patientId: picked.id,
          providerUserId: solariumProviderId,
          department: 'solarium',
          sessionFeeSyp: fee,
          procedureDescription: procLabel,
          businessDate,
        }),
      })
      const billId = sessionRes.billingItem?.id
      if (!billId) throw new Error('لم يُعاد معرف بند التحصيل')
      await api(`/api/billing/${encodeURIComponent(billId)}/complete-payment`, {
        method: 'POST',
        body: JSON.stringify({
          payCurrency: 'SYP',
          paymentChannel: 'cash',
          amountSyp: fee,
          discountPercent: 0,
        }),
      })
      setSuccessMsg(
        `تم تسجيل جلسة السولاريوم (${procLabel}) وتحصيل ${fmtSypAmount(fee)} نقداً — يُرحّل المبلغ إلى الجرد المالي اليومي.`,
      )
      setSolariumAmountSyp('')
      void loadSlots()
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : 'تعذر إتمام التسجيل أو التحصيل')
    } finally {
      setSaving(false)
    }
  }

  if (!canUse) {
    return (
      <>
        <h1 className="page-title">إنشاء جلسة بدون موعد</h1>
        <p className="page-desc">هذه الصفحة متاحة لموظفي الاستقبال فقط.</p>
      </>
    )
  }

  const debtCredit = picked ? patientDebtCreditSyp(picked) : null

  return (
    <>
      <h1 className="page-title">إنشاء جلسة بدون موعد</h1>
      <p className="page-desc">
        تسجيل مريض وصولاً مباشرةً دون حجز مسبق: يُنشأ موعد اليوم مع «وصل المريض» فيظهر عند الأخصائي في صفحة «إنشاء جلسة»
        لاستكمال الجلسة؛ يصل المبلغ إلى التحصيل بعد إنهاء الجلسة (ما عدا السولاريوم حيث يُحصّل نقداً فوراً ويُرحّل للجرد).
      </p>

      {assignBlocked ? (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }}>
          <p style={{ margin: 0, color: 'var(--amber)' }}>
            يوم العمل غير مفعّل — لا يمكن تسجيل وصول أو حجز من الاستقبال حتى يفعّل المدير اليوم.
          </p>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          يوم العمل المعتمد: <strong dir="ltr">{businessDate}</strong>
          {slotsLoading ? ' — جاري تحديث الجدول…' : null}
        </span>
        <button type="button" className="btn btn-secondary" style={{ marginRight: '0.75rem' }} onClick={() => void loadSlots()}>
          تحديث الجدول
        </button>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label className="form-label">نوع الجلسة</label>
        <select className="select" style={{ maxWidth: 420 }} value={kind} onChange={(e) => setKind(e.target.value as WalkKind)}>
          <option value="laser">ليزر</option>
          <option value="dermatology">جلدية</option>
          <option value="skin">بشرة</option>
          <option value="dental">أسنان</option>
          <option value="solarium">سولاريوم</option>
        </select>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title" style={{ marginTop: 0 }}>
          المريض
        </h2>
        <label className="form-label" htmlFor="wi-patient-q">
          بحث بالاسم (ملف موجود)
        </label>
        <input
          id="wi-patient-q"
          className="input"
          value={patientQ}
          onChange={(e) => {
            setPatientQ(e.target.value)
            setNewPatientGenderPending('')
            setNewPatientPhoneForCreate('')
          }}
          placeholder="اكتب جزءاً من الاسم…"
          autoComplete="off"
        />
        {picked ? (
          <p style={{ marginTop: '0.65rem' }}>
            المختار: <strong>{picked.name}</strong>{' '}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem' }}
              onClick={() => {
                setPicked(null)
                setNewPatientGenderPending('')
                setNewPatientPhoneForCreate('')
              }}
            >
              إلغاء
            </button>
          </p>
        ) : patientSearchLoading && patientQ.trim().length >= 2 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>جاري البحث…</p>
        ) : patientHits.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
            {patientHits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%', justifyContent: 'flex-start', marginBottom: '0.35rem' }}
                  onClick={() => {
                    setPicked(p)
                    setPatientQ(p.name)
                    setPatientHits([])
                    setNewPatientGenderPending(p.gender === 'male' || p.gender === 'female' ? p.gender : '')
                    setNewPatientPhoneForCreate('')
                  }}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        ) : patientQ.trim().length >= 2 && !patientSearchLoading && patientQ.trim() !== declinedNewPatientForName ? (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.85rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg)',
            }}
          >
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>لا يوجد ملف بهذا الاسم. إنشاء ملف جديد؟</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingPatient || assignBlocked}
                onClick={() => selectGenderForNewPatient('male')}
              >
                ذكر
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingPatient || assignBlocked}
                onClick={() => selectGenderForNewPatient('female')}
              >
                أنثى
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={creatingPatient}
                onClick={() => {
                  setDeclinedNewPatientForName(patientQ.trim())
                  setNewPatientGenderPending('')
                  setNewPatientPhoneForCreate('')
                }}
              >
                لا
              </button>
            </div>
            {newPatientGenderPending ? (
              <div style={{ marginTop: '0.85rem' }}>
                <p style={{ margin: '0 0 0.45rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  أدخل رقم الموبايل ثم أنشئ الملف للمتابعة.
                </p>
                <label className="form-label" htmlFor="wi-new-patient-phone" style={{ marginBottom: '0.25rem' }}>
                  رقم الموبايل
                </label>
                <input
                  id="wi-new-patient-phone"
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="مثال: 09xxxxxxxx"
                  value={newPatientPhoneForCreate}
                  onChange={(e) => setNewPatientPhoneForCreate(e.target.value)}
                  disabled={creatingPatient || assignBlocked}
                  style={{ maxWidth: 280, marginBottom: '0.55rem' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    creatingPatient ||
                    assignBlocked ||
                    newPatientPhoneForCreate.trim().replace(/\D/g, '').length < 7
                  }
                  onClick={() => void createNewPatientFromSearch()}
                >
                  {creatingPatient ? 'جاري الإنشاء…' : 'إنشاء الملف'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {debtCredit && (debtCredit.debt > 0 || debtCredit.credit > 0) ? (
          <p style={{ marginTop: '0.75rem', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
            {debtCredit.debt > 0 ? (
              <>
                ذمة: <strong style={{ color: 'var(--danger)' }}>{fmtSypAmount(debtCredit.debt)}</strong>
              </>
            ) : null}{' '}
            {debtCredit.credit > 0 ? (
              <>
                رصيد: <strong style={{ color: 'var(--success)' }}>{fmtSypAmount(debtCredit.credit)}</strong>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {kind === 'laser' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>
            الليزر — المناطق والعروض
          </h2>
          {laserProcedureLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
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
                          style={{ fontSize: '0.82rem', padding: '0.38rem 0.58rem', borderRadius: 999 }}
                          onClick={() =>
                            setSelectedLaserItemIds((prev) =>
                              prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id],
                            )
                          }
                        >
                          {item.name} — {resolveLaserItemPriceByGender(item, selectedGenderForLaser).toLocaleString('ar-SY')}{' '}
                          ل.س
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: '1rem' }}>
            <label className="form-label">أخصائي الليزر</label>
            <select
              className="select"
              style={{ width: '100%', maxWidth: 480 }}
              value={selectedLaserProviderId}
              onChange={(e) => setSelectedLaserProviderId(e.target.value)}
            >
              <option value="">— اختر الأخصائي —</option>
              {laserProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              يُختار تلقائياً أول وقت فارغ اليوم ضمن وردية هذا الأخصائي على الغرفة.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            disabled={saving || assignBlocked || !picked}
            onClick={() => void submitLaser()}
          >
            {saving ? 'جاري التسجيل…' : 'تسجيل الوصول وفتح جلسة الليزر'}
          </button>
        </div>
      ) : null}

      {kind === 'dermatology' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>
            الجلدية
          </h2>
          <label className="form-label">الطبيب / الجدول</label>
          <select className="select" style={{ width: '100%', maxWidth: 420 }} value={dermBoardTitle} onChange={(e) => setDermBoardTitle(e.target.value)}>
            <option value="">— اختر —</option>
            {dermatologyBoards.map((b) => (
              <option key={b.id} value={b.title}>
                {b.title} {b.assigned ? `— ${b.assigned.name}` : ''}
              </option>
            ))}
          </select>
          <label className="form-label" style={{ marginTop: '0.85rem' }}>
            نوع الإجراء
          </label>
          <select className="select" style={{ width: '100%', maxWidth: 420 }} value={dermProcedure} onChange={(e) => setDermProcedure(e.target.value)}>
            <option value="">— اختر —</option>
            {DERMATOLOGY_PROCEDURE_OPTIONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            disabled={saving || assignBlocked || !picked}
            onClick={() => void submitDermatology()}
          >
            {saving ? 'جاري التسجيل…' : 'تسجيل الوصول وفتح الجلدية'}
          </button>
        </div>
      ) : null}

      {kind === 'skin' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>
            البشرة
          </h2>
          <label className="form-label">نوع الإجراء</label>
          <select
            className="select"
            style={{ width: '100%', maxWidth: 420 }}
            value={skinProcedureName}
            onChange={(e) => setSkinProcedureName(e.target.value)}
          >
            <option value="">— اختر —</option>
            {(skinProcedureOptions.length ? skinProcedureOptions.map((x) => x.name) : [...DEFAULT_SKIN_NAMES]).map((name) => (
              <option key={name} value={name}>
                {name}
                {skinProcedureOptions.find((o) => o.name === name)
                  ? ` — ${(skinProcedureOptions.find((o) => o.name === name)?.priceSyp || 0).toLocaleString('ar-SY')} ل.س`
                  : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            disabled={saving || assignBlocked || !picked}
            onClick={() => void submitSkin()}
          >
            {saving ? 'جاري التسجيل…' : 'تسجيل الوصول'}
          </button>
        </div>
      ) : null}

      {kind === 'dental' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>
            الأسنان
          </h2>
          <label className="form-label">نوع الإجراء</label>
          <select className="select" style={{ width: '100%', maxWidth: 420 }} value={dentalProcedure} onChange={(e) => setDentalProcedure(e.target.value)}>
            <option value="">— اختر —</option>
            {APPOINTMENT_PROCEDURE_OPTIONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            disabled={saving || assignBlocked || !picked}
            onClick={() => void submitDental()}
          >
            {saving ? 'جاري التسجيل…' : 'تسجيل الوصول وفتح ملف الأسنان'}
          </button>
        </div>
      ) : null}

      {kind === 'solarium' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>
            السولاريوم — تحصيل فوري
          </h2>
          <label className="form-label">مدة الجلسة</label>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="radio" name="solmin" checked={solariumMinutes === 6} onChange={() => setSolariumMinutes(6)} />6 دقائق
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="radio" name="solmin" checked={solariumMinutes === 12} onChange={() => setSolariumMinutes(12)} />12 دقيقة
            </label>
          </div>
          <label className="form-label" style={{ marginTop: '0.85rem' }}>
            المقدّم
          </label>
          <select
            className="select"
            style={{ width: '100%', maxWidth: 420 }}
            value={solariumProviderId}
            onChange={(e) => setSolariumProviderId(e.target.value)}
          >
            <option value="">— اختر —</option>
            {solariumProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="form-label" style={{ marginTop: '0.85rem' }}>
            المبلغ المقبوض (ل.س) — يُرحّل للجرد عبر التحصيل
          </label>
          <input
            className="input"
            dir="ltr"
            style={{ maxWidth: 220 }}
            inputMode="numeric"
            value={solariumAmountSyp}
            onChange={(e) => setSolariumAmountSyp(e.target.value)}
            placeholder="مثال: 150000"
          />
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            disabled={saving || assignBlocked || !picked}
            onClick={() => void submitSolarium()}
          >
            {saving ? 'جاري الحفظ…' : 'تسجيل الجلسة والتحصيل النقدي'}
          </button>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.65rem' }}>
            بعد النجاح يمكن مراجعة البند من{' '}
            <Link to="/billing" style={{ color: 'var(--cyan)' }}>
              التحصيل
            </Link>{' '}
            أو الجرد المالي اليومي.
          </p>
        </div>
      ) : null}

      {formErr ? (
        <p className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {formErr}
        </p>
      ) : null}
      {successMsg ? (
        <p className="card" style={{ color: 'var(--success)', marginBottom: '1rem' }}>
          {successMsg}{' '}
          <Link to="/billing" style={{ color: 'var(--cyan)' }}>
            صفحة التحصيل
          </Link>
          .
        </p>
      ) : null}
    </>
  )
}
