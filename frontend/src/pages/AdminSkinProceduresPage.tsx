import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

type SkinOption = {
  id: string
  name: string
  priceSyp: number
  active: boolean
  sortOrder: number
}

export function AdminSkinProceduresPage() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'
  const [rows, setRows] = useState<SkinOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState('')
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const data = await api<{ options: SkinOption[] }>('/api/skin/procedure-options/admin')
      setRows(data.options || [])
    } catch (e) {
      setRows([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الإجراءات')
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
        <h1 className="page-title">إجراءات البشرة</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">إجراءات البشرة</h1>
      <p className="page-desc">إضافة/تعديل إجراءات قسم البشرة وتحديد سعر كل إجراء.</p>
      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>إضافة إجراء جديد</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input className="input" placeholder="اسم الإجراء" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input
            className="input"
            inputMode="numeric"
            placeholder="السعر (ل.س)"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving === 'new'}
            onClick={async () => {
              setSaving('new')
              setErr('')
              try {
                await api('/api/skin/procedure-options', {
                  method: 'POST',
                  body: JSON.stringify({ name: newName.trim(), priceSyp: Number(newPrice) || 0 }),
                })
                setNewName('')
                setNewPrice('')
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
                  <th>الإجراء</th>
                  <th>السعر</th>
                  <th>الحالة</th>
                  <th>حفظ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
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
                        inputMode="numeric"
                        value={String(r.priceSyp)}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) => (x.id === r.id ? { ...x, priceSyp: Number(e.target.value) || 0 } : x)),
                          )
                        }
                      />
                    </td>
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                          type="checkbox"
                          checked={r.active}
                          onChange={(e) =>
                            setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: e.target.checked } : x)))
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
                            await api(`/api/skin/procedure-options/${r.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ name: r.name, priceSyp: r.priceSyp, active: r.active }),
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
