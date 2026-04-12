import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import type { Patient } from '../types'
import {
  normalizeTime,
  hmToMinutes,
  defaultEndFromStart,
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

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
  const [providersLoading, setProvidersLoading] = useState(false)
  const [peekProvider, setPeekProvider] = useState('')

  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDERS[0])
  const [appointmentTime, setAppointmentTime] = useState('09:00')
  const [appointmentEndTime, setAppointmentEndTime] = useState(() => defaultEndFromStart('09:00'))
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

  const loadProviders = useCallback(async () => {
    if (!canUse) return
    setProvidersLoading(true)
    try {
      const data = await api<{ providers: string[] }>('/api/schedule/providers')
      setProviderDirectory(data.providers)
    } catch {
      setProviderDirectory([])
    } finally {
      setProvidersLoading(false)
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

  const slotsForPeek = useMemo(() => {
    if (!peekProvider) return []
    return slots
      .filter((s) => s.providerName === peekProvider)
      .sort((a, b) => a.time.localeCompare(b.time, undefined, { numeric: true }))
  }, [slots, peekProvider])

  async function createNewPatientAndSelect() {
    const name = patientQ.trim()
    if (name.length < 2) return
    setFormErr('')
    setCreatingPatient(true)
    try {
      const data = await api<{ patient: Patient }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({ name }),
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

  async function submit() {
    setFormErr('')
    setSuccessMsg('')
    if (!picked) {
      setFormErr('اختر المريض من نتائج البحث')
      return
    }
    if (assignBlocked) {
      setFormErr('يوم العمل غير مفعّل — لا يمكن حجز موعد من الاستقبال حتى يفعّل المدير اليوم.')
      return
    }

    const rawStart = appointmentTime.includes(':') ? appointmentTime : `${appointmentTime}:00`
    const rawEnd = appointmentEndTime.includes(':') ? appointmentEndTime : `${appointmentEndTime}:00`
    const time = normalizeTime(rawStart)
    const endTime = normalizeTime(rawEnd)
    if (!time || !endTime) {
      setFormErr('أدخل وقت البداية والنهاية بصيغة HH:MM (مثال 10:30)')
      return
    }
    const sm = hmToMinutes(time)
    const em = hmToMinutes(endTime)
    if (sm == null || em == null || em <= sm) {
      setFormErr('وقت نهاية الموعد يجب أن يكون بعد وقت البداية')
      return
    }
    const providerName = selectedProvider.trim()
    if (!providerName) {
      setFormErr('اختر المقدّم من القائمة')
      return
    }
    const proc = procedureType.trim()
    if (!proc) {
      setFormErr('اختر نوع الإجراء من القائمة')
      return
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
      return
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
        `تم تسجيل الموعد: ${picked.name} — ${providerName} — ${proc} — ${time}–${endTime} — ${businessDate}`,
      )
      setPicked(null)
      setPatientQ('')
      setPatientHits([])
      await loadSlots()
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
        ليوم الموعد. يمكن تسجيل أكثر من موعد لنفس المقدّم في اليوم؛ يُشترط ألا تتداخل فترة الموعد الجديد (من البداية إلى
        النهاية) مع فترة أي موعد آخر مسجّل لذلك المقدّم في نفس التاريخ.
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
          جدول مواعيد الطبيب / الأخصائي
        </h2>
        <p className="page-desc" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
          قائمة بجميع الأطباء والأخصائيين — اختر اسماً لعرض كل المواعيد المسجّلة له في التاريخ أعلاه (محجوزة أو فارغة).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <label className="form-label" htmlFor="peek-provider" style={{ margin: 0 }}>
            الاسم
          </label>
          <select
            id="peek-provider"
            className="select"
            style={{ minWidth: 220, maxWidth: '100%' }}
            value={peekProvider}
            onChange={(e) => setPeekProvider(e.target.value)}
            disabled={providersLoading && providerDirectory.length === 0}
          >
            <option value="">— اختر طبيباً أو أخصائياً —</option>
            {(providerDirectory.length > 0 ? providerDirectory : providerOptions).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" disabled={providersLoading} onClick={() => void loadProviders()}>
            تحديث الأسماء
          </button>
        </div>
        {providersLoading && providerDirectory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>جاري تحميل الأسماء…</p>
        ) : null}
        {peekProvider ? (
          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            {slotsLoading ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل المواعيد…</p>
            ) : slotsForPeek.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                لا مواعيد محجوزة لهذا الاسم في {businessDate}. يمكنك حجز أي وقت بالأسفل طالما لا يتعارض مع موعد آخر
                لنفس المقدّم.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>المقدّم</th>
                    <th>نوع الإجراء</th>
                    <th>من — إلى</th>
                    <th>الحالة</th>
                    <th>المريض</th>
                  </tr>
                </thead>
                <tbody>
                  {slotsForPeek.map((s) => (
                    <tr key={s.id}>
                      <td>{s.providerName}</td>
                      <td>{s.procedureType?.trim() ? s.procedureType : '—'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {s.time}
                        {s.endTime ? ` — ${s.endTime}` : ''}
                      </td>
                      <td>
                        {s.status === 'busy' ? (
                          <span
                            className="chip"
                            style={{ background: 'var(--warning-dim)', color: 'var(--amber)' }}
                          >
                            محجوز
                          </span>
                        ) : (
                          <span
                            className="chip"
                            style={{ background: 'var(--success-dim)', color: 'var(--success)' }}
                          >
                            متاح
                          </span>
                        )}
                      </td>
                      <td>{s.status === 'busy' && s.patientName ? s.patientName : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title" style={{ marginTop: 0 }}>
          المريض
        </h2>
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
              لا يوجد مريض بهذا الاسم في السجلات. هل ترغب بإنشاء مريض جديد بالاسم المكتوب أعلاه ومتابعة الحجز؟
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingPatient || assignBlocked}
                onClick={() => void createNewPatientAndSelect()}
              >
                {creatingPatient ? 'جاري الإنشاء…' : 'نعم، إنشاء ومتابعة'}
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
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 0 }}>
              يُنشأ الملف بالاسم فقط؛ يمكن إكمال تاريخ الميلاد والهاتف وباقي البيانات لاحقاً من صفحة المرضى.
            </p>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title" style={{ marginTop: 0 }}>
          الوقت والمقدّم
        </h2>
        <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 360 }}>
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
            <label className="form-label" htmlFor="appt-proc">
              نوع الإجراء
            </label>
            <select
              id="appt-proc"
              className="select"
              style={{ width: '100%', maxWidth: 360 }}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
            <div>
              <label className="form-label" htmlFor="appt-time">
                وقت البداية
              </label>
              <input
                id="appt-time"
                type="time"
                className="input"
                value={appointmentTime}
                onChange={(e) => {
                  const v = e.target.value
                  setAppointmentTime(v)
                  const n = normalizeTime(v)
                  if (n) setAppointmentEndTime(defaultEndFromStart(n))
                }}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="appt-end">
                وقت النهاية
              </label>
              <input
                id="appt-end"
                type="time"
                className="input"
                value={appointmentEndTime}
                onChange={(e) => setAppointmentEndTime(e.target.value)}
              />
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            مسموح عدة مواعيد لنفس المقدّم في اليوم؛ يُرفض الحجز فقط إذا كانت فترتك (من البداية إلى النهاية) تتقاطع
            زمنياً مع موعد آخر لذلك المقدّم. عند تغيير البداية يُقترح نهاية بعد 30 دقيقة (يمكنك تعديلها).
          </p>
        </div>
      </div>

      {formErr ? (
        <p style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{formErr}</p>
      ) : null}
      {successMsg ? (
        <p style={{ color: 'var(--success)', marginBottom: '0.75rem' }}>{successMsg}</p>
      ) : null}

      <button type="button" className="btn btn-primary" disabled={saving || assignBlocked} onClick={() => void submit()}>
        {saving ? 'جاري الحفظ…' : 'تأكيد حجز الموعد'}
      </button>
    </>
  )
}
