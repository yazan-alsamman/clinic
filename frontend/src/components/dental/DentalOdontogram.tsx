import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { ToothCell } from './ToothSvg'
import {
  arabicToothName,
  chartTeethPayload,
  LOWER_ROW,
  teethMapFromChart,
  toothStatusLabel,
  UPPER_ROW,
  type ChartTool,
  type DentalChartDto,
  type DentalToothState,
  type SurfaceRegion,
  type SurfaceView,
} from './dentalChartTypes'

type Props = {
  patientId: string
  canEdit: boolean
}

const TOOLS: { id: ChartTool; label: string }[] = [
  { id: 'select', label: 'تحديد' },
  { id: 'healthy', label: 'سليم' },
  { id: 'missing', label: 'مفقود' },
  { id: 'implant_teal', label: 'زراعة' },
  { id: 'implant_red', label: 'زراعة حمراء' },
  { id: 'filling', label: 'حشوة كومبوزيت' },
  { id: 'clear_surface', label: 'مسح حشوة' },
]

export function DentalOdontogram({ patientId, canEdit }: Props) {
  const [teethMap, setTeethMap] = useState(() => teethMapFromChart([]))
  const [selectedFdi, setSelectedFdi] = useState<number | null>(21)
  const [tool, setTool] = useState<ChartTool>('select')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [dirty, setDirty] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextAutosave = useRef(true)

  const selected = selectedFdi != null ? teethMap.get(selectedFdi) : null

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await api<{ chart: DentalChartDto }>(`/api/dental/chart/${encodeURIComponent(patientId)}`)
      skipNextAutosave.current = true
      setTeethMap(teethMapFromChart(data.chart?.teeth || []))
      setDirty(false)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل مخطط الأسنان')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  const persist = useCallback(
    async (map: Map<number, DentalToothState>) => {
      if (!canEdit) return
      setSaving(true)
      setErr('')
      setOk('')
      try {
        const data = await api<{ chart: DentalChartDto }>(`/api/dental/chart/${encodeURIComponent(patientId)}`, {
          method: 'PUT',
          body: JSON.stringify({ teeth: chartTeethPayload(map) }),
        })
        skipNextAutosave.current = true
        setTeethMap(teethMapFromChart(data.chart?.teeth || []))
        setDirty(false)
        setOk('تم حفظ المخطط')
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : 'تعذر حفظ المخطط')
      } finally {
        setSaving(false)
      }
    },
    [canEdit, patientId],
  )

  useEffect(() => {
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false
      return
    }
    if (!dirty || !canEdit) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void persist(teethMap)
    }, 700)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [teethMap, dirty, canEdit, persist])

  const updateTooth = useCallback(
    (fdi: number, updater: (prev: DentalToothState) => DentalToothState) => {
      if (!canEdit) {
        setSelectedFdi(fdi)
        return
      }
      setTeethMap((prev) => {
        const next = new Map(prev)
        const cur = next.get(fdi) || {
          fdi,
          status: 'present' as const,
          implantColor: null,
          surfaces: [],
          note: '',
        }
        next.set(fdi, updater(cur))
        return next
      })
      setDirty(true)
      setSelectedFdi(fdi)
      setOk('')
    },
    [canEdit],
  )

  const applyToolToTooth = useCallback(
    (fdi: number, view: SurfaceView, region?: SurfaceRegion) => {
      setSelectedFdi(fdi)
      if (!canEdit || tool === 'select') return

      if (tool === 'healthy') {
        updateTooth(fdi, () => ({ fdi, status: 'present', implantColor: null, surfaces: [], note: '' }))
        return
      }
      if (tool === 'missing') {
        updateTooth(fdi, () => ({ fdi, status: 'missing', implantColor: null, surfaces: [], note: '' }))
        return
      }
      if (tool === 'implant_teal') {
        updateTooth(fdi, () => ({
          fdi,
          status: 'implant',
          implantColor: 'teal',
          surfaces: [],
          note: '',
        }))
        return
      }
      if (tool === 'implant_red') {
        updateTooth(fdi, () => ({
          fdi,
          status: 'implant',
          implantColor: 'red',
          surfaces: [],
          note: '',
        }))
        return
      }
      if (tool === 'filling') {
        const r = region || (view === 'occlusal' ? 'O' : 'I')
        updateTooth(fdi, (prev) => {
          if (prev.status !== 'present') {
            return {
              fdi,
              status: 'present',
              implantColor: null,
              surfaces: [{ view, region: r, label: 'حشوة كومبوزيت' }],
              note: '',
            }
          }
          const surfaces = prev.surfaces.filter((s) => !(s.view === view && s.region === r))
          surfaces.push({ view, region: r, label: 'حشوة كومبوزيت' })
          return { ...prev, status: 'present', implantColor: null, surfaces }
        })
        return
      }
      if (tool === 'clear_surface') {
        const r = region
        updateTooth(fdi, (prev) => {
          if (!r) return { ...prev, surfaces: [] }
          return {
            ...prev,
            surfaces: prev.surfaces.filter((s) => !(s.view === view && s.region === r)),
          }
        })
      }
    },
    [canEdit, tool, updateTooth],
  )

  const tooltip = useMemo(() => {
    if (!selected) return null
    return {
      title: arabicToothName(selected.fdi),
      subtitle: toothStatusLabel(selected),
    }
  }, [selected])

  function renderArch(
    row: readonly number[],
    view: SurfaceView,
    showNumbers: boolean,
  ) {
    return (
      <div className="odontogram-arch-row">
        {row.map((fdi) => {
          const tooth = teethMap.get(fdi)!
          return (
            <div key={`${view}-${fdi}`} className="odontogram-cell-wrap">
              <ToothCell
                fdi={fdi}
                tooth={tooth}
                view={view}
                selected={selectedFdi === fdi}
                onSelect={() => applyToolToTooth(fdi, view)}
                onSurfaceClick={
                  canEdit && (tool === 'filling' || tool === 'clear_surface')
                    ? (region) => applyToolToTooth(fdi, view, region)
                    : undefined
                }
              />
              {!showNumbers ? null : null}
            </div>
          )
        })}
      </div>
    )
  }

  if (loading) {
    return <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل مخطط الأسنان…</p>
  }

  return (
    <div className="odontogram">
      {canEdit ? (
        <div className="odontogram-toolbar">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn ${tool === t.id ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
              onClick={() => setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem', marginInlineStart: 'auto' }}
            disabled={saving || !dirty}
            onClick={() => void persist(teethMap)}
          >
            {saving ? 'جاري الحفظ…' : dirty ? 'حفظ الآن' : 'محفوظ'}
          </button>
        </div>
      ) : (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          عرض فقط — تعديل المخطط لأطباء الأسنان ومدير النظام.
        </p>
      )}

      {err ? (
        <p style={{ color: 'var(--danger)', margin: '0 0 0.5rem', fontSize: '0.88rem' }}>{err}</p>
      ) : null}
      {ok ? (
        <p style={{ color: 'var(--success)', margin: '0 0 0.5rem', fontSize: '0.88rem' }}>{ok}</p>
      ) : null}

      <div className="odontogram-scroll">
        <div className="odontogram-board">
          {tooltip && selectedFdi != null ? (
            <div className="odontogram-tooltip" role="status">
              <strong>{tooltip.title}</strong>
              <span>{tooltip.subtitle}</span>
            </div>
          ) : null}

          <div className="odontogram-arch">
            {renderArch(UPPER_ROW, 'buccal', true)}
            {renderArch(UPPER_ROW, 'occlusal', false)}
          </div>

          <div className="odontogram-midline" aria-hidden />

          <div className="odontogram-arch">
            {renderArch(LOWER_ROW, 'occlusal', false)}
            {renderArch(LOWER_ROW, 'buccal', true)}
          </div>
        </div>
      </div>

      <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        اختر أداة ثم انقر على السن. لحشوة كومبوزيت: فعّل الأداة ثم انقر على السطح (أنسي/وحشي/إطباقي). يُحفظ المخطط
        تلقائياً.
      </p>
    </div>
  )
}
