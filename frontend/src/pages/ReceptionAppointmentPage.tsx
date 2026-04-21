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

const DEFAULT_PROVIDERS = ['د. لورا', 'د. سامي', 'أخصائية ليزر']

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
}

const DAY_START_MIN = 9 * 60
const DAY_END_MIN = 20 * 60
const DEFAULT_SLOT_STEP_MIN = 60

function toHm(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

export function ReceptionAppointmentPage() {
  const { user } = useAuth()
  const { dayActive } = useClinic()
  const canUse = user?.role === 'super_admin' || user?.role === 'reception'
  const assignBlocked = user?.role === 'reception' && !dayActive

  const [businessDate, setBusinessDate] = useState(todayYmd)
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsErr, setSlotsErr] = useState('')

  const [providerDirectory, setProviderDirectory] = useState<string[]>([])

  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDERS[0])
  const [appointmentTime, setAppointmentTime] = useState('09:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
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

  const loadProviders = useCallback(async () => {
    if (!canUse) return
    try {
      const data = await api<{ providers: string[] }>('/api/schedule/providers')
      setProviderDirectory(data.providers)
    } catch {
      setProviderDirectory([])
    }
  }, [canUse])

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

  useEffect(() => {
    void loadSlots()
  }, [loadSlots])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  useEffect(() => {
    if (dayActive) {
      setFormErr((prev) => (prev.includes('يوم العمل') ? '' : prev))
    }
  }, [dayActive])

  const providerOptions = useMemo(() => {
    const u = new Set(providerDirectory.length > 0 ? providerDirectory : DEFAULT_PROVIDERS)
    for (const s of slots) u.add(s.providerName)
    return [...u].sort((a, b) => a.localeCompare(b, 'ar'))
  }, [slots, providerDirectory])

  useEffect(() => {
    if (providerOptions.length > 0 && !providerOptions.includes(selectedProvider)) {
      setSelectedProvider(providerOptions[0])
    }
  }, [providerOptions, selectedProvider])

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

  const providerBookedSlots = useMemo(
    () =>
      slots
        .filter((s) => s.providerName === selectedProvider)
        .sort((a, b) => a.time.localeCompare(b.time, undefined, { numeric: true })),
    [slots, selectedProvider],
  )

  const availableStartTimes = useMemo(() => {
    const intervals = providerBookedSlots
      .map((s) => slotIntervalFromRow(s.time, s.endTime))
      .filter((x): x is { start: number; end: number } => x != null)
      .sort((a, b) => a.start - b.start)
    const out: string[] = []
    let t = DAY_START_MIN
    while (t + durationMinutes <= DAY_END_MIN) {
      const candidateEnd = t + durationMinutes
      const overlap = intervals.find((iv) => intervalsOverlapHalfOpen(t, candidateEnd, iv.start, iv.end))
      if (overlap) {
        t = overlap.end
        continue
      }
      out.push(toHm(t))
      t += DEFAULT_SLOT_STEP_MIN
    }
    return out
  }, [providerBookedSlots, durationMinutes])

  const appointmentRows = useMemo(() => {
    const bookedMap = new Map<string, SlotRow>()
    for (const s of providerBookedSlots) {
      const t = normalizeTime(s.time)
      if (t) bookedMap.set(t, s)
    }
    const times = new Set<string>(availableStartTimes)
    for (const t of bookedMap.keys()) times.add(t)
    if (times.size === 0) {
      for (let m = DAY_START_MIN; m <= DAY_END_MIN - DEFAULT_SLOT_STEP_MIN; m += DEFAULT_SLOT_STEP_MIN) {
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
        const sm = hmToMinutes(time) || 0
        const em = sm + durationMinutes
        return {
          time,
          status: 'free' as const,
          patientName: '',
          procedureType: '',
          range: `${time} — ${toHm(em)}`,
        }
      })
  }, [providerBookedSlots, availableStartTimes, durationMinutes])

  useEffect(() => {
    if (availableStartTimes.length === 0) return
    if (!availableStartTimes.includes(appointmentTime)) {
      setAppointmentTime(availableStartTimes[0])
    }
  }, [availableStartTimes, appointmentTime])

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
    const em = sm == null ? null : sm + durationMinutes
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
    const providerName = selectedProvider.trim()
    if (!providerName) {
      setFormErr('اختر المقدّم من القائمة')
      return false
    }
    if (!availableStartTimes.includes(time)) {
      setFormErr('الوقت المختار لم يعد متاحاً بعد تحديث الجدول')
      return false
    }
    const proc = procedureType.trim()
    if (!proc) {
      setFormErr('اختر نوع الإجراء من القائمة')
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
      await api('/api/schedule/assign', {
        method: 'POST',
        body: JSON.stringify({
          businessDate,
          time,
          endTime,
          providerName,
          procedureType: proc.slice(0, 200),
          patientId: picked.id,
        }),
      })
      setSuccessMsg(
        `تم تسجيل الموعد: ${picked.name} — ${providerName} — ${proc} — ${time}–${endTime} (${durationMinutes} دقيقة) — ${businessDate}`,
      )
      setPicked(null)
      setPatientQ('')
      setPatientHits([])
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
        ليوم الموعد. الأوقات المتاحة تُعرض كجدول من 09:00 صباحاً حتى 20:00 مساءً، وعند تحديد مدة الموعد تنزاح
        الأوقات الفارغة تلقائياً حسب الحجوزات الحالية.
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
          جدول الأوقات ({selectedProvider || '—'})
        </h2>
        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label className="form-label" htmlFor="appt-prov">
              المقدّم (طبيب / أخصائي)
            </label>
            <select
              id="appt-prov"
              className="select"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
            >
              {providerOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="appt-duration">
              مدة الموعد الجديد
            </label>
            <select
              id="appt-duration"
              className="select"
              style={{ width: '100%', maxWidth: 220 }}
              value={String(durationMinutes)}
              onChange={(e) => setDurationMinutes(Math.max(15, Number(e.target.value) || 60))}
            >
              <option value="30">30 دقيقة</option>
              <option value="45">45 دقيقة</option>
              <option value="60">60 دقيقة</option>
              <option value="90">90 دقيقة</option>
              <option value="120">120 دقيقة</option>
            </select>
          </div>
        </div>
        {slotsLoading ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل الجدول…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>الحالة</th>
                  <th>اسم المريض</th>
                  <th>نوع الإجراء</th>
                  <th>الفترة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {appointmentRows.map((r) => (
                  <tr key={`${selectedProvider}-${r.time}-${r.status}`}>
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
                    <td>{r.status === 'busy' ? r.procedureType : '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.range}</td>
                    <td>
                      {r.status === 'free' ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: '0.8rem' }}
                          onClick={() => {
                            setAppointmentTime(r.time)
                            setPicked(null)
                            setPatientQ('')
                            setPatientHits([])
                            setProcedureType('')
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
          بداية الدوام 09:00 ونهايته 20:00. المدد المحجوزة تؤثر مباشرة على الأوقات المتاحة التالية.
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
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>حجز موعد عند {selectedProvider}</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '-0.25rem', fontSize: '0.88rem' }}>
              الموعد المختار: <strong>{appointmentTime}</strong> — المدة: <strong>{durationMinutes} دقيقة</strong> — التاريخ:{' '}
              <strong>{businessDate}</strong>
            </p>
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
              <h4 style={{ marginTop: 0, marginBottom: '0.55rem' }}>نوع الإجراء</h4>
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
