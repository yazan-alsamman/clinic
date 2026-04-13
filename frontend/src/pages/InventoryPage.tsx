import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type Item = {
  id: string
  sku: string
  name: string
  active: boolean
  department: 'laser' | 'dermatology' | 'dental' | 'skin' | 'solarium'
  unit: string
  quantity: number
  safetyStockLevel: number
  unitCost: number
  lowStock: boolean
}

const emptyCreate = {
  name: '',
  unit: 'وحدة',
  quantity: '0',
  safetyStockLevel: '5',
  unitCost: '0',
  department: 'dermatology' as Item['department'],
}

const DEPARTMENT_OPTIONS: Array<{ value: Item['department']; label: string }> = [
  { value: 'laser', label: 'ليزر' },
  { value: 'dermatology', label: 'جلدية' },
  { value: 'dental', label: 'أسنان' },
  { value: 'skin', label: 'بشرة' },
  { value: 'solarium', label: 'سولاريوم' },
]

export function InventoryPage() {
  const { user } = useAuth()
  const { usdSypRate } = useClinic()
  const canRead = user?.role === 'super_admin' || user?.role === 'reception'
  const canCreate = user?.role === 'super_admin'
  const canEdit = user?.role === 'super_admin'

  const [rows, setRows] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [createUnitCostSyp, setCreateUnitCostSyp] = useState('')
  const [editItem, setEditItem] = useState<Item | null>(null)
  const [editForm, setEditForm] = useState({
    sku: '',
    name: '',
    unit: '',
    quantity: '',
    safetyStockLevel: '',
    unitCost: '',
    active: true,
    department: 'dermatology' as Item['department'],
  })
  const [editUnitCostSyp, setEditUnitCostSyp] = useState('')
  const [formErr, setFormErr] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const data = await api<{ items: Item[] }>('/api/inventory/items')
      setRows(data.items)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => {
    void load()
  }, [load])

  function openEdit(r: Item) {
    setFormErr('')
    setEditItem(r)
    setEditForm({
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      quantity: String(r.quantity),
      safetyStockLevel: String(r.safetyStockLevel),
      unitCost: String(r.unitCost),
      active: r.active !== false,
      department: r.department,
    })
    setEditUnitCostSyp(
      usdSypRate && usdSypRate > 0 ? String(Math.round((r.unitCost || 0) * usdSypRate)) : '',
    )
  }

  if (!canRead) {
    return (
      <>
        <h1 className="page-title">المستودع</h1>
        <p className="page-desc">لا تملك صلاحية عرض المستودع.</p>
      </>
    )
  }

  const isAdmin = user?.role === 'super_admin'

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.5rem',
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
            المستودع
          </h1>
          <p className="page-desc" style={{ margin: 0 }}>
            {isAdmin
              ? 'خصومات تلقائية مع الإجراءات — تنبيهات الحد الأدنى'
              : 'عرض المواد والكميات — التعديل للمدير فقط'}
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFormErr('')
              setCreateForm(emptyCreate)
              setCreateUnitCostSyp('')
              setCreateOpen(true)
            }}
          >
            مادة جديدة
          </button>
        ) : null}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>المادة</th>
              <th>الوحدة</th>
              <th>القسم</th>
              <th>الكمية</th>
              <th>حد الأمان</th>
              <th>الحالة</th>
              {canEdit ? <th>إجراءات</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6}>جاري التحميل…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} style={{ color: 'var(--text-muted)' }}>
                  لا توجد مواد في المستودع
                  {canCreate ? ' — استخدم «مادة جديدة» أو شغّل seed' : ''}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', direction: 'ltr' }}>
                      {r.sku}
                    </div>
                  </td>
                  <td>{r.unit}</td>
                  <td>{DEPARTMENT_OPTIONS.find((d) => d.value === r.department)?.label ?? r.department}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.quantity}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.safetyStockLevel}</td>
                  <td>
                    {!r.active ? (
                      <span className="chip" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>
                        معطّلة
                      </span>
                    ) : r.lowStock ? (
                      <span
                        className="chip"
                        style={{ background: 'var(--warning-dim)', color: 'var(--amber)' }}
                      >
                        قرب النفاد
                      </span>
                    ) : (
                      <span
                        className="chip"
                        style={{ background: 'var(--success-dim)', color: 'var(--success)' }}
                      >
                        طبيعي
                      </span>
                    )}
                  </td>
                  {canEdit ? (
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem' }}
                        onClick={() => openEdit(r)}
                      >
                        تعديل
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {createOpen && canCreate && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal" style={{ maxWidth: 440 }}>
            <h3 style={{ marginTop: 0 }}>مادة جديدة</h3>
            <div style={{ display: 'grid', gap: '0.65rem', marginTop: '1rem' }}>
              <div>
                <label className="form-label" htmlFor="inv-sku-auto">
                  رمز SKU
                </label>
                <input
                  id="inv-sku-auto"
                  className="input"
                  value="يُولَّد تلقائياً عند الحفظ"
                  readOnly
                />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-name">
                  اسم المادة <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  id="inv-name"
                  className="input"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-unit">
                  الوحدة
                </label>
                <input
                  id="inv-unit"
                  className="input"
                  value={createForm.unit}
                  onChange={(e) => setCreateForm((f) => ({ ...f, unit: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-department">
                  القسم
                </label>
                <select
                  id="inv-department"
                  className="input"
                  value={createForm.department}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, department: e.target.value as Item['department'] }))
                  }
                >
                  {DEPARTMENT_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid-2" style={{ gap: '0.65rem' }}>
                <div>
                  <label className="form-label" htmlFor="inv-qty">
                    الكمية
                  </label>
                  <input
                    id="inv-qty"
                    className="input"
                    inputMode="numeric"
                    value={createForm.quantity}
                    onChange={(e) => setCreateForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="inv-safe">
                    حد الأمان
                  </label>
                  <input
                    id="inv-safe"
                    className="input"
                    inputMode="numeric"
                    value={createForm.safetyStockLevel}
                    onChange={(e) => setCreateForm((f) => ({ ...f, safetyStockLevel: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="inv-cost">
                  تكلفة الوحدة (USD) (اختياري)
                </label>
                <input
                  id="inv-cost"
                  className="input"
                  inputMode="decimal"
                  value={createForm.unitCost}
                  onChange={(e) => setCreateForm((f) => ({ ...f, unitCost: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-cost-syp">
                  تكلفة الوحدة (SYP) (اختياري)
                </label>
                <input
                  id="inv-cost-syp"
                  className="input"
                  inputMode="decimal"
                  value={createUnitCostSyp}
                  onChange={(e) => setCreateUnitCostSyp(e.target.value)}
                />
              </div>
              {formErr ? (
                <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{formErr}</p>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setCreateOpen(false)}>
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  setFormErr('')
                  if (!createForm.name.trim()) {
                    setFormErr('اسم المادة مطلوب')
                    return
                  }
                  setSaving(true)
                  try {
                    await api('/api/inventory/items', {
                      method: 'POST',
                      body: JSON.stringify({
                        name: createForm.name.trim(),
                        unit: createForm.unit.trim(),
                        department: createForm.department,
                        quantity: Number(createForm.quantity) || 0,
                        safetyStockLevel: Number(createForm.safetyStockLevel) || 0,
                        unitCost: Number(createForm.unitCost) || undefined,
                        unitCostSyp: Number(createUnitCostSyp) || undefined,
                      }),
                    })
                    setCreateOpen(false)
                    setCreateForm(emptyCreate)
                    setCreateUnitCostSyp('')
                    await load()
                  } catch (e) {
                    setFormErr(e instanceof ApiError ? e.message : 'فشل الحفظ')
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'جاري الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editItem && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal" style={{ maxWidth: 440 }}>
            <h3 style={{ marginTop: 0 }}>تعديل مادة</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{editItem.name}</p>
            <div style={{ display: 'grid', gap: '0.65rem', marginTop: '0.75rem' }}>
              {isAdmin ? (
                <>
                  <div>
                    <label className="form-label" htmlFor="ed-sku">
                      SKU
                    </label>
                    <input
                      id="ed-sku"
                      className="input"
                      dir="ltr"
                      value={editForm.sku}
                      onChange={(e) => setEditForm((f) => ({ ...f, sku: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ed-name">
                      الاسم
                    </label>
                    <input
                      id="ed-name"
                      className="input"
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ed-unit">
                      الوحدة
                    </label>
                    <input
                      id="ed-unit"
                      className="input"
                      value={editForm.unit}
                      onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ed-department">
                      القسم
                    </label>
                    <select
                      id="ed-department"
                      className="input"
                      value={editForm.department}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, department: e.target.value as Item['department'] }))
                      }
                    >
                      {DEPARTMENT_OPTIONS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editForm.active}
                      onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                    />
                    <span style={{ fontSize: '0.9rem' }}>المادة فعّالة للاستخدام السريري</span>
                  </label>
                </>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                  يمكنك تعديل الكمية وحد الأمان فقط. للتعديل الكامل تواصل مع المدير.
                </p>
              )}
              <div className="grid-2" style={{ gap: '0.65rem' }}>
                <div>
                  <label className="form-label" htmlFor="ed-qty">
                    الكمية
                  </label>
                  <input
                    id="ed-qty"
                    className="input"
                    inputMode="numeric"
                    value={editForm.quantity}
                    onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="ed-safe">
                    حد الأمان
                  </label>
                  <input
                    id="ed-safe"
                    className="input"
                    inputMode="numeric"
                    value={editForm.safetyStockLevel}
                    onChange={(e) => setEditForm((f) => ({ ...f, safetyStockLevel: e.target.value }))}
                  />
                </div>
              </div>
              {isAdmin ? (
                <div>
                  <label className="form-label" htmlFor="ed-cost">
                    تكلفة الوحدة (USD)
                  </label>
                  <input
                    id="ed-cost"
                    className="input"
                    inputMode="decimal"
                    value={editForm.unitCost}
                    onChange={(e) => setEditForm((f) => ({ ...f, unitCost: e.target.value }))}
                  />
                </div>
              ) : null}
              {isAdmin ? (
                <div>
                  <label className="form-label" htmlFor="ed-cost-syp">
                    تكلفة الوحدة (SYP)
                  </label>
                  <input
                    id="ed-cost-syp"
                    className="input"
                    inputMode="decimal"
                    value={editUnitCostSyp}
                    onChange={(e) => setEditUnitCostSyp(e.target.value)}
                  />
                </div>
              ) : null}
              {formErr ? (
                <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{formErr}</p>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => setEditItem(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  if (!editItem) return
                  setFormErr('')
                  if (isAdmin) {
                    if (!editForm.sku.trim() || !editForm.name.trim()) {
                      setFormErr('SKU والاسم مطلوبان')
                      return
                    }
                  }
                  setSaving(true)
                  try {
                    const body: Record<string, unknown> = {
                      quantity: Number(editForm.quantity) || 0,
                      safetyStockLevel: Number(editForm.safetyStockLevel) || 0,
                    }
                    if (isAdmin) {
                      body.sku = editForm.sku.trim()
                      body.name = editForm.name.trim()
                      body.unit = editForm.unit.trim()
                      body.department = editForm.department
                      body.unitCost = Number(editForm.unitCost) || undefined
                      body.unitCostSyp = Number(editUnitCostSyp) || undefined
                      body.active = editForm.active
                    }
                    await api(`/api/inventory/items/${editItem.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify(body),
                    })
                    setEditItem(null)
                    await load()
                  } catch (e) {
                    setFormErr(e instanceof ApiError ? e.message : 'فشل الحفظ')
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'جاري الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
