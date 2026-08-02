import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { ChartMarkCategory, DentalChartMarkOption, SurfaceMarkShape } from '../components/dental/dentalChartTypes'

const SHAPE_OPTIONS: { id: SurfaceMarkShape; label: string }[] = [
  { id: 'fill', label: 'تعبئة' },
  { id: 'outline', label: 'إطار' },
  { id: 'cross', label: 'تقاطع' },
  { id: 'stripe', label: 'خطوط' },
  { id: 'dot', label: 'نقطة' },
]

const CATEGORY_OPTIONS: { id: ChartMarkCategory; label: string }[] = [
  { id: 'baseline', label: 'حالة الدخول فقط' },
  { id: 'clinic', label: 'عمل العيادة فقط' },
  { id: 'both', label: 'الاثنان' },
]

export function AdminDentalChartMarksPage() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'
  const [rows, setRows] = useState<DentalChartMarkOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#0d9488')
  const [newShape, setNewShape] = useState<SurfaceMarkShape>('fill')
  const [newCategory, setNewCategory] = useState<ChartMarkCategory>('both')

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const data = await api<{ options: DentalChartMarkOption[] }>('/api/dental/chart-mark-options/admin')
      setRows(data.options || [])
    } catch (e) {
      setRows([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل علامات المخطط')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">علامات مخطط الأسنان</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">علامات مخطط الأسنان</h1>
      <p className="page-desc">
        أضف إجراءات/علامات تظهر كأدوات على المخطط: الاسم، اللون، والشكل (تعبئة، إطار، تقاطع…). تظهر تلقائياً
        لأطباء الأسنان.
      </p>
      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>إضافة علامة جديدة</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">الاسم</label>
            <input
              className="input"
              placeholder="مثال: تاج خزفي"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">اللون</label>
            <input
              className="input"
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              style={{ width: 56, padding: 2, height: 38 }}
            />
          </div>
          <div>
            <label className="form-label">الشكل</label>
            <select className="input" value={newShape} onChange={(e) => setNewShape(e.target.value as SurfaceMarkShape)}>
              {SHAPE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">الظهور في</label>
            <select
              className="input"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as ChartMarkCategory)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving === 'new'}
            onClick={async () => {
              setSaving('new')
              setErr('')
              try {
                await api('/api/dental/chart-mark-options', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: newName.trim(),
                    color: newColor,
                    shape: newShape,
                    category: newCategory,
                  }),
                })
                setNewName('')
                setNewColor('#0d9488')
                setNewShape('fill')
                setNewCategory('both')
                await load()
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : 'فشل الإضافة')
              } finally {
                setSaving('')
              }
            }}
          >
            {saving === 'new' ? 'جاري الحفظ…' : 'إضافة'}
          </button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>معاينة</th>
                  <th>الاسم</th>
                  <th>اللون</th>
                  <th>الشكل</th>
                  <th>الظهور</th>
                  <th>الترتيب</th>
                  <th>الحالة</th>
                  <th>حفظ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 28,
                          height: 18,
                          borderRadius: 4,
                          background: r.shape === 'outline' ? 'transparent' : r.color,
                          border: `2px solid ${r.color}`,
                          boxShadow: r.shape === 'stripe' ? `inset 0 0 0 1px ${r.color}` : undefined,
                        }}
                        title={r.shape}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={r.name}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : '#0d9488'}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, color: e.target.value } : x)))
                        }
                        style={{ width: 48, padding: 2, height: 36 }}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={r.shape}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id ? { ...x, shape: e.target.value as SurfaceMarkShape } : x,
                            ),
                          )
                        }
                      >
                        {SHAPE_OPTIONS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="input"
                        value={r.category}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id ? { ...x, category: e.target.value as ChartMarkCategory } : x,
                            ),
                          )
                        }
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input"
                        inputMode="numeric"
                        dir="ltr"
                        value={String(r.sortOrder)}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id ? { ...x, sortOrder: Number(e.target.value) || 0 } : x,
                            ),
                          )
                        }
                        style={{ width: 72 }}
                      />
                    </td>
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                          type="checkbox"
                          checked={r.active}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, active: e.target.checked } : x)),
                            )
                          }
                        />
                        {r.active ? 'فعّال' : 'معطّل'}
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={saving === r.id}
                        onClick={async () => {
                          setSaving(r.id)
                          setErr('')
                          try {
                            await api(`/api/dental/chart-mark-options/${r.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                name: r.name,
                                color: r.color,
                                shape: r.shape,
                                category: r.category,
                                sortOrder: r.sortOrder,
                                active: r.active,
                              }),
                            })
                          } catch (e) {
                            setErr(e instanceof ApiError ? e.message : 'فشل الحفظ')
                          } finally {
                            setSaving('')
                          }
                        }}
                      >
                        حفظ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
