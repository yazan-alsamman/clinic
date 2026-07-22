import type { DentalSurfaceMark, DentalToothState, ImplantColor } from './dentalChartTypes'
import { isUpperFdi, toothKind } from './dentalChartTypes'

const CROWN = '#f5f1ea'
const CROWN_STROKE = '#c4b8a8'
const ROOT = '#c4a574'
const ROOT_STROKE = '#9a7b4f'
const FILLING = '#f5d547'
const MISSING_STROKE = '#1a1a1a'

function ImplantScrew({ color, flip }: { color: ImplantColor; flip?: boolean }) {
  const fill = color === 'red' ? '#e11d2e' : '#14b8a6'
  const stroke = color === 'red' ? '#991b1b' : '#0f766e'
  return (
    <g transform={flip ? 'translate(0,78) scale(1,-1)' : undefined}>
      <path
        d="M18 8 L22 8 L24 14 L26 70 L14 70 L16 14 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.2"
      />
      {[22, 30, 38, 46, 54, 62].map((y) => (
        <line key={y} x1="14" y1={y} x2="26" y2={y} stroke={stroke} strokeWidth="1.4" />
      ))}
      <ellipse cx="20" cy="72" rx="8" ry="3.5" fill={fill} stroke={stroke} strokeWidth="1" />
    </g>
  )
}

function surfaceHighlight(
  marks: DentalSurfaceMark[],
  view: 'buccal' | 'occlusal',
  kind: ReturnType<typeof toothKind>,
) {
  const relevant = marks.filter((m) => m.view === view)
  if (!relevant.length) return null
  return relevant.map((m, i) => {
    let d = ''
    if (view === 'occlusal') {
      if (kind === 'incisor' || kind === 'canine') {
        if (m.region === 'I' || m.region === 'O') d = 'M10 28 L30 28 L28 36 L12 36 Z'
        else if (m.region === 'M') d = 'M8 14 L16 14 L16 34 L8 34 Z'
        else if (m.region === 'D') d = 'M24 14 L32 14 L32 34 L24 34 Z'
        else d = 'M12 12 L28 12 L28 28 L12 28 Z'
      } else {
        if (m.region === 'M') d = 'M6 10 L16 10 L16 38 L6 38 Z'
        else if (m.region === 'D') d = 'M24 10 L34 10 L34 38 L24 38 Z'
        else if (m.region === 'B') d = 'M10 6 L30 6 L30 16 L10 16 Z'
        else if (m.region === 'L') d = 'M10 32 L30 32 L30 42 L10 42 Z'
        else d = 'M12 14 L28 14 L28 34 L12 34 Z'
      }
    } else {
      if (m.region === 'I' || m.region === 'O') d = 'M10 4 L30 4 L28 12 L12 12 Z'
      else if (m.region === 'M') d = 'M6 8 L14 8 L14 28 L6 28 Z'
      else if (m.region === 'D') d = 'M26 8 L34 8 L34 28 L26 28 Z'
      else d = 'M10 6 L30 6 L28 16 L12 16 Z'
    }
    return <path key={`${m.region}-${i}`} d={d} fill={FILLING} opacity={0.92} />
  })
}

function BuccalToothArt({
  fdi,
  tooth,
}: {
  fdi: number
  tooth: DentalToothState
}) {
  const upper = isUpperFdi(fdi)
  const kind = toothKind(fdi)
  const flip = !upper

  if (tooth.status === 'missing') {
    return (
      <g transform={flip ? 'translate(0,90) scale(1,-1)' : undefined}>
        {kind === 'molar' ? (
          <path
            d="M6 6 Q20 2 34 6 L36 30 Q20 36 4 30 Z M10 30 L8 78 M20 32 L20 82 M30 30 L32 78"
            fill="none"
            stroke={MISSING_STROKE}
            strokeWidth="1.6"
            strokeDasharray="3 2"
          />
        ) : kind === 'premolar' ? (
          <path
            d="M10 6 Q20 2 30 6 L32 28 Q20 34 8 28 Z M14 28 L12 76 M26 28 L28 76"
            fill="none"
            stroke={MISSING_STROKE}
            strokeWidth="1.6"
            strokeDasharray="3 2"
          />
        ) : (
          <path
            d="M12 4 Q20 0 28 4 L30 26 Q20 32 10 26 Z M18 26 L18 78"
            fill="none"
            stroke={MISSING_STROKE}
            strokeWidth="1.6"
            strokeDasharray="3 2"
          />
        )}
      </g>
    )
  }

  if (tooth.status === 'implant') {
    return <ImplantScrew color={tooth.implantColor === 'red' ? 'red' : 'teal'} flip={flip} />
  }

  const crown =
    kind === 'molar' ? (
      <path d="M5 6 Q20 1 35 6 L37 28 Q20 36 3 28 Z" fill={CROWN} stroke={CROWN_STROKE} strokeWidth="1.2" />
    ) : kind === 'premolar' ? (
      <path d="M9 5 Q20 1 31 5 L33 26 Q20 34 7 26 Z" fill={CROWN} stroke={CROWN_STROKE} strokeWidth="1.2" />
    ) : kind === 'canine' ? (
      <path d="M12 2 Q20 -2 28 2 L30 24 Q20 30 10 24 Z" fill={CROWN} stroke={CROWN_STROKE} strokeWidth="1.2" />
    ) : (
      <path d="M11 3 Q20 0 29 3 L30 24 Q20 30 10 24 Z" fill={CROWN} stroke={CROWN_STROKE} strokeWidth="1.2" />
    )

  const roots =
    kind === 'molar' ? (
      <>
        <path d="M10 28 L7 78 L13 78 Z" fill={ROOT} stroke={ROOT_STROKE} strokeWidth="1" />
        <path d="M18 30 L17 82 L23 82 Z" fill={ROOT} stroke={ROOT_STROKE} strokeWidth="1" />
        <path d="M28 28 L27 78 L33 78 Z" fill={ROOT} stroke={ROOT_STROKE} strokeWidth="1" />
      </>
    ) : kind === 'premolar' ? (
      <>
        <path d="M13 26 L10 76 L16 76 Z" fill={ROOT} stroke={ROOT_STROKE} strokeWidth="1" />
        <path d="M24 26 L22 76 L28 76 Z" fill={ROOT} stroke={ROOT_STROKE} strokeWidth="1" />
      </>
    ) : (
      <path d="M17 24 L15 78 L25 78 Z" fill={ROOT} stroke={ROOT_STROKE} strokeWidth="1" />
    )

  return (
    <g transform={flip ? 'translate(0,90) scale(1,-1)' : undefined}>
      {roots}
      {crown}
      {surfaceHighlight(tooth.surfaces, 'buccal', kind)}
    </g>
  )
}

