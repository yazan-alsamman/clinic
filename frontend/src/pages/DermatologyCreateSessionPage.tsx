import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type SlotRow = {
  id: string
  businessDate: string
  time: string
  endTime?: string
  patientId?: string | null
  patientName: string
  procedureType?: string
  serviceType?: string
  arrivedAt?: string | null
  assignedSpecialistName?: string
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DermatologyCreateSessionPage() {
  const { user } = useAuth()
  const { businessDate: clinicBusinessDate } = useClinic()
  const navigate = useNavigate()
  const canUse =
    user?.role === 'dermatology' ||
    user?.role === 'dermatology_manager' ||
    user?.role === 'dermatology_assistant_manager'
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
      const q =
        user?.role === 'dermatology_assistant_manager'
          ? '/api/schedule/booked?headOnly=1'
          : '/api/schedule/booked'
      const data = await api<{ slots: SlotRow[] }>(q)
      setSlots(data.slots || [])
    } catch (e) {
      setSlots([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل المرضى الواصلين')
    } finally {
      setLoading(false)
    }
  }, [canUse, user?.role])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () =>
      slots
        .filter((s) => String(s.serviceType || '').toLowerCase() === 'dermatology')
        .filter((s) => Boolean(s.arrivedAt))
        .filter((s) => Boolean(s.patientId))
        .sort((a, b) => (a.arrivedAt || '').localeCompare(b.arrivedAt || '')),
    [slots],
  )

  if (!canUse) {
    return (
      <>
        <h1 className="page-title">إنشاء جلسة</h1>
        <p className="page-desc">هذه الصفحة متاحة فقط لفريق الجلدية.</p>
      </>
    )
  }

  if (user?.role === 'super_admin') {
    return <Navigate to="/" replace />
  }

  return (
    <>
      <h1 className="page-title">إنشاء جلسة</h1>
      <p className="page-desc">
        {user?.role === 'dermatology_assistant_manager'
          ? 'تظهر هنا فقط مواعيد الجلدية الواصلة والمحجوزة على رئيس قسم الجلدية.'
          : 'تظهر هنا فقط مواعيد الجلدية التي تم تسجيل وصول المريض لها ومربوطة باسمك.'}{' '}
        اضغط على أي مريض لفتح ملفه على تبويب الجلدية مباشرة.
      </p>
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
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {user?.role === 'dermatology_assistant_manager'
              ? 'لا يوجد مرضى واصلين ومحجوزين على رئيس القسم حالياً.'
              : 'لا يوجد مرضى واصلين لهذا الطبيب حالياً.'}
          </p>
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
                        `/patients/${s.patientId}?tab=dermatology&dermProc=${encodeURIComponent(
                          String(s.procedureType || '').trim(),
                        )}&dermSlotId=${encodeURIComponent(String(s.id))}`,
                      )
                    }
                    style={{ cursor: 'pointer' }}
                    title="فتح ملف المريض وتبويب الجلدية"
                  >
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {s.time}
                      {s.endTime ? ` — ${s.endTime}` : ''}
                    </td>
                    <td>{s.patientName || '—'}</td>
                    <td>{s.procedureType?.trim() || '—'}</td>
                    <td>
                      {s.arrivedAt
                        ? new Date(s.arrivedAt).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
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
