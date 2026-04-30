import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { Patient } from '../types'

type LowStock = {
  id: string
  name: string
  sku: string
  quantity: number
  safetyStockLevel: number
}

type TodayPayload = {
  businessDate: string
  todayPatients: Patient[]
  otherPatients: Patient[]
  lowStockItems: LowStock[]
}

const gradientBtn: CSSProperties = {
  background: 'linear-gradient(90deg, #22d3ee, #a855f7)',
  border: 'none',
  color: '#0f172a',
  fontWeight: 600,
}

export function DermatologyToday() {
  const { user } = useAuth()
  const canView =
    user?.role === 'super_admin' ||
    user?.role === 'dermatology' ||
    user?.role === 'dermatology_manager' ||
    user?.role === 'dermatology_assistant_manager'

  const [data, setData] = useState<TodayPayload | null>(null)
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
      const res = await api<TodayPayload>('/api/dermatology/today')
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
        <h1 className="page-title">الجلدية — زيارات اليوم</h1>
        <p className="page-desc">هذه الصفحة مخصصة لأطباء الجلدية والمدير.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">الجلدية — زيارات اليوم</h1>
      <p className="page-desc">إجراءات وباقات</p>

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
        <>
          <div className="card">
            <h2 className="card-title">زيارات اليوم (قسم الجلدية)</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.25rem' }}>
              مرضى لديهم قسم جلدية وآخر زيارة مسجّلة اليوم.
            </p>
            {data.todayPatients.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: '1rem 0 0' }}>
                لا توجد زيارات جلدية مسجّلة لهذا اليوم بعد.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0', display: 'grid', gap: '0.65rem' }}>
                {data.todayPatients.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/patients/${p.id}`}
                      className="btn btn-primary"
                      style={{ ...gradientBtn, display: 'inline-flex', width: '100%', maxWidth: 420, justifyContent: 'center' }}
                    >
                      فتح ملف — {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ marginTop: '1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              من هنا يمكن الانتقال لملف المريض ← تبويب الجلدية لاختيار الخدمات والمواد.
            </p>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title">مرضى الجلدية — متابعة سريعة</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.25rem' }}>
              آخر زيارة ليست اليوم؛ للوصول السريع للملف.
            </p>
            {data.otherPatients.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: '1rem 0 0' }}>لا يوجد.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                {data.otherPatients.map((p) => (
                  <Link key={p.id} to={`/patients/${p.id}`} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>
                    {p.name}
                  </Link>
                ))}
              </div>
            )}
            <div style={{ marginTop: '1rem' }}>
              <Link to="/patients" className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
                البحث في كل المرضى ←
              </Link>
            </div>
          </div>

          {user?.role === 'super_admin' ? (
            <div className="card" style={{ marginTop: '1rem' }}>
              <h2 className="card-title">تنبيهات المستودع (مواد قريبة من الحد)</h2>
              {data.lowStockItems.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>لا توجد تنبيهات حالياً.</p>
              ) : (
                <ul style={{ margin: '0.75rem 0 0', paddingRight: '1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {data.lowStockItems.map((i) => (
                    <li key={i.id}>
                      {i.name} — الكمية {i.quantity} (حد الأمان {i.safetyStockLevel})
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/inventory" className="btn btn-ghost" style={{ fontSize: '0.85rem', marginTop: '0.75rem', display: 'inline-block' }}>
                فتح المستودع
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}
