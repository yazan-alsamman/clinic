import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import logoEliasClinic from '../../assets/logo-elias-clinic.png'
import { SERVICES } from './serviceCatalog'
import { STATIONS } from './walkthroughPath'
import { useSceneCapability } from './useSceneCapability'
import { useWalkthroughProgress } from './useWalkthroughProgress'
import type { ScenePhase } from './types'
import type { ServiceGeometry } from './serviceCatalog'
import './cinematic-welcome.css'

const EXIT_DURATION_MS = 900
const ENTERING_DURATION_MS = 1100

const RAIL_LABELS: Record<string, string> = {
  dentistry: 'طب الأسنان',
  dermatology: 'الجلدية',
  skincare: 'العناية بالبشرة',
  solarium: 'السولاريوم',
  laser: 'إزالة الشعر بالليزر',
}

const WalkthroughCanvas = lazy(() => import('./WalkthroughCanvas'))

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
  const [phase, setPhase] = useState<ScenePhase>('entering')
  const [ready, setReady] = useState(false)
  const [containerActive, setContainerActive] = useState(true)
  const [hoverPreview, setHoverPreview] = useState<ServiceGeometry | null>(null)

  const use3D = cap.webglSupported && !cap.reducedMotion
  const walk = useWalkthroughProgress(rootRef, cap.reducedMotion)

  // One tick after first paint so the entrance fade has a "before" state to
  // transition from — mounting straight into the visible phase never animates.
  useEffect(() => {
    const t0 = window.setTimeout(() => setReady(true), 30)
    const t1 = window.setTimeout(() => setPhase('walking'), ENTERING_DURATION_MS)
    return () => {
      window.clearTimeout(t0)
      window.clearTimeout(t1)
    }
  }, [])

  // Pause the render loop when the tab is hidden — this is a full-screen
  // experience, so only visibility (not scroll position) matters here.
  useEffect(() => {
    const update = () => setContainerActive(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  function handleContinue() {
    if (phase === 'exiting') return
    walk.setLocked(true)
    walk.jumpTo(1)
    setPhase('exiting')
    window.setTimeout(onContinue, cap.reducedMotion ? 150 : EXIT_DURATION_MS)
  }

  const displayedStation = hoverPreview ?? walk.activeStation
  const activeDef = SERVICES.find((s) => s.id === displayedStation) || null

  return (
    <div
      ref={rootRef}
      className="cw-root"
      data-phase={ready ? phase : 'dark'}
      role="dialog"
      aria-label="جولة سينمائية داخل عيادة د. إلياس دحدل — مرّر للتقدّم عبر الممر"
    >
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
            <WalkthroughCanvas
              active={containerActive}
              isTouch={cap.isTouch}
              lowPower={cap.isLowPower}
              mobile={cap.isNarrow}
              logoUrl={logoEliasClinic}
              progressRef={walk.progressRef}
              velocityRef={walk.velocityRef}
              activeStation={walk.activeStation}
            />
          </Suspense>
        </div>
      ) : (
        <FallbackJourney activeStation={walk.activeStation} />
      )}

      <div className="cw-vignette" aria-hidden="true" />

      <div className="cw-title">
        <p className="cw-eyebrow">مركز الدكتور إلياس دحدل</p>
        <h1 className="cw-headline">
          مرحباً، <strong>{patientName || 'بك'}</strong>
        </h1>
        <p className="cw-subline">تجولي معنا داخل العيادة — مرّري للأسفل لمتابعة الجولة.</p>
      </div>

      <div
        className={`cw-scroll-hint${walk.hasInteracted ? ' is-hidden' : ''}`}
        aria-hidden="true"
      >
        <span>مرّر للاستكشاف</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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

      <nav className="cw-rail" aria-label="أقسام العيادة">
        {SERVICES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`cw-marker${walk.activeStation === s.id ? ' is-active' : ''}`}
            style={{ '--cw-accent': accentCss(s.accent) } as CSSProperties}
            onMouseEnter={() => setHoverPreview(s.id)}
            onMouseLeave={() => setHoverPreview((cur) => (cur === s.id ? null : cur))}
            onFocus={() => setHoverPreview(s.id)}
            onBlur={() => setHoverPreview((cur) => (cur === s.id ? null : cur))}
            onClick={() => walk.jumpTo(STATIONS[i].railT)}
          >
            <span className="cw-sr-only">{RAIL_LABELS[s.id]}</span>
          </button>
        ))}
      </nav>

      <div className="cw-continue-wrap" data-unlocked={walk.continueUnlocked}>
        <button type="button" className="cw-continue" onClick={handleContinue} disabled={phase === 'exiting'}>
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

/** Reduced-motion / no-WebGL path: no camera movement at all — the same
 * journey is told through a gentle text cross-fade the rail and scroll/
 * keyboard input still drive, next to a stationary, softly glowing logo. */
function FallbackJourney({ activeStation }: { activeStation: ServiceGeometry | null }) {
  const def = SERVICES.find((s) => s.id === activeStation) || null
  return (
    <div className="cw-fallback-orb" aria-hidden="true">
      <img className="cw-fallback-logo" src={logoEliasClinic} alt="" />
      <div className={`cw-fallback-text${def ? ' is-visible' : ''}`}>
        {def ? (
          <>
            <p className="cw-info-name">{def.name}</p>
            <p className="cw-info-desc">{def.description}</p>
          </>
        ) : null}
      </div>
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
