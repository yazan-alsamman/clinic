import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { patientApi, setPatientToken } from '../api/client'
import '../pages/patient-portal/patient-portal.css'

export function PatientPortalShell() {
  const nav = useNavigate()
  const [name, setName] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await patientApi<{ patient: { name: string } }>('/api/patient-auth/me')
        if (!cancelled) setName(data.patient?.name || '')
      } catch {
        if (!cancelled) setName('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function logout() {
    setPatientToken(null)
    nav('/login', { replace: true })
  }

  return (
    <div className="patient-portal-root" dir="rtl">
      <header className="patient-portal-header">
        <div className="patient-portal-brand">
          <div className="patient-portal-mark">م</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>بوابة المريض</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {name || 'مرحباً بك'}
            </div>
          </div>
        </div>
        <nav className="patient-portal-nav">
          <NavLink to="/patient" end>
            الرئيسية
          </NavLink>
          <NavLink to="/patient/profile">ملفي الشخصي</NavLink>
          <NavLink to="/patient/records">السجل الطبي</NavLink>
          <NavLink to="/patient/appointments">المواعيد</NavLink>
          <NavLink to="/patient/security">الأمان</NavLink>
          <button type="button" className="btn btn-secondary" style={{ marginRight: '0.25rem' }} onClick={logout}>
            خروج
          </button>
        </nav>
      </header>
      <main className="patient-portal-main">
        <Outlet />
      </main>
    </div>
  )
}
