import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getPatientToken, patientApi } from '../../api/client'
import { CinematicWelcomeScene } from '../../components/patient-welcome/CinematicWelcomeScene'
import { markPatientWelcomeSeen } from './patientWelcomeGate'

type WelcomeLocationState = {
  mustChangePassword?: boolean
  patientName?: string
}

class WelcomeSceneErrorBoundary extends Component<
  { children: ReactNode; onContinue: () => void; patientName: string },
  { crashed: boolean }
> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cinematic welcome scene failed:', error, info)
  }

  render() {
    if (this.state.crashed) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 500,
            display: 'grid',
            placeItems: 'center',
            background: '#0b0c14',
            color: '#f5f0ec',
            padding: '1.5rem',
            textAlign: 'center',
            direction: 'rtl',
          }}
        >
          <div style={{ maxWidth: 420 }}>
            <p style={{ margin: '0 0 0.5rem', opacity: 0.75, fontSize: '0.9rem' }}>مركز الدكتور إلياس دحدل</p>
            <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.6rem' }}>
              مرحباً، {this.props.patientName || 'بك'}
            </h1>
            <p style={{ margin: '0 0 1.25rem', opacity: 0.8, lineHeight: 1.55 }}>
              تعذر عرض المشهد التفاعلي على هذا الجهاز. يمكنك المتابعة إلى بوابة المريض.
            </p>
            <button
              type="button"
              onClick={this.props.onContinue}
              style={{
                appearance: 'none',
                border: '1px solid rgba(245,240,236,0.35)',
                background: 'rgba(245,240,236,0.08)',
                color: '#f5f0ec',
                borderRadius: 999,
                padding: '0.7rem 1.4rem',
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              متابعة
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Standalone full-screen gateway shown after patient login — before the
 * password-change screen and portal. Outside PatientPortalShell/Guard so it is
 * not redirected away by mustChangePassword.
 */
export function PatientCinematicWelcome() {
  const nav = useNavigate()
  const loc = useLocation()
  const locState = (loc.state || {}) as WelcomeLocationState
  const [name, setName] = useState(String(locState.patientName || ''))
  const [mustChangePassword, setMustChangePassword] = useState(
    locState.mustChangePassword === true,
  )

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
        if (!cancelled && !getPatientToken()) nav('/login', { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nav])

  function handleContinue() {
    markPatientWelcomeSeen()
    nav(mustChangePassword ? '/patient/security' : '/patient', { replace: true })
  }

  return (
    <WelcomeSceneErrorBoundary patientName={name} onContinue={handleContinue}>
      <CinematicWelcomeScene patientName={name} onContinue={handleContinue} />
    </WelcomeSceneErrorBoundary>
  )
}
