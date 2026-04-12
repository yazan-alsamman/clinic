import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { patientApi, setPatientToken } from '../api/client'
import '../pages/patient-portal/patient-portal.css'

export function PatientPortalShell() {
  const nav = useNavigate()
  const loc = useLocation()
  const [name, setName] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await patientApi<{ patient: { name: string; mustChangePassword?: boolean } }>(
          '/api/patient-auth/me',
        )
        if (!cancelled) {
          setName(data.patient?.name || '')
          setMustChangePassword(data.patient?.mustChangePassword === true)
        }
      } catch {
        if (!cancelled) {
          setName('')
          setMustChangePassword(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loc.pathname])

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
          {mustChangePassword ? (
            <span style={{ fontSize: '0.85rem', color: 'var(--warning, #e7c36a)', fontWeight: 600 }}>
              يجب تغيير كلمة المرور من «الأمان» أولاً
            </span>
          ) : (
            <>
              <NavLink to="/patient" end>
                الرئيسية
              </NavLink>
              <NavLink to="/patient/profile">ملفي الشخصي</NavLink>
              <NavLink to="/patient/records">السجل الطبي</NavLink>
              <NavLink to="/patient/appointments">المواعيد</NavLink>
            </>
          )}
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