function OcclusalToothArt({ fdi, tooth }: { fdi: number; tooth: DentalToothState }) {
  const kind = toothKind(fdi)

  if (tooth.status === 'missing') {
    return kind === 'molar' || kind === 'premolar' ? (
      <rect
        x="6"
        y="8"
        width="28"
        height="32"
        rx="6"
        fill="none"
        stroke={MISSING_STROKE}
        strokeWidth="1.6"
        strokeDasharray="3 2"
      />
    ) : (
      <ellipse
        cx="20"
        cy="24"
        rx="10"
        ry="14"
        fill="none"
        stroke={MISSING_STROKE}
        strokeWidth="1.6"
        strokeDasharray="3 2"
      />
    )
  }

  if (tooth.status === 'implant') {
    const fill = tooth.implantColor === 'red' ? '#e11d2e' : '#14b8a6'
    return <circle cx="20" cy="24" r="10" fill={fill} stroke="#0f172a" strokeWidth="1" opacity={0.85} />
  }

  const body =
    kind === 'molar' ? (
      <path
        d="M6 10 Q20 4 34 10 L36 38 Q20 46 4 38 Z"
        fill={CROWN}
        stroke={CROWN_STROKE}
        strokeWidth="1.2"
      />
    ) : kind === 'premolar' ? (
      <path
        d="M8 10 Q20 5 32 10 L33 36 Q20 42 7 36 Z"
        fill={CROWN}
        stroke={CROWN_STROKE}
        strokeWidth="1.2"
      />
    ) : (
      <ellipse cx="20" cy="24" rx="11" ry="15" fill={CROWN} stroke={CROWN_STROKE} strokeWidth="1.2" />
    )

  return (
    <g>
      {body}
      {kind === 'molar' || kind === 'premolar' ? (
        <>
          <line x1="20" y1="12" x2="20" y2="40" stroke="#ddd2c4" strokeWidth="1" />
          <line x1="10" y1="24" x2="30" y2="24" stroke="#ddd2c4" strokeWidth="1" />
        </>
      ) : null}
      {surfaceHighlight(tooth.surfaces, 'occlusal', kind)}
    </g>
  )
}

export function ToothCell({
  fdi,
  tooth,
  view,
  selected,
  onSelect,
  onSurfaceClick,
}: {
  fdi: number
  tooth: DentalToothState
  view: 'buccal' | 'occlusal'
  selected: boolean
  onSelect: () => void
  onSurfaceClick?: (region: DentalSurfaceMark['region']) => void
}) {
  const h = view === 'buccal' ? 92 : 52
  return (
    <button
      type="button"
      className={`odontogram-tooth${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      aria-label={`سن ${fdi}`}
      style={{ width: 44, height: h + 18 }}
    >
      <svg viewBox={`0 0 40 ${h}`} width="40" height={h} aria-hidden>
        {view === 'buccal' ? <BuccalToothArt fdi={fdi} tooth={tooth} /> : <OcclusalToothArt fdi={fdi} tooth={tooth} />}
        {/* invisible hit zones for filling tool on occlusal/buccal */}
        {onSurfaceClick && tooth.status === 'present' ? (
          <>
            <rect
              x="0"
              y="0"
              width="13"
              height={h}
              fill="transparent"
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
                onSurfaceClick('M')
              }}
            />
            <rect
              x="13"
              y="0"
              width="14"
              height={view === 'occlusal' ? h * 0.45 : h * 0.22}
              fill="transparent"
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
                onSurfaceClick(view === 'occlusal' ? (toothKind(fdi) === 'incisor' || toothKind(fdi) === 'canine' ? 'I' : 'B') : 'I')
              }}
            />
            <rect
              x="27"
              y="0"
              width="13"
              height={h}
              fill="transparent"
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
                onSurfaceClick('D')
              }}
            />
            {view === 'occlusal' ? (
              <rect
                x="13"
                y={h * 0.45}
                width="14"
                height={h * 0.55}
                fill="transparent"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect()
                  onSurfaceClick(toothKind(fdi) === 'incisor' || toothKind(fdi) === 'canine' ? 'I' : 'O')
                }}
              />
            ) : null}
          </>
        ) : null}
      </svg>
      <span className="odontogram-fdi" style={{ visibility: view === 'buccal' ? 'visible' : 'hidden' }}>
        {fdi}
      </span>
    </button>
  )
}
