import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import type { Patient } from '../types'
import {
  normalizeTime,
  hmToMinutes,
  slotIntervalFromRow,
  intervalsOverlapHalfOpen,
} from '../utils/scheduleTime'
import { APPOINTMENT_PROCEDURE_OPTIONS } from '../utils/procedureCategory'

const SERVICE_OPTIONS = [
  { value: 'laser', label: 'ليزر' },
  { value: 'dental', label: 'أسنان' },
  { value: 'dermatology', label: 'جلدية' },
  { value: 'solarium', label: 'سولاريوم' },
] as const

type ServiceValue = (typeof SERVICE_OPTIONS)[number]['value']

const SERVICE_CHANNELS: Record<ServiceValue, string[]> = {
  laser: ['Laser Room 1', 'Laser Room 2'],
  dental: ['أسنان'],
  dermatology: ['جلدية'],
  solarium: ['سولاريوم'],
}

const LASER_ROOM_TITLES: Record<string, string> = {
  'Laser Room 1': 'Room 1',
  'Laser Room 2': 'Room 2',
}

type SlotRow = {
  id: string
  businessDate: string
  time: string
  endTime?: string
  providerName: string
  procedureType?: string
  status: 'free' | 'busy'
  patientId: string | null
  patientName: string
  roomNumber?: number | null
  assignedSpecialistName?: string
}

type LaserProcedureItem = {
  id: string
  code: string
  name: string
  groupId: string
  groupTitle: string
  kind: 'area' | 'offer'
  priceSyp: number
  active: boolean
  sortOrder: number
}

type LaserProcedureGroup = {
  id: string
  title: string
  items: LaserProcedureItem[]
}

const DAY_START_MIN = 9 * 60
const DAY_END_MIN = 20 * 60
/** الفرق بين أوقات البداية المعروضة (ساعة)؛ يُضاف وقت غير على الساعة فقط عند نهاية حجز يخرج عن التوقيت الكامل */
const HOURLY_DISPLAY_STEP_MIN = 60

