import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { Patient } from '../types'

type Strategic = {
  patient: Patient
  reason: 'draft_plan' | 'no_plan' | 'first_dental'
  hint: string
}

type ApprovedRow = {
  patient: Patient
  planId: string
  approvedAt: string | null
  summary: string
}

type DashboardPayload = {
  businessDate: string
  strategic: Strategic | null
  approvedQueue: ApprovedRow[]
}

const gradientBtn: CSSProperties = {
  background: 'linear-gradient(90deg, #22d3ee, #a855f7)',
  border: 'none',
  color: '#0f172a',
  fontWeight: 600,
}

export function DentalPage() {
  const { user } = useAuth()
  const canView = user?.role === 'super_admin' || user?.role === 'dental_branch'

  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }
    setErr('')
    try {
      setLoading(true)
      const res = await api<DashboardPayload>('/api/dental/dashboard')
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }, [canView])

  useEffect(() => {
    void load()
  }, [load])

  if (!canView) {
    return (
      <>
        <h1 className="page-title">الأسنان</h1>
        <p className="page-desc">هذه الصفحة مخصصة لأطباء الفروع والمدير.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">الأسنان</h1>
      <p className="page-desc">خطة العلاج المركزية وتنفيذ الفروع</p>

      {data?.businessDate ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '-0.5rem' }}>
          يوم العمل: {data.businessDate}
        </p>
      ) : null}

      {loading ? (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>جاري تحميل البيانات…</p>
        </div>
      ) : err ? (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--danger)' }}>{err}</p>
        </div>
      ) : null}

      {!loading && !err && data ? (
        <div className="grid-2">
          {user?.role === 'super_admin' ? (
            <div className="card">
              <h2 className="card-title">المخطط الاستراتيجي</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                المعاينة الأولى واعتماد الخطة من حساب المدير — ثم تظهر لأطباء الفروع عند البحث عن
                المريض.
              </p>
              {data.strategic?.patient ? (
                <>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                    {data.strategic.hint}
                  </p>
                  <Link
                    to={`/patients/${data.strategic.patient.id}`}
                    className="btn btn-primary"
                    style={{ ...gradientBtn, marginTop: '0.75rem', display: 'inline-flex', justifyContent: 'center' }}
                  >
                    فتح ملف مريض ({data.strategic.patient.name})
                  </Link>
                </>
              ) : (
                <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  لا يوجد مريض مسجّل في قسم الأسنان بعد. أضف مريضاً من صفحة المرضى أو شغّل البذر.
                </p>
              )}
              <div style={{ marginTop: '1rem' }}>
                <Link to="/patients" className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
                  البحث عن مريض ←
                </Link>
              </div>
            </div>
          ) : (
            <div className="card">
              <h2 className="card-title">المخطط الاستراتيجي</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                وضع الخطة والاعتماد من حساب المدير فقط. افتح ملف المريض من القائمة أدناه عند توفر خطة
                معتمدة.
              </p>
            </div>
          )}

          <div className="card">
            <h2 className="card-title">أطباء الفروع</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              عرض الخطة المعتمدة، المخطط السني، والذمم لكل مريض.
            </p>
            {data.approvedQueue.length === 0 ? (
              <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                لا توجد خطط معتمدة حالياً.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0', display: 'grid', gap: '0.5rem' }}>
                {data.approvedQueue.map((row) => (
                  <li key={row.planId}>
                    <Link
                      to={`/patients/${row.patient.id}`}
                      className="btn btn-secondary"
                      style={{ width: '100%', justifyContent: 'space-between', display: 'flex', fontSize: '0.85rem' }}
                    >
                      <span>{row.patient.name}</span>
                      <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>الخطة معتمدة</span>
                    </Link>
                    {row.summary ? (
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {row.summary}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <Link to="/patients" className="btn btn-ghost" style={{ fontSize: '0.85rem', marginTop: '1rem', display: 'inline-block' }}>
              كل المرضى ←
            </Link>
          </div>
        </div>
      ) : null}
    </>
  )
}
