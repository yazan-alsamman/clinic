import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import logoEliasClinic from '../../assets/logo-elias-clinic.png'
import { SERVICES } from './serviceCatalog'
import { useSceneCapability } from './useSceneCapability'
import type { ScenePhase } from './types'
import './cinematic-welcome.css'

const EXIT_DURATION_MS = 820

const GLYPHS: Record<string, string> = {
  dentistry: 'طب الأسنان',
  dermatology: 'الجلدية',
  skincare: 'العناية بالبشرة',
  solarium: 'السولاريوم',
  laser: 'إزالة الشعر بالليزر',
}

const OrbitCanvas = lazy(() => import('./OrbitCanvas'))

interface CinematicWelcomeSceneProps {
  patientName: string
  onContinue: () => void
}

function accentCss(accent: [number, number, number]): string {
  return `rgb(${accent.map((c) => Math.round(c * 255)).join(',')})`
}

export function CinematicWelcomeScene({ patientName, onContinue }: CinematicWelcomeSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cap = useSceneCapability()
  const instant = cap.reducedMotion
  const [phase, setPhase] = useState<ScenePhase>(() => (instant ? 'interactive' : 'dark'))
  const [activeService, setActiveService] = useState<string | null>(null)
  const [containerActive, setContainerActive] = useState(true)
  const [exiting, setExiting] = useState(false)

  const use3D = cap.webglSupported && !cap.reducedMotion

  useEffect(() => {
    if (instant) return
    const t1 = window.setTimeout(() => setPhase('logo'), 300)
    const t2 = window.setTimeout(() => setPhase('services'), 300 + 1150)
    const t3 = window.setTimeout(() => setPhase('interactive'), 300 + 1150 + 1500)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [instant])

  // Pause the render loop when the tab is hidden — this is a full-screen
  // experience, so only visibility (not scroll position) matters here.
  useEffect(() => {
    const update = () => setContainerActive(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  function handleContinue() {
    if (exiting) return
    setExiting(true)
    setPhase('exiting')
    window.setTimeout(onContinue, instant ? 120 : EXIT_DURATION_MS)
  }

  const activeDef = SERVICES.find((s) => s.id === activeService) || null

  return (
    <div ref={rootRef} className="cw-root" data-phase={phase} role="dialog" aria-label="مشهد ترحيب سينمائي بمرضى عيادة د. إلياس دحدل">
      <div className="cw-bg" aria-hidden="true" />
      <div className="cw-motes" aria-hidden="true">
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="cw-mote"
            style={
              {
                left: m.left,
                top: m.top,
                width: m.size,
                height: m.size,
                '--cw-dur': `${m.dur}s`,
                '--cw-delay': `${m.delay}s`,
                '--cw-opacity': m.opacity,
              } as CSSProperties
            }
          />
        ))}
      </div>

      {use3D ? (
        <div className="cw-canvas-wrap" aria-hidden="true">
          <Suspense fallback={null}>
            <OrbitCanvas
              phase={phase}
              instant={instant}
              active={containerActive}
              isTouch={cap.isTouch}
              lowPower={cap.isLowPower}
              logoUrl={logoEliasClinic}
              activeService={activeService}
              onHoverService={setActiveService}
            />
          </Suspense>
        </div>
      ) : (
        <div className="cw-fallback-orb" aria-hidden="true">
          <img className="cw-fallback-logo" src={logoEliasClinic} alt="" />
        </div>
      )}

      <div className="cw-title">
        <p className="cw-eyebrow">مركز الدكتور إلياس دحدل</p>
        <h1 className="cw-headline">
          مرحباً، <strong>{patientName || 'بك'}</strong>
        </h1>
        <p className="cw-subline">نرحّب بك في تجربة رعاية متكاملة — استكشف عالم العيادة قبل أن نُكمل.</p>
      </div>

      <div
        className={`cw-info${activeDef ? ' is-visible' : ''}`}
        style={activeDef ? ({ '--cw-accent': accentCss(activeDef.accent) } as CSSProperties) : undefined}
        aria-hidden="true"
      >
        {activeDef ? (
          <>
            <p className="cw-info-name">{activeDef.name}</p>
            <p className="cw-info-desc">{activeDef.description}</p>
          </>
        ) : null}
      </div>

      <div className="cw-markers" role="group" aria-label="خدمات العيادة">
        {SERVICES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`cw-marker${activeService === s.id ? ' is-active' : ''}`}
            style={{ '--cw-accent': accentCss(s.accent) } as CSSProperties}
            onMouseEnter={() => setActiveService(s.id)}
            onMouseLeave={() => setActiveService((cur) => (cur === s.id ? null : cur))}
            onFocus={() => setActiveService(s.id)}
            onBlur={() => setActiveService((cur) => (cur === s.id ? null : cur))}
          >
            <span className="cw-sr-only">{GLYPHS[s.id]}</span>
          </button>
        ))}
      </div>

      <div className="cw-continue-wrap">
        <button type="button" className="cw-continue" onClick={handleContinue} disabled={exiting}>
          <span>متابعة</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="cw-veil" aria-hidden="true" />
    </div>
  )
}

const MOTES = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  top: `${(i * 53) % 100}%`,
  size: 2 + ((i * 7) % 4),
  dur: 10 + ((i * 5) % 10),
  delay: -(i * 1.3),
  opacity: 0.25 + ((i % 5) * 0.06),
}))
