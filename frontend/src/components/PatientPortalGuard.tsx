import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { patientApi, getPatientToken, setPatientToken } from '../api/client'

export function PatientPortalGuard() {
  const loc = useLocation()
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = getPatientToken()
    if (!t) {
      setAuthed(false)
      setMustChangePassword(false)
      setReady(true)
      return
    }
    ;(async () => {
      try {
        const data = await patientApi<{ patient: { mustChangePassword?: boolean } }>(
          '/api/patient-auth/me',
        )
        if (cancelled) return
        setAuthed(true)
        setMustChangePassword(data.patient?.mustChangePassword === true)
      } catch {
        if (cancelled) return
        setPatientToken(null)
        setAuthed(false)
        setMustChangePassword(false)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loc.pathname])

  if (!ready) {
    return (
      <div
        className="patient-portal-root"
        style={{ display: 'grid', placeItems: 'center', color: 'var(--text-muted)', minHeight: '100vh' }}
      >
        جاري التحميل…
      </div>
    )
  }

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  const path = loc.pathname.replace(/\/$/, '') || '/'
  const onSecurity = path === '/patient/security'
  if (mustChangePassword && !onSecurity) {
    return <Navigate to="/patient/security" replace />
  }

  return <Outlet />
}
