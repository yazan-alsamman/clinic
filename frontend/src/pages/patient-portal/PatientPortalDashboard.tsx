import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { patientApi } from '../../api/client'
import type { Patient } from '../../types'
import './patient-portal.css'

type DashboardPayload = {
  patient: Patient
  mustChangePassword: boolean
  summary: {
    laserSessionsCount: number
    dermatologyVisitsCount: number
    appointmentsTotal: number
    upcomingAppointmentsCount: number
    dentalPlanStatus: string | null
  }
  upcomingAppointments: {
    id: string
    businessDate: string
    time: string
    endTime: string
    providerName: string
    procedureType: string
  }[]
  updates: { kind: string; at: string; label: string }[]
}

export function PatientPortalDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await patientApi<DashboardPayload>('/api/patient-portal/dashboard')
        if (!cancelled) {
          setData(d)
          setErr('')
        }
      } catch {
        if (!cancelled) setErr('تعذر تحميل لوحة التحكم')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (err) {
    return <div className="card"><p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p></div>
  }

  if (!data) {
    return <div style={{ color: 'var(--text-muted)' }}>جاري التحميل…</div>
  }

  return (
    <>
      <div className="patient-hero">
        <h1>مرحباً، {data.patient.name}</h1>
        <p>نظرة شاملة على ملفك الصحي ومواعيدك — محدّثة من فريق العيادة.</p>
        {data.mustChangePassword ? (
          <p style={{ margin: '0.75rem 0 0', color: 'var(--warning)' }}>
            يُرجى{' '}
            <Link to="/patient/security" style={{ fontWeight: 700 }}>
              تغيير كلمة المرور
            </Link>{' '}
            لأسباب أمنية.
          </p>
        ) : null}
      </div>

      <div className="patient-stat-grid">
        <div className="patient-stat">
          <div className="n">{data.summary.laserSessionsCount}</div>
          <div className="l">جلسات ليزر</div>
        </div>
        <div className="patient-stat">
          <div className="n">{data.summary.dermatologyVisitsCount}</div>
          <div className="l">زيارات جلدية</div>
        </div>
        <div className="patient-stat">
          <div className="n">{data.summary.upcomingAppointmentsCount}</div>
          <div className="l">مواعيد قادمة</div>
        </div>
        <div className="patient-stat">
          <div className="n" style={{ fontSize: '1rem', color: 'var(--violet)' }}>
            {data.summary.dentalPlanStatus === 'approved'
              ? 'معتمدة'
              : data.summary.dentalPlanStatus === 'draft'
                ? 'مسودة'
                : '—'}
          </div>
          <div className="l">خطة الأسنان</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: '1rem', alignItems: 'stretch' }}>
        <div className="card" style={{ margin: 0 }}>
          <h2 className="card-title">مواعيد قادمة</h2>
          {data.upcomingAppointments.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              لا توجد مواعيد مسجّلة في المستقبل حسب البيانات الحالية.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {data.upcomingAppointments.map((a) => (
                <li
                  key={a.id}
                  style={{
                    padding: '0.65rem 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.9rem',
                  }}
                >
                  <strong>{a.businessDate}</strong> — {a.time}
                  {a.endTime ? ` — ${a.endTime}` : ''}
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {a.procedureType || 'موعد'} · {a.providerName}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link to="/patient/appointments" style={{ display: 'inline-block', marginTop: '0.75rem', fontSize: '0.88rem' }}>
            عرض كل المواعيد →
          </Link>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h2 className="card-title">آخر التحديثات</h2>
          {data.updates.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              لا توجد أحداث حديثة في السجل.
            </p>
          ) : (
            <ul className="patient-updates">
              {data.updates.map((u, i) => (
                <li key={`${u.at}-${i}`}>
                  <span className="dot" />
                  <div>
                    <div>{u.label}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {new Date(u.at).toLocaleString('ar-SY', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link to="/patient/records" style={{ display: 'inline-block', marginTop: '0.75rem', fontSize: '0.88rem' }}>
            السجل الطبي الكامل →
          </Link>
        </div>
      </div>
    </>
  )
}
