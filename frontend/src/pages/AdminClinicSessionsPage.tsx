import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type DaySessionRow = {
  id: string
  sessionType: string
  patientName: string
  providerName: string
  timeLabel: string
  durationLabel: string
  notes: string
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function AdminClinicSessionsPage() {
  const { user } = useAuth()
  const { businessDate: clinicBusinessDate } = useClinic()
  const allowed = user?.role === 'super_admin'

  const [viewDate, setViewDate] = useState(() => todayYmd())
  const [sessions, setSessions] = useState<DaySessionRow[]>([])
  const [resolvedDate, setResolvedDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const seededClinicDate = useRef(false)

  useEffect(() => {
    if (clinicBusinessDate && !seededClinicDate.current) {
      seededClinicDate.current = true
      setViewDate(clinicBusinessDate)
    }
  }, [clinicBusinessDate])

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const data = await api<{ businessDate?: string; sessions?: DaySessionRow[] }>(
        `/api/clinical/sessions/day-overview?date=${encodeURIComponent(viewDate)}`,
      )
      setResolvedDate(String(data.businessDate || viewDate))
      setSessions(Array.isArray(data.sessions) ? data.sessions : [])
    } catch (e) {
      setSessions([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الجلسات')
    } finally {
      setLoading(false)
    }
  }, [allowed, viewDate])

  useEffect(() => {
    void load()
  }, [load])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">جلسات العيادة</h1>
        <p className="page-desc">هذه الصفحة مخصصة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">جلسات العيادة</h1>
      <p className="page-desc">
        عرض جميع الجلسات المسجّلة في النظام ليوم عمل واحد (ليزر، أسنان، جلدية، بشرة، سولاريوم) — حسب تاريخ العمل
        المخزّن مع كل جلسة. مدة الجلسة تُقدَّر من وقت التسجيل والتحديث على السجل (ولجلسات الليزر من سجل جلسة الليزر
        عند الربط).
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label className="form-label" htmlFor="clinic-sessions-date">
          تاريخ يوم العمل
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}>
          <input
            id="clinic-sessions-date"
            type="date"
            className="input"
            style={{ width: 'auto', maxWidth: 220 }}
            value={viewDate}
            onChange={(e) => setViewDate(e.target.value)}
          />
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
            تحديث
          </button>
          {resolvedDate ? (
            <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }} dir="ltr">
              المعروض: {resolvedDate}
            </span>
          ) : null}
        </div>
        {err ? (
          <p style={{ color: 'var(--danger)', marginTop: '0.55rem', marginBottom: 0 }}>{err}</p>
        ) : null}
      </div>

      <div className="card">
        {loading ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>جاري التحميل…</p>
        ) : sessions.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>لا توجد جلسات مسجّلة لهذا اليوم.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>نوع الجلسة</th>
                  <th>اسم المريض</th>
                  <th>المقدّم</th>
                  <th>الساعة</th>
                  <th>مدة الجلسة</th>
                  <th>الملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sessionType}</td>
                    <td>{s.patientName}</td>
                    <td>{s.providerName}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.timeLabel}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.durationLabel}</td>
                    <td style={{ maxWidth: 360, fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