function toHm(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** دمج فترات [بداية،نهاية) المتداخلة أو المتلامسة حتى لا تُحسب كل شريحة فرعية كنقطة نهاية منفصلة */
function mergeHalfOpenIntervals(intervals: { start: number; end: number }[]): { start: number; end: number }[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: { start: number; end: number }[] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (!last || iv.start > last.end) {
      out.push({ start: iv.start, end: iv.end })
    } else {
      last.end = Math.max(last.end, iv.end)
    }
  }
  return out
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tempFileNumber() {
  const d = new Date()
  return `TMP-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${d.getTime()
    .toString()
    .slice(-6)}`
}

function inferRoomNumber(channel: string) {
  const m = String(channel || '').match(/room\s*(\d+)/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function patientDebtCreditUsd(p: Patient) {
  return {
    debt: Math.round((Number(p.outstandingDebtUsd) || 0) * 100) / 100,
    credit: Math.round((Number(p.prepaidCreditUsd) || 0) * 100) / 100,
  }
}

function fmtUsdSyp(usdRaw: number, rateRaw: number | null | undefined) {
  const usd = Number(usdRaw) || 0
  const usdText = `${usd.toFixed(2)} USD`
  const r = rateRaw != null && Number.isFinite(Number(rateRaw)) && Number(rateRaw) > 0 ? Number(rateRaw) : null
  const sypText = r ? `${Math.round(usd * r).toLocaleString('ar-SY')} ل.س` : null
  return { usdText, sypText }
}

/** تنبيه ذمة/رصيد — يُعرض أعلى نافذة الحجز ليبقى ظاهراً عند التمرير */
function BookingFinancialStickyAlert({
  picked,
  usdSypRate,
}: {
  picked: Patient
  usdSypRate: number | null | undefined
}) {
  const { debt, credit } = patientDebtCreditUsd(picked)
  const hasDebt = debt > 0.0001
  const hasCredit = credit > 0.0001
  if (!hasDebt && !hasCredit) return null
  const debtFmt = fmtUsdSyp(debt, usdSypRate)
  const creditFmt = fmtUsdSyp(credit, usdSypRate)
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 3,
        marginBottom: '0.75rem',
        paddingBottom: '0.35rem',
        background: 'var(--bg-elevated, var(--bg))',
      }}
    >
      <div
        role="alert"
        style={{
          padding: '0.75rem 0.9rem',
          borderRadius: 'var(--radius)',
          border: '2px solid var(--warning, #d4a017)',
          background: 'rgba(212, 160, 23, 0.14)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: '0.45rem', fontSize: '0.92rem' }}>تنبيه مالي — المريض المختار</div>
        {hasDebt ? (
          <p style={{ margin: '0.2rem 0', fontSize: '0.88rem', lineHeight: 1.45 }}>
            <span style={{ color: 'var(--text-muted)' }}>ذمة على المريض: </span>
            <strong style={{ color: 'var(--danger)' }}>{debtFmt.usdText}</strong>
            {debtFmt.sypText ? (
              <>
                {' '}
                <span style={{ color: 'var(--text-muted)' }}>≈</span>{' '}
                <strong style={{ color: 'var(--danger)' }}>{debtFmt.sypText}</strong>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {' '}
                (تعادل الليرة غير متاح — حدّد سعر صرف اليوم)
              </span>
            )}
          </p>
        ) : null}
        {hasCredit ? (
          <p style={{ margin: '0.2rem 0', fontSize: '0.88rem', lineHeight: 1.45 }}>
            <span style={{ color: 'var(--text-muted)' }}>رصيد إضافي للمريض: </span>
            <strong style={{ color: 'var(--success)' }}>{creditFmt.usdText}</strong>
            {creditFmt.sypText ? (
              <>
                {' '}
                <span style={{ color: 'var(--text-muted)' }}>≈</span>{' '}
                <strong style={{ color: 'var(--success)' }}>{creditFmt.sypText}</strong>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {' '}
                (تعادل الليرة غير متاح — حدّد سعر صرف اليوم)
              </span>
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function ReceptionAppointmentPage() {
  const { user } = useAuth()
  const { dayActive, usdSypRate } = useClinic()
  const canUse = user?.role === 'super_admin' || user?.role === 'reception'
  const assignBlocked = user?.role === 'reception' && !dayActive

  const [businessDate, setBusinessDate] = useState(todayYmd)
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsErr, setSlotsErr] = useState('')

  const [selectedService, setSelectedService] = useState<ServiceValue>('laser')
  const [selectedChannel, setSelectedChannel] = useState<string>(SERVICE_CHANNELS.laser[0])
  const [appointmentTime, setAppointmentTime] = useState('09:00')
  const [bookingDurationMinutes, setBookingDurationMinutes] = useState(60)
  const [procedureType, setProcedureType] = useState('')

  const [patientQ, setPatientQ] = useState('')
  const [patientHits, setPatientHits] = useState<Patient[]>([])
  const [patientSearchLoading, setPatientSearchLoading] = useState(false)
  const [picked, setPicked] = useState<Patient | null>(null)
  const [declinedNewPatientForName, setDeclinedNewPatientForName] = useState<string | null>(null)
  const [creatingPatient, setCreatingPatient] = useState(false)

  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [bookingOpen, setBookingOpen] = useState(false)
  const [laserProcedureGroups, setLaserProcedureGroups] = useState<LaserProcedureGroup[]>([])
  const [laserProcedureLoading, setLaserProcedureLoading] = useState(false)
  const [laserProcedureErr, setLaserProcedureErr] = useState('')
  const [selectedLaserItemIds, setSelectedLaserItemIds] = useState<string[]>([])

  /** فترة الحجز الجاري في النافذة — تُحسب كمحجوزة معاينة لنفس القناة */
  const draftBookingInterval = useMemo(() => {
    if (!bookingOpen) return null
    const t = normalizeTime(appointmentTime)
    if (!t) return null
    const sm = hmToMinutes(t)
    if (sm == null) return null
    return { start: sm, end: sm + bookingDurationMinutes }
  }, [bookingOpen, appointmentTime, bookingDurationMinutes])

  const loadSlots = useCallback(async () => {
    if (!canUse) return
    setSlotsErr('')
    setSlotsLoading(true)
    try {
      const data = await api<{ slots: SlotRow[] }>(
        `/api/schedule?date=${encodeURIComponent(businessDate)}`,
      )
      setSlots(data.slots)
    } catch (e) {
      setSlots([])
      setSlotsErr(e instanceof ApiError ? e.message : 'تعذر تحميل المواعيد')
    } finally {
      setSlotsLoading(false)
    }
  }, [canUse, businessDate])

  const loadLaserProcedureOptions = useCallback(async () => {
    if (!canUse) return
    setLaserProcedureLoading(true)
    setLaserProcedureErr('')
    try {
      const data = await api<{ groups: LaserProcedureGroup[] }>('/api/laser/procedure-options')
      setLaserProcedureGroups(data.groups || [])
    } catch (e) {
      setLaserProcedureGroups([])
      setLaserProcedureErr(e instanceof ApiError ? e.message : 'تعذر تحميل مناطق الليزر')
    } finally {
      setLaserProcedureLoading(false)
    }
  }, [canUse])

  useEffect(() => {
    void loadSlots()
  }, [loadSlots])

  useEffect(() => {
    void loadLaserProcedureOptions()
  }, [loadLaserProcedureOptions])

  useEffect(() => {
    if (dayActive) {
      setFormErr((prev) => (prev.includes('يوم العمل') ? '' : prev))
    }
  }, [dayActive])

  useEffect(() => {
    const channels = SERVICE_CHANNELS[selectedService]
    if (channels.length > 0 && !channels.includes(selectedChannel)) {
      setSelectedChannel(channels[0])
    }
  }, [selectedService, selectedChannel])

  useEffect(() => {
    const q = patientQ.trim()
    if (!q || q.length < 2) {
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

  /** تحديث الذمة/الرصيد من ملف المريض عند الاختيار */
  useEffect(() => {
    const id = picked?.id
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ patient: Patient }>(`/api/patients/${encodeURIComponent(id)}`)
        if (cancelled || !data?.patient) return
        setPicked((prev) => {
          if (!prev || String(prev.id) !== String(id)) return prev
          if (String(data.patient.id) !== String(id)) return prev
          /** دمج كامل لضمان وصول حقول الملف بما فيها المالية */
          return { ...prev, ...data.patient }
        })
      } catch {
        /* الإبقاء على نتيجة البحث */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [picked?.id])

  const channelBookedSlots = useCallback(
    (channel: string) =>
      slots
        .filter((s) => s.providerName === channel)
        .sort((a, b) => a.time.localeCompare(b.time, undefined, { numeric: true })),
    [slots],
  )

  const availableStartTimesForChannel = useCallback(
    (channel: string) => {
      const apiIntervals = channelBookedSlots(channel)
        .map((s) => slotIntervalFromRow(s.time, s.endTime))
        .filter((x): x is { start: number; end: number } => x != null)
      const dur = bookingDurationMinutes

      const startFitsDayAndNoOverlap = (t: number): boolean => {
        if (t + dur > DAY_END_MIN) return false
        const candEnd = t + dur
        if (apiIntervals.some((iv) => intervalsOverlapHalfOpen(t, candEnd, iv.start, iv.end))) return false
        if (
          draftBookingInterval &&
          channel === selectedChannel &&
          !(t === draftBookingInterval.start && candEnd === draftBookingInterval.end) &&
          intervalsOverlapHalfOpen(t, candEnd, draftBookingInterval.start, draftBookingInterval.end)
        ) {
          return false
        }
        return true
      }

      const seen = new Set<string>()
      const addIfOk = (m: number) => {
        if (!startFitsDayAndNoOverlap(m)) return
        seen.add(toHm(m))
      }

      for (let m = DAY_START_MIN; m + dur <= DAY_END_MIN; m += HOURLY_DISPLAY_STEP_MIN) {
        addIfOk(m)
      }

      const forMerge = [...apiIntervals]
      if (draftBookingInterval && channel === selectedChannel) {
        forMerge.push({ start: draftBookingInterval.start, end: draftBookingInterval.end })
      }
      const mergedBusy = mergeHalfOpenIntervals(forMerge)
      for (const block of mergedBusy) {
        const e = block.end
        if (e <= DAY_START_MIN || e >= DAY_END_MIN) continue
        if (e % HOURLY_DISPLAY_STEP_MIN === 0) continue
        addIfOk(e)
      }

      return [...seen].sort((a, b) => (hmToMinutes(a) || 0) - (hmToMinutes(b) || 0))
    },
    [channelBookedSlots, bookingDurationMinutes, draftBookingInterval, selectedChannel],
  )

  const appointmentRowsForChannel = useCallback(
    (channel: string) => {
      const bookedSlots = channelBookedSlots(channel)
      let draftSlot: SlotRow | null = null
      if (bookingOpen && channel === selectedChannel && draftBookingInterval) {
        const startHm = normalizeTime(appointmentTime) || toHm(draftBookingInterval.start)
        draftSlot = {
          id: '__reception_draft__',
          businessDate,
          time: startHm,
          endTime: toHm(draftBookingInterval.end),
          providerName: channel,
          procedureType: 'حجز قيد الإكمال',
          status: 'busy',
          patientId: null,
          patientName: '—',
        }
      }
      const bookedWithDraft = draftSlot ? [...bookedSlots, draftSlot] : bookedSlots
      const availableStartTimes = availableStartTimesForChannel(channel)
      const bookedMap = new Map<string, SlotRow>()
      for (const s of bookedWithDraft) {
        const ti = normalizeTime(s.time)
        if (ti) bookedMap.set(ti, s)
      }
      const times = new Set<string>(availableStartTimes)
      for (const tm of bookedMap.keys()) times.add(tm)
      if (times.size === 0) {
        for (let m = DAY_START_MIN; m + bookingDurationMinutes <= DAY_END_MIN; m += HOURLY_DISPLAY_STEP_MIN) {
          times.add(toHm(m))
        }
      }
      return [...times]
        .sort((a, b) => (hmToMinutes(a) || 0) - (hmToMinutes(b) || 0))
        .map((time) => {
          const busy = bookedMap.get(time)
          if (busy) {
            const iv = slotIntervalFromRow(busy.time, busy.endTime)
            return {
              time,
              status: 'busy' as const,
              patientName: busy.patientName || '—',
              procedureType: busy.procedureType?.trim() || '—',
              range: iv ? `${toHm(iv.start)} — ${toHm(iv.end)}` : busy.time,
            }
          }
          return {
            time,
            status: 'free' as const,
            patientName: '',
            procedureType: '',
            range: '—',
          }
        })
    },
    [
      appointmentTime,
      availableStartTimesForChannel,
      bookingDurationMinutes,
      bookingOpen,
      businessDate,
      channelBookedSlots,
      draftBookingInterval,
      selectedChannel,
    ],
  )

  const selectedChannelRows = useMemo(
    () => appointmentRowsForChannel(selectedChannel),
    [appointmentRowsForChannel, selectedChannel],
  )

  const selectedChannelAvailableTimes = useMemo(
    () => availableStartTimesForChannel(selectedChannel),
    [availableStartTimesForChannel, selectedChannel],
  )

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

  const selectedLaserTotalSyp = useMemo(
    () => selectedLaserItems.reduce((sum, item) => sum + (Number(item.priceSyp) || 0), 0),
    [selectedLaserItems],
  )

  useEffect(() => {
    if (selectedChannelAvailableTimes.length === 0) return
    const norm = normalizeTime(appointmentTime)
    if (!norm || !selectedChannelAvailableTimes.includes(norm)) {
      setAppointmentTime(selectedChannelAvailableTimes[0])
    }
  }, [selectedChannelAvailableTimes, appointmentTime])

  useEffect(() => {
    setSelectedLaserItemIds((prev) => prev.filter((id) => laserItemById.has(id)))
  }, [laserItemById])

  async function createNewPatientAndSelect() {
    const name = patientQ.trim()
    if (name.length < 2) return
    setFormErr('')
    setCreatingPatient(true)
    try {
      const data = await api<{ patient: Patient }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({ name, fileNumber: tempFileNumber() }),
      })
      setPicked(data.patient)
      setPatientHits([])
      setDeclinedNewPatientForName(null)
      setSuccessMsg(
        `تم إنشاء ملف المريض «${data.patient.name}». أكمل أدناه حجز الموعد، ويمكنك لاحقاً إكمال بياناته من صفحة المرضى.`,
      )
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        setFormErr('يوم العمل غير مفعّل — لا يمكن إنشاء مريض جديد حتى يفعّل المدير اليوم.')
      } else {
        setFormErr(e instanceof ApiError ? e.message : 'تعذر إنشاء المريض')
      }
    } finally {
      setCreatingPatient(false)
    }
  }

  async function submit(): Promise<boolean> {
    setFormErr('')
    setSuccessMsg('')
    if (!picked) {
      setFormErr('اختر المريض من نتائج البحث')
      return false
    }
    if (assignBlocked) {
      setFormErr('يوم العمل غير مفعّل — لا يمكن حجز موعد من الاستقبال حتى يفعّل المدير اليوم.')
      return false
    }

    const time = normalizeTime(appointmentTime)
    if (!time) {
      setFormErr('اختر وقت بداية من الجدول')
      return false
    }
    const sm = hmToMinutes(time)
    const em = sm == null ? null : sm + bookingDurationMinutes
    const endTime = em == null ? null : toHm(em)
    if (sm == null || em == null || !endTime) {
      setFormErr('الوقت المختار غير صالح')
      return false
    }
    if (em > DAY_END_MIN) {
      setFormErr('الموعد يتجاوز نهاية الدوام (8:00 مساءً)')
      return false
    }
    if (sm == null || em == null || em <= sm) {
      setFormErr('وقت نهاية الموعد يجب أن يكون بعد وقت البداية')
      return false
    }
    const providerName = selectedChannel.trim()
    if (!providerName) {
      setFormErr('اختر الخدمة أو الغرفة أولاً')
      return false
    }
    const roomNumber = selectedService === 'laser' ? inferRoomNumber(providerName) : null
    if (selectedService === 'laser' && !roomNumber) {
      setFormErr('رقم غرفة الليزر غير صالح')
      return false
    }
    const proc =
      selectedService === 'laser'
        ? selectedLaserItems.map((item) => item.name).join(' + ').trim()
        : procedureType.trim()
    if (!proc) {
      setFormErr(selectedService === 'laser' ? 'اختر منطقة أو أكثر لليزر' : 'اختر نوع الإجراء من القائمة')
      return false
    }
    const overlap = slots.some((x) => {
      if (x.providerName !== providerName) return false
      const o = slotIntervalFromRow(x.time, x.endTime)
      if (!o) return false
      return intervalsOverlapHalfOpen(sm, em, o.start, o.end)
    })
    if (overlap) {
      setFormErr(
        'فترة الموعد (البداية–النهاية) تتداخل مع موعد آخر لنفس المقدّم — اختر أوقاتاً لا تغطي جزءاً من فترة محجوزة',
      )
      return false
    }

    setSaving(true)
    try {
      const data = await api<{ slot?: SlotRow }>('/api/schedule/assign', {
        method: 'POST',
        body: JSON.stringify({
          businessDate,
          time,
          endTime,
          providerName,
          serviceType: selectedService,
          roomNumber,
          procedureType: proc.slice(0, 200),
          patientId: picked.id,
        }),
      })
      const specialistPart = data?.slot?.assignedSpecialistName
        ? ` — الأخصائي: ${data.slot.assignedSpecialistName}`
        : ''
      const { debt: finDebt, credit: finCredit } = patientDebtCreditUsd(picked)
      let financialReminder = ''
      if (finDebt > 0.0001) {
        const f = fmtUsdSyp(finDebt, usdSypRate)
        financialReminder += ` — تنبيه: على المريض ذمة ${f.usdText}`
        if (f.sypText) financialReminder += ` (≈ ${f.sypText})`
      }
      if (finCredit > 0.0001) {
        const f = fmtUsdSyp(finCredit, usdSypRate)
        financialReminder += ` — رصيد إضافي للمريض ${f.usdText}`
        if (f.sypText) financialReminder += ` (≈ ${f.sypText})`
      }
      setSuccessMsg(
        `تم تسجيل الموعد: ${picked.name} — ${providerName} — ${proc} — ${time}–${endTime} (${bookingDurationMinutes} دقيقة) — ${businessDate}${specialistPart}${financialReminder}`,
      )
      setPicked(null)
      setPatientQ('')
      setPatientHits([])
      setSelectedLaserItemIds([])
      await loadSlots()
      return true
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 423) {
          setFormErr(e.message || 'يوم العمل غير مفعّل.')
        } else if (e.status === 409) {
          setFormErr(e.message || 'الخانة محجوزة لمريض آخر')
        } else {
          setFormErr(e.message)
        }
      } else {
        setFormErr('فشل الحجز')
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!canUse) {
    return (
      <>
        <h1 className="page-title">إضافة موعد</h1>
        <p className="page-desc">هذه الصفحة مخصصة لاستقبال المدير.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">إضافة موعد</h1>
      <p className="page-desc">
        حجز موعد للزبون مع الطبيب أو الأخصائي — يظهر في{' '}
        <Link to="/appointments" style={{ color: 'var(--cyan)' }}>
          المواعيد المحجوزة
        </Link>{' '}
        ليوم الموعد. الأوقات الفارغة على شبكة ساعية (09:00، 10:00، …)، ويُضاف وقت بداية إضافي فقط بعد نهاية حجز
        لا تقع على الساعة (مثل 11:30 بعد موعد 90 دقيقة من 10:00)؛ بقية الساعات تبقى كما هي.
      </p>

      {assignBlocked ? (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }}>
          <p style={{ margin: 0, color: 'var(--amber)' }}>
            يوم العمل غير مفعّل. اطلب من المدير تفعيل اليوم وسعر الصرف قبل حجز المواعيد من الاستقبال.
          </p>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label className="form-label" htmlFor="appt-date">
          تاريخ الموعد
        </label>
        <input
          id="appt-date"
          type="date"
          className="input"
          style={{ width: 'auto', maxWidth: 220 }}
          value={businessDate}
          onChange={(e) => setBusinessDate(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginRight: '0.75rem' }}
          disabled={slotsLoading}
          onClick={() => void loadSlots()}
        >
          تحديث القائمة
        </button>
        {slotsErr ? (
          <p style={{ color: 'var(--danger)', marginTop: '0.5rem', marginBottom: 0 }}>{slotsErr}</p>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title" style={{ marginTop: 0 }}>
          جدول الأوقات
        </h2>
        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label className="form-label" htmlFor="appt-prov">
              الخدمة
            </label>
            <select
              id="appt-prov"
              className="select"
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value as ServiceValue)}
            >
              {SERVICE_OPTIONS.map((svc) => (
                <option key={svc.value} value={svc.value}>
                  {svc.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {slotsLoading ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل الجدول…</p>
        ) : selectedService === 'laser' ? (
          <div
            style={{
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
              alignItems: 'start',
            }}
          >
            {SERVICE_CHANNELS.laser.map((channel) => {
              const rows = appointmentRowsForChannel(channel)
              return (
                <div key={channel}>
                  <h3 style={{ margin: '0 0 0.5rem' }}>جدول {LASER_ROOM_TITLES[channel] || channel}</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>الوقت</th>
                          <th>الحالة</th>
                          <th>اسم المريض</th>
                          <th>الفترة</th>
                          <th>إجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={`${channel}-${r.time}-${r.status}`}>
                            <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.time}</td>
                            <td>
                              {r.status === 'busy' ? (
                                <span className="chip" style={{ background: 'var(--warning-dim)', color: 'var(--amber)' }}>
                                  محجوز
                                </span>
                              ) : (
                                <span className="chip" style={{ background: 'var(--success-dim)', color: 'var(--success)' }}>
                                  متاح
                                </span>
                              )}
                            </td>
                            <td>{r.status === 'busy' ? r.patientName : '—'}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.range}</td>
                            <td>
                              {r.status === 'free' ? (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ fontSize: '0.8rem' }}
                                  onClick={() => {
                                    setSelectedChannel(channel)
                                    setAppointmentTime(r.time)
                                    setPicked(null)
                                    setPatientQ('')
                                    setPatientHits([])
                                    setProcedureType('')
                                    setSelectedLaserItemIds([])
                                    setBookingDurationMinutes(60)
                                    setFormErr('')
                                    setSuccessMsg('')
                                    setDeclinedNewPatientForName(null)
                                    setBookingOpen(true)
                                  }}
                                >
                                  اختيار
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
                </div>
              )
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>الحالة</th>
                  <th>اسم المريض</th>
                  <th>الفترة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {selectedChannelRows.map((r) => (
                  <tr key={`${selectedChannel}-${r.time}-${r.status}`}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.time}</td>
                    <td>
                      {r.status === 'busy' ? (
                        <span className="chip" style={{ background: 'var(--warning-dim)', color: 'var(--amber)' }}>
                          محجوز
                        </span>
                      ) : (
                        <span className="chip" style={{ background: 'var(--success-dim)', color: 'var(--success)' }}>
                          متاح
                        </span>
                      )}
                    </td>
                    <td>{r.status === 'busy' ? r.patientName : '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.range}</td>
                    <td>
                      {r.status === 'free' ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: '0.8rem' }}
                          onClick={() => {
                            setSelectedChannel(SERVICE_CHANNELS[selectedService][0])
                            setAppointmentTime(r.time)
                            setPicked(null)
                            setPatientQ('')
                            setPatientHits([])
                            setProcedureType('')
                            setSelectedLaserItemIds([])
                            setBookingDurationMinutes(60)
                            setFormErr('')
                            setSuccessMsg('')
                            setDeclinedNewPatientForName(null)
                            setBookingOpen(true)
                          }}
                        >
                          اختيار
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
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
          بداية الدوام 09:00 ونهايته 20:00. عرض الأوقات الفارغة بفاصل ساعة؛ أول وقت بداية بعد حجز قد يظهر على
          الدقائق إذا انتهى الحجز بين ساعتين.
        </p>
      </div>

      {formErr ? (
        <p style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{formErr}</p>
      ) : null}
      {successMsg ? (
        <p style={{ color: 'var(--success)', marginBottom: '0.75rem' }}>{successMsg}</p>
      ) : null}

      {bookingOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setBookingOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 620, maxHeight: 'min(92vh, 900px)', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>
              حجز موعد — {SERVICE_OPTIONS.find((x) => x.value === selectedService)?.label || selectedService}
              {selectedService === 'laser' ? ` (${LASER_ROOM_TITLES[selectedChannel] || selectedChannel})` : ''}
            </h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '-0.25rem', fontSize: '0.88rem' }}>
              الموعد المختار: <strong>{appointmentTime}</strong> — المدة: <strong>{bookingDurationMinutes} دقيقة</strong> — التاريخ:{' '}
              <strong>{businessDate}</strong>
            </p>
            {picked ? <BookingFinancialStickyAlert picked={picked} usdSypRate={usdSypRate} /> : null}
            <div className="card" style={{ marginBottom: '0.85rem' }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.55rem' }}>مدة الموعد</h4>
              <select
                className="select"
                style={{ width: '100%', maxWidth: 220 }}
                value={String(bookingDurationMinutes)}
                onChange={(e) => setBookingDurationMinutes(Math.max(5, Number(e.target.value) || 60))}
              >
                <option value="5">5 دقائق</option>
                <option value="15">15 دقيقة</option>
                <option value="30">30 دقيقة</option>
                <option value="45">45 دقيقة</option>
                <option value="60">60 دقيقة</option>
                <option value="90">90 دقيقة</option>
                <option value="120">120 دقيقة</option>
              </select>
            </div>
            <div className="card" style={{ marginBottom: '0.85rem' }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.55rem' }}>اختيار المريض</h4>
              <input
                className="input"
                placeholder="ابحث بالاسم…"
                value={patientQ}
                onChange={(e) => {
                  setPatientQ(e.target.value)
                  if (picked) setPicked(null)
                }}
              />
              {picked ? (
                <p style={{ marginTop: '0.65rem', marginBottom: 0 }}>
                  المختار: <strong>{picked.name}</strong>{' '}
                  <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setPicked(null)}>
                    إلغاء الاختيار
                  </button>
                </p>
              ) : patientSearchLoading && patientQ.trim().length >= 2 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem', marginBottom: 0 }}>
                  جاري البحث…
                </p>
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
                        }}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : patientQ.trim().length >= 2 &&
                !patientSearchLoading &&
                patientQ.trim() !== declinedNewPatientForName ? (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.85rem 1rem',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--bg)',
                  }}
                  role="status"
                >
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
                    لا يوجد مريض بهذا الاسم. هل تريد إنشاء ملف جديد والمتابعة؟
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={creatingPatient || assignBlocked}
                      onClick={() => void createNewPatientAndSelect()}
                    >
                      {creatingPatient ? 'جاري الإنشاء…' : 'نعم'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={creatingPatient}
                      onClick={() => setDeclinedNewPatientForName(patientQ.trim())}
                    >
                      لا
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="card">
              <h4 style={{ marginTop: 0, marginBottom: '0.55rem' }}>
                {selectedService === 'laser' ? 'منطقة / عرض الليزر' : 'نوع الإجراء'}
              </h4>
              {selectedService === 'laser' ? (
                <>
                  {laserProcedureErr ? (
                    <p style={{ marginTop: 0, color: 'var(--danger)' }}>{laserProcedureErr}</p>
                  ) : null}
                  {laserProcedureLoading ? (
                    <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>جاري تحميل المناطق…</p>
                  ) : (
                    <>
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
                                    style={{
                                      fontSize: '0.82rem',
                                      padding: '0.38rem 0.58rem',
                                      borderRadius: 999,
                                      borderColor: selected ? 'var(--cyan)' : 'var(--border)',
                                    }}
                                    onClick={() =>
                                      setSelectedLaserItemIds((prev) =>
                                        prev.includes(item.id)
                                          ? prev.filter((x) => x !== item.id)
                                          : [...prev, item.id],
                                      )
                                    }
                                  >
                                    {item.name} — {item.priceSyp.toLocaleString('en-US')} ل.س
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p style={{ margin: '0.65rem 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                        تم اختيار <strong>{selectedLaserItems.length}</strong> منطقة/عرض
                        {selectedLaserItems.length > 0
                          ? ` — المجموع التقريبي: ${selectedLaserTotalSyp.toLocaleString('en-US')} ل.س`
                          : ''}
                      </p>
                    </>
                  )}
                </>
              ) : (
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={procedureType}
                  onChange={(e) => setProcedureType(e.target.value)}
                >
                  <option value="">— اختر نوع الإجراء —</option>
                  {APPOINTMENT_PROCEDURE_OPTIONS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {formErr ? (
              <p style={{ color: 'var(--danger)', margin: '0.75rem 0 0' }}>{formErr}</p>
            ) : null}
            {successMsg ? (
              <p style={{ color: 'var(--success)', margin: '0.75rem 0 0' }}>{successMsg}</p>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setBookingOpen(false)}>
                إغلاق
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || assignBlocked}
                onClick={async () => {
                  const ok = await submit()
                  if (ok) setBookingOpen(false)
                }}
              >
                {saving ? 'جاري الحفظ…' : 'تأكيد حجز الموعد'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
