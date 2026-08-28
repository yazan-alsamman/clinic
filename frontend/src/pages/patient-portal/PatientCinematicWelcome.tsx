import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPatientToken, patientApi } from '../../api/client'
import { CinematicWelcomeScene } from '../../components/patient-welcome/CinematicWelcomeScene'

/**
 * Standalone full-screen gateway shown once, immediately after a patient's
 * credentials are verified — before the (existing, untouched) password-change
 * screen and portal. Deliberately outside `PatientPortalShell`/`PatientPortalGuard`:
 * it has no nav chrome and must not redirect on `mustChangePassword` the way the
 * rest of the portal does, since that decision is exactly what "Continue" makes.
 */
export function PatientCinematicWelcome() {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(false)

  useEffect(() => {
    if (!getPatientToken()) {
      nav('/login', { replace: true })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await patientApi<{ patient: { name: string; mustChangePassword?: boolean } }>(
          '/api/patient-auth/me',
        )
        if (cancelled) return
        setName(data.patient?.name || '')
        setMustChangePassword(data.patient?.mustChangePassword === true)
      } catch {
        if (!cancelled) nav('/login', { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nav])

  function handleContinue() {
    nav(mustChangePassword ? '/patient/security' : '/patient', { replace: true })
  }

  return <CinematicWelcomeScene patientName={name} onContinue={handleContinue} />
}
