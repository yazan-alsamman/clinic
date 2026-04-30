import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type SlotRow = {
  id: string
  time: string
  endTime?: string
  patientId?: string | null
  patientName: string
  procedureType?: string
  serviceType?: string
  arrivedAt?: string | null
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function SkinCreateSessionPage() {
  const { user } = useAuth()
  const { businessDate: clinicBusinessDate } = useClinic()
  const navigate = useNavigate()
  const canUse = user?.role === 'skin_specialist'
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [slots, setSlots] = useState<SlotRow[]>([])

  const load = useCallback(async () => {
    if (!canUse) {
      setLoading(false)
      return
    }
    setErr('')
    setLoading(true)
    try {
      const data = await api<{ slots: SlotRow[] }>('/api/schedule/booked')
      setSlots(data.slots || [])
    } catch (e) {
      setSlots([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل المرضى الواصلين')
    } finally {
      setLoading(false)
    }
  }, [canUse])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () =>
      slots
        .filter((s) => String(s.serviceType || '').toLowerCase() === 'skin')
        .filter((s) => Boolean(s.arrivedAt))
        .filter((s) => Boolean(s.patientId))
        .sort((a, b) => (a.arrivedAt || '').localeCompare(b.arrivedAt || '')),
    [slots],
  )

  if (user?.role === 'super_admin') return <Navigate to="/" replace />

  if (!canUse) {
    return (
      <>
        <h1 className="page-title">إنشاء جلسة</h1>
        <p className="page-desc">هذه الصفحة متاحة فقط لأخصائية البشرة.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">إنشاء جلسة</h1>
      <p className="page-desc">تظهر هنا فقط حالات قسم البشرة التي تم تسجيل وصول المريض لها.</p>
      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          تحديث
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          اليوم: <strong dir="ltr">{clinicBusinessDate || todayYmd()}</strong>
        </span>
      </div>

      <div className="card">
        {err ? (
          <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
        ) : loading ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا يوجد مرضى واصلين حالياً.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>من — إلى</th>
                  <th>اسم المريض</th>
                  <th>نوع الإجراء</th>
                  <th>وقت الوصول</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() =>
                      navigate(
                        `/patients/${s.patientId}?tab=solarium&dermProc=${encodeURIComponent(
                          String(s.procedureType || '').trim(),
                        )}`,
                      )
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {s.time}
                      {s.endTime ? ` — ${s.endTime}` : ''}
                    </td>
                    <td>{s.patientName || '—'}</td>
                    <td>{s.procedureType?.trim() || '—'}</td>
                    <td>
                      {s.arrivedAt
                        ? new Date(s.arrivedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
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
