import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import logoEliasClinic from '../../assets/logo-elias-clinic.png'
import { SERVICES } from './serviceCatalog'
import { useSceneCapability } from './useSceneCapability'
import './patient-welcome.css'

export type ScenePhase = 'dark' | 'logo' | 'services' | 'interactive'

const INTRO_SEEN_KEY = 'pw-intro-seen'
const GLYPHS: Record<string, string> = {
  dentistry: 'ط',
  dermatology: 'ج',
  skincare: 'ع',
  solarium: 'س',
  laser: 'ل',
}

const OrbitCanvas = lazy(() => import('./OrbitCanvas'))

interface PatientWelcomeSceneProps {
  patientName: string
}

function useHasSeenIntro(): boolean {
  return useMemo(() => {
    try {
      return sessionStorage.getItem(INTRO_SEEN_KEY) === '1'
    } catch {
      return false
    }
  }, [])
}

function markIntroSeen() {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  } catch {
    /* private browsing / storage disabled — replay is a harmless fallback */
  }
}

const MOTES = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  top: `${(i * 53) % 100}%`,
  size: 2 + ((i * 7) % 4),
  dur: 10 + ((i * 5) % 10),
  delay: -(i * 1.3),
  opacity: 0.25 + ((i % 5) * 0.06),
}))

export function PatientWelcomeScene({ patientName }: PatientWelcomeSceneProps) {
  const nav = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const cap = useSceneCapability()
  const hasSeenIntro = useHasSeenIntro()
  const instant = hasSeenIntro || cap.reducedMotion
  const [phase, setPhase] = useState<ScenePhase>(() => (instant ? 'interactive' : 'dark'))
  const [activeService, setActiveService] = useState<string | null>(null)
  const [containerActive, setContainerActive] = useState(true)

  const use3D = cap.webglSupported && !cap.reducedMotion

  useEffect(() => {
    if (instant) return
    const t1 = window.setTimeout(() => setPhase('logo'), 300)
    const t2 = window.setTimeout(() => setPhase('services'), 300 + 1150)
    const t3 = window.setTimeout(() => {
      setPhase('interactive')
      markIntroSeen()
    }, 300 + 1150 + 1500)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [instant])

  // Pause the render loop when the scene scrolls offscreen or the tab is hidden.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let intersecting = true
    const update = () => setContainerActive(intersecting && !document.hidden)
    const observer = new IntersectionObserver(
      ([entry]) => {
        intersecting = entry.isIntersecting
        update()
      },
      { threshold: 0.05 },
    )
    observer.observe(el)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  function handleSelect(href: string) {
    nav(href)
  }

  function handleScrollCue() {
    const el = rootRef.current
    if (!el) return
    window.scrollTo({
      top: el.offsetHeight - 64,
      behavior: cap.reducedMotion ? 'auto' : 'smooth',
    })
  }

  const activeDef = SERVICES.find((s) => s.id === activeService) || null

  return (
    <section
      ref={rootRef}
      className="pw-root"
      data-phase={phase}
      aria-label="مشهد الترحيب بالمريض وخدمات العيادة"
    >
      <div className="pw-bg" aria-hidden="true" />
      <div className="pw-motes" aria-hidden="true">
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="pw-mote"
            style={
              {
                left: m.left,
                top: m.top,
                width: m.size,
                height: m.size,
                '--pw-dur': `${m.dur}s`,
                '--pw-delay': `${m.delay}s`,
                '--pw-opacity': m.opacity,
              } as CSSProperties
            }
          />
        ))}
      </div>

      {use3D ? (
        <div className="pw-canvas-wrap" aria-hidden="true">
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
              onSelectService={handleSelect}
            />
          </Suspense>
        </div>
      ) : (
        <div className="pw-fallback-orb" aria-hidden="true">
          <img className="pw-fallback-logo" src={logoEliasClinic} alt="" />
        </div>
      )}

      <div className="pw-title">
        <p className="pw-eyebrow">بوابة المريض</p>
        <h1 className="pw-headline">
          مرحباً، <strong>{patientName || 'بك'}</strong>
        </h1>
        <p className="pw-subline">تجربة رعاية متكاملة — اختر خدمتك لمتابعة سجلك ومواعيدك.</p>
      </div>

      <div
        className={`pw-info${activeDef ? ' is-visible' : ''}`}
        style={activeDef ? ({ '--pw-accent': `rgb(${activeDef.accent.map((c) => Math.round(c * 255)).join(',')})` } as CSSProperties) : undefined}
        aria-hidden="true"
      >
        {activeDef ? (
          <>
            <p className="pw-info-name">{activeDef.name}</p>
            <p className="pw-info-desc">{activeDef.description}</p>
          </>
        ) : null}
      </div>

      <nav className="pw-dock" aria-label="خدمات العيادة">
        {SERVICES.map((s) => (
          <Link
            key={s.id}
            to={s.href}
            className={`pw-dock-item${activeService === s.id ? ' is-active' : ''}`}
            style={{ '--pw-accent': `rgb(${s.accent.map((c) => Math.round(c * 255)).join(',')})` } as CSSProperties}
            onMouseEnter={() => setActiveService(s.id)}
            onMouseLeave={() => setActiveService((cur) => (cur === s.id ? null : cur))}
            onFocus={() => setActiveService(s.id)}
            onBlur={() => setActiveService((cur) => (cur === s.id ? null : cur))}
          >
            <span className="pw-dock-glyph" aria-hidden="true">
              {GLYPHS[s.id]}
            </span>
            <span className="pw-dock-label">{s.name}</span>
            <span className="pw-dock-desc">{s.description}</span>
          </Link>
        ))}
      </nav>

      <button type="button" className="pw-scroll-cue" onClick={handleScrollCue}>
        <span>نظرة عامة</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </section>
  )
}
