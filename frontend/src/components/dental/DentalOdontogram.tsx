import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, ApiError } from '../../api/client'
import { ToothCell } from './ToothSvg'
import { ToothTreatmentModal, type DentalLabOption, type DentalProviderOption } from './ToothTreatmentModal'
import {
  arabicToothName,
  chartTeethPayload,
  defaultTooth,
  isMarkTool,
  LOWER_ROW,
  markOptionIdFromTool,
  markToolId,
  teethMapFromChart,
  toothForViewLayer,
  toothStatusLabel,
  UPPER_ROW,
  type ChartPaintMode,
  type ChartTool,
  type ChartViewLayer,
  type DentalChartDto,
  type DentalChartMarkOption,
  type DentalLabWork,
  type DentalToothState,
  type DentalToothTreatment,
  type SurfaceOrigin,
  type SurfaceRegion,
  type SurfaceView,
} from './dentalChartTypes'

type Props = {
  patientId: string
  canEdit: boolean
}

const VIEW_LAYERS: { id: ChartViewLayer; label: string }[] = [
  { id: 'baseline', label: 'حالة الدخول' },
  { id: 'clinic', label: 'عمل العيادة' },
  { id: 'all', label: 'الكل' },
]

const PAINT_MODES: { id: ChartPaintMode; label: string }[] = [
  { id: 'baseline', label: 'تسجيل دخول' },
  { id: 'clinic', label: 'تسجيل عيادة' },
]

function optionMatchesPaintMode(opt: DentalChartMarkOption, mode: ChartPaintMode) {
  if (opt.category === 'both') return true
  return mode === 'baseline' ? opt.category === 'baseline' : opt.category === 'clinic'
}

export function DentalOdontogram({ patientId, canEdit }: Props) {
  const [teethMap, setTeethMap] = useState(() => teethMapFromChart([]))
  const [markOptions, setMarkOptions] = useState<DentalChartMarkOption[]>([])
  const [selectedFdi, setSelectedFdi] = useState<number | null>(null)
  const [panelFdi, setPanelFdi] = useState<number | null>(null)
  const [panelBaselineOnly, setPanelBaselineOnly] = useState(false)
  const [tool, setTool] = useState<ChartTool>('select')
  const [viewLayer, setViewLayer] = useState<ChartViewLayer>('all')
  const [paintMode, setPaintMode] = useState<ChartPaintMode>('baseline')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [dirty, setDirty] = useState(false)
  const [providers, setProviders] = useState<DentalProviderOption[]>([])
  const [labs, setLabs] = useState<DentalLabOption[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextAutosave = useRef(true)

  const originForPaint: SurfaceOrigin = paintMode === 'clinic' ? 'clinic' : 'preexisting'

  const tools = useMemo(() => {
    const marks = markOptions
      .filter((o) => o.active !== false && optionMatchesPaintMode(o, paintMode))
      .map((o) => ({
        id: markToolId(o.id),
        label: o.name,
        color: o.color,
      }))
    const base =
      paintMode === 'clinic'
        ? [
            { id: 'select' as ChartTool, label: 'تحديد / إجراء' },
            { id: 'healthy' as ChartTool, label: 'إزالة علامة عيادة' },
            { id: 'missing' as ChartTool, label: 'خلع (عيادة)' },
            { id: 'implant_teal' as ChartTool, label: 'زراعة (عيادة)' },
            { id: 'implant_red' as ChartTool, label: 'زراعة حمراء (عيادة)' },
          ]
        : [
            { id: 'select' as ChartTool, label: 'تحديد / إجراء' },
            { id: 'healthy' as ChartTool, label: 'سليم عند القدوم' },
            { id: 'missing' as ChartTool, label: 'مفقود عند القدوم' },
            { id: 'implant_teal' as ChartTool, label: 'زراعة سابقة' },
            { id: 'implant_red' as ChartTool, label: 'زراعة سابقة حمراء' },
          ]
    return [
      ...base,
      ...marks,
      {
        id: 'clear_surface' as ChartTool,
        label: paintMode === 'clinic' ? 'مسح علامة عيادة' : 'مسح علامة سابقة',
      },
    ]
  }, [markOptions, paintMode])

  const selected = selectedFdi != null ? teethMap.get(selectedFdi) : null
  const panelTooth = panelFdi != null ? teethMap.get(panelFdi) : null

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [data, providersRes, marksRes, labsRes] = await Promise.all([
        api<{ chart: DentalChartDto }>(`/api/dental/chart/${encodeURIComponent(patientId)}`),
        api<{ providers: DentalProviderOption[] }>('/api/dental/providers').catch(() => ({ providers: [] })),
        api<{ options: DentalChartMarkOption[] }>('/api/dental/chart-mark-options').catch(() => ({
          options: [],
        })),
        api<{ labs: DentalLabOption[] }>('/api/dental/labs').catch(() => ({ labs: [] })),
      ])
      skipNextAutosave.current = true
      setTeethMap(teethMapFromChart(data.chart?.teeth || []))
      setProviders(providersRes.providers || [])
      setMarkOptions(marksRes.options || [])
      setLabs(labsRes.labs || [])
      setDirty(false)
    } catch (e: unknown) {
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
      } catch (e: unknown) {
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
      setTeethMap((prev) => {
        const next = new Map(prev)
        const cur = next.get(fdi) || defaultTooth(fdi)
        next.set(fdi, updater(cur))
        return next
      })
      if (canEdit) {
        setDirty(true)
        setOk('')
      }
      setSelectedFdi(fdi)
    },
    [canEdit],
  )

  const openTreatmentPanel = useCallback((fdi: number, baseline = false) => {
    setSelectedFdi(fdi)
    setPanelBaselineOnly(baseline)
    setPanelFdi(fdi)
  }, [])

  const applyToolToTooth = useCallback(
    (fdi: number, view: SurfaceView, region?: SurfaceRegion) => {
      setSelectedFdi(fdi)

      if (tool === 'select' || !canEdit) {
        openTreatmentPanel(fdi, paintMode === 'baseline')
        return
      }

      // حالة الدخول: وصف فقط بدون تكلفة/دفعات
      const openPanel = true
      const asBaseline = paintMode === 'baseline'

      if (tool === 'healthy') {
        updateTooth(fdi, (prev) => {
          if (paintMode === 'clinic') {
            const keepBaselineStatus =
              prev.status !== 'present' && prev.statusOrigin === 'preexisting'
            return {
              ...prev,
              status: keepBaselineStatus ? prev.status : 'present',
              statusOrigin: 'preexisting',
              implantColor: keepBaselineStatus && prev.status === 'implant' ? prev.implantColor : null,
              surfaces: prev.surfaces.filter((s) => s.origin !== 'clinic'),
            }
          }
          return {
            ...prev,
            status: 'present',
            statusOrigin: 'preexisting',
            implantColor: null,
            surfaces: [],
            note: '',
          }
        })
        if (openPanel) openTreatmentPanel(fdi, asBaseline)
        return
      }
      if (tool === 'missing') {
        updateTooth(fdi, (prev) => ({
          ...prev,
          status: 'missing',
          statusOrigin: originForPaint,
          implantColor: null,
          surfaces: [],
        }))
        if (openPanel) openTreatmentPanel(fdi, asBaseline)
        return
      }
      if (tool === 'implant_teal') {
        updateTooth(fdi, (prev) => ({
          ...prev,
          status: 'implant',
          statusOrigin: originForPaint,
          implantColor: 'teal',
          surfaces: prev.surfaces,
        }))
        if (openPanel) openTreatmentPanel(fdi, asBaseline)
        return
      }
      if (tool === 'implant_red') {
        updateTooth(fdi, (prev) => ({
          ...prev,
          status: 'implant',
          statusOrigin: originForPaint,
          implantColor: 'red',
          surfaces: prev.surfaces,
        }))
        if (openPanel) openTreatmentPanel(fdi, asBaseline)
        return
      }
      if (isMarkTool(tool)) {
        const optId = markOptionIdFromTool(tool)
        const opt = markOptions.find((o) => o.id === optId)
        if (!opt) return
        const r = region || (view === 'occlusal' ? 'O' : 'I')
        updateTooth(fdi, (prev) => {
          const mark = {
            view,
            region: r,
            label: opt.name,
            origin: originForPaint,
            markOptionId: opt.id,
            color: opt.color,
            shape: opt.shape,
          }
          const surfaces = prev.surfaces.filter(
            (s) => !(s.view === view && s.region === r && s.origin === originForPaint),
          )
          surfaces.push(mark)
          if (prev.status === 'implant') {
            return { ...prev, surfaces }
          }
          return {
            ...prev,
            status: 'present' as const,
            statusOrigin: 'preexisting' as const,
            implantColor: null,
            surfaces,
          }
        })
        if (openPanel) openTreatmentPanel(fdi, asBaseline)
        return
      }
      if (tool === 'clear_surface') {
        const r = region
        updateTooth(fdi, (prev) => {
          if (!r) {
            return {
              ...prev,
              surfaces: prev.surfaces.filter((s) => s.origin !== originForPaint),
            }
          }
          return {
            ...prev,
            surfaces: prev.surfaces.filter(
              (s) => !(s.view === view && s.region === r && s.origin === originForPaint),
            ),
          }
        })
        if (openPanel) openTreatmentPanel(fdi, asBaseline)
      }
    },
    [canEdit, tool, updateTooth, openTreatmentPanel, paintMode, originForPaint, markOptions],
  )

  const saveTreatment = useCallback(
    async (payload: { treatments: DentalToothTreatment[]; labWorks: DentalLabWork[] }) => {
      if (panelFdi == null) return
      const fdi = panelFdi
      const { treatments, labWorks } = payload
      setTeethMap((prev) => {
        const next = new Map(prev)
        const cur = next.get(fdi)
        if (!cur) return prev
        next.set(fdi, { ...cur, treatments, labWorks })
        return next
      })
      setDirty(true)
      setPanelFdi(null)

      if (!canEdit) return
      setSaving(true)
      setErr('')
      try {
        const map = new Map(teethMap)
        const cur = map.get(fdi)
        if (cur) map.set(fdi, { ...cur, treatments, labWorks })
        const data = await api<{ chart: DentalChartDto }>(`/api/dental/chart/${encodeURIComponent(patientId)}`, {
          method: 'PUT',
          body: JSON.stringify({ teeth: chartTeethPayload(map) }),
        })
        skipNextAutosave.current = true
        setTeethMap(teethMapFromChart(data.chart?.teeth || []))
        setDirty(false)
        setOk('تم حفظ إجراءات السن والمخابر')
      } catch (e: unknown) {
        setErr(e instanceof ApiError ? e.message : 'تعذر حفظ الإجراء')
      } finally {
        setSaving(false)
      }
    },
    [panelFdi, canEdit, teethMap, patientId],
  )

  const tooltip = useMemo(() => {
    if (!selected || panelFdi != null) return null
    return {
      title: arabicToothName(selected.fdi),
      subtitle: toothStatusLabel(selected),
    }
  }, [selected, panelFdi])

  function renderArch(row: readonly number[], view: SurfaceView) {
    return (
      <div className="odontogram-arch-row" dir="ltr">
        {row.map((fdi) => {
          const full = teethMap.get(fdi)!
          const tooth = toothForViewLayer(full, viewLayer)
          return (
            <div key={`${view}-${fdi}`} className="odontogram-cell-wrap">
              <ToothCell
                fdi={fdi}
                tooth={tooth}
                view={view}
                selected={selectedFdi === fdi}
                showClinicBadge={viewLayer !== 'baseline'}
                onSelect={() => applyToolToTooth(fdi, view)}
                onSurfaceClick={
                  canEdit && (isMarkTool(tool) || tool === 'clear_surface')
                    ? (region) => applyToolToTooth(fdi, view, region)
                    : undefined
                }
              />
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
      <div className="odontogram-layers" role="tablist" aria-label="طبقة العرض">
        {VIEW_LAYERS.map((layer) => (
          <button
            key={layer.id}
            type="button"
            role="tab"
            aria-selected={viewLayer === layer.id}
            className={`odontogram-layer-btn${viewLayer === layer.id ? ' is-active' : ''}`}
            onClick={() => setViewLayer(layer.id)}
          >
            {layer.label}
          </button>
        ))}
      </div>

      {canEdit ? (
        <>
          <div className="odontogram-paint-modes" role="group" aria-label="وضع التسجيل">
            {PAINT_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`odontogram-paint-btn${paintMode === mode.id ? ' is-active' : ''}`}
                onClick={() => {
                  setPaintMode(mode.id)
                  setTool('select')
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="odontogram-toolbar">
            {tools.map((t) => {
              const color = 'color' in t && typeof t.color === 'string' ? t.color : undefined
              const style: CSSProperties = {
                fontSize: '0.78rem',
                padding: '0.35rem 0.65rem',
              }
              if (color && tool !== t.id) {
                style.borderColor = color
                style.boxShadow = `inset 0 -3px 0 ${color}`
              } else if (color && tool === t.id) {
                style.background = color
                style.borderColor = color
              }
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`btn ${tool === t.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={style}
                  onClick={() => setTool(t.id)}
                >
                  {t.label}
                </button>
              )
            })}
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
        </>
      ) : (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          عرض فقط — اضغط على أي سن لعرض الإجراء والدفعات.
        </p>
      )}

      <div className="odontogram-legend" aria-hidden>
        {markOptions.slice(0, 8).map((o) => (
          <span key={o.id} className="odontogram-legend-item">
            <i className="odontogram-swatch" style={{ background: o.color }} /> {o.name}
          </span>
        ))}
        <span className="odontogram-legend-item">
          <i className="odontogram-swatch badge" /> إجراء مسجّل
        </span>
      </div>

      {err ? (
        <p style={{ color: 'var(--danger)', margin: '0 0 0.5rem', fontSize: '0.88rem' }}>{err}</p>
      ) : null}
      {ok ? (
        <p style={{ color: 'var(--success)', margin: '0 0 0.5rem', fontSize: '0.88rem' }}>{ok}</p>
      ) : null}

      <div className="odontogram-scroll">
        <div className="odontogram-board" dir="ltr">
          {tooltip && selectedFdi != null ? (
            <div className="odontogram-tooltip" role="status">
              <strong>{tooltip.title}</strong>
              <span>{tooltip.subtitle}</span>
            </div>
          ) : null}

          <div className="odontogram-arch" dir="ltr">
            {renderArch(UPPER_ROW, 'buccal')}
            {renderArch(UPPER_ROW, 'occlusal')}
          </div>

          <div className="odontogram-midline" aria-hidden />

          <div className="odontogram-arch" dir="ltr">
            {renderArch(LOWER_ROW, 'occlusal')}
            {renderArch(LOWER_ROW, 'buccal')}
          </div>
        </div>
      </div>

      <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        في حالة الدخول يظهر وصف فقط. في عمل العيادة تُحفظ التكلفة وتُرسل تلقائياً لتحصيل الاستقبال.
      </p>

      {panelTooth ? (
        <ToothTreatmentModal
          key={`${panelTooth.fdi}-${panelBaselineOnly ? 'b' : 'c'}`}
          tooth={panelTooth}
          canEdit={canEdit}
          saving={saving}
          providers={providers}
          labs={labs}
          baselineOnly={panelBaselineOnly}
          onClose={() => setPanelFdi(null)}
          onSave={(payload) => void saveTreatment(payload)}
        />
      ) : null}
    </div>
  )
}
