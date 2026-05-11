import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
type Item = {
  id: string
  sku: string
  name: string
  active: boolean
  department: 'laser' | 'dermatology' | 'dermatology_private' | 'dental' | 'skin' | 'solarium'
  unit: string
  quantity: number
  safetyStockLevel: number
  unitCost: number
  unitCostUsd: number
  lowStock: boolean
}

const emptyCreate = {
  name: '',
  unit: 'وحدة',
  quantity: '0',
  safetyStockLevel: '5',
  unitCost: '0',
  unitCostUsd: '0',
  department: 'dermatology_private' as Item['department'],
}

const DEPARTMENT_OPTIONS: Array<{ value: Item['department']; label: string }> = [
  { value: 'laser', label: 'ليزر' },
  { value: 'dermatology', label: 'جلدية' },
  { value: 'dermatology_private', label: 'مستودع جلدية' },
  { value: 'dental', label: 'أسنان' },
  { value: 'skin', label: 'بشرة' },
  { value: 'solarium', label: 'سولاريوم' },
]

export function InventoryPage() {
  const { user } = useAuth()
  const isDermWarehouseManager = user?.role === 'dermatology_manager'
  const isDermWarehouseAssistant = user?.role === 'dermatology_assistant_manager'
  const isDermWarehouseStaff = isDermWarehouseManager || isDermWarehouseAssistant
  const isSkinWarehouseSpecialist = user?.role === 'skin_specialist'
  const canRead = user?.role === 'super_admin' || isDermWarehouseStaff || isSkinWarehouseSpecialist
  const canCreate = user?.role === 'super_admin' || isDermWarehouseStaff || isSkinWarehouseSpecialist
  const canEdit = user?.role === 'super_admin' || isDermWarehouseStaff || isSkinWarehouseSpecialist

  const [rows, setRows] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [editItem, setEditItem] = useState<Item | null>(null)
  const [editForm, setEditForm] = useState({
    sku: '',
    name: '',
    unit: '',
    quantity: '',
    safetyStockLevel: '',
    unitCost: '',
    unitCostUsd: '',
    active: true,
    department: 'dermatology_private' as Item['department'],
  })
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
      unitCostUsd: String(r.unitCostUsd ?? ''),
      active: r.active !== false,
      department: r.department,
    })
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
  const departmentOptions = isAdmin
    ? DEPARTMENT_OPTIONS
    : isDermWarehouseStaff
      ? DEPARTMENT_OPTIONS.filter((d) => d.value === 'dermatology_private')
      : DEPARTMENT_OPTIONS.filter((d) => d.value === 'skin')

  const showDermDualPricingCreate =
    isDermWarehouseManager || (isAdmin && createForm.department === 'dermatology_private')
  const showDermDualPricingEdit = isAdmin && editForm.department === 'dermatology_private'
  const showDermManagerFullEdit =
    !isAdmin && isDermWarehouseManager && editItem?.department === 'dermatology_private'

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
              : isDermWarehouseStaff
                ? 'مستودع جلدية الخاص بالقسم — عرض وتعديل حسب الصلاحية'
                : 'مستودع البشرة الخاص بالقسم — عرض وتعديل حسب الصلاحية'}
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFormErr('')
              setCreateForm(emptyCreate)
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
              {isDermWarehouseStaff || isAdmin || isSkinWarehouseSpecialist ? <th>السعر</th> : null}
              {canEdit ? <th>إجراءات</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={(canEdit ? 1 : 0) + (isDermWarehouseStaff || isAdmin || isSkinWarehouseSpecialist ? 1 : 0) + 6}
                >
                  جاري التحميل…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    (canEdit ? 1 : 0) + (isDermWarehouseStaff || isAdmin || isSkinWarehouseSpecialist ? 1 : 0) + 6
                  }
                  style={{ color: 'var(--text-muted)' }}
                >
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
                  {isDermWarehouseStaff || isAdmin || isSkinWarehouseSpecialist ? (
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)', direction: 'ltr' }}>
                      {r.department === 'dermatology_private' ? (
                        <>
                          {(r.unitCost ?? 0) > 0 ? <div>{Number(r.unitCost).toLocaleString('ar-SY')} ل.س</div> : null}
                          {(r.unitCostUsd ?? 0) > 0 ? <div>{Number(r.unitCostUsd)} USD</div> : null}
                          {(r.unitCost ?? 0) <= 0 && (r.unitCostUsd ?? 0) <= 0 ? '—' : null}
                        </>
                      ) : (
                        <>{(r.unitCost ?? 0) > 0 ? `${Number(r.unitCost).toLocaleString('ar-SY')} ل.س` : '—'}</>
                      )}
                    </td>
                  ) : null}
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
                  {departmentOptions.map((d) => (
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
              {isSkinWarehouseSpecialist ? (
                <div>
                  <label className="form-label" htmlFor="inv-cost">
                    تكلفة الوحدة (ل.س) (اختياري)
                  </label>
                  <input
                    id="inv-cost"
                    className="input"
                    inputMode="decimal"
                    value={createForm.unitCost}
                    onChange={(e) => setCreateForm((f) => ({ ...f, unitCost: e.target.value }))}
                  />
                </div>
              ) : null}
              {showDermDualPricingCreate ? (
                <>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    سعر الوحدة: أدخل بالليرة أو بالدولار — يكفي أحد العملتين. عند التسعير بالدولار فقط تُحسب
                    التكلفة بليرة حسب سعر صرف يوم العمل عند استهلاك المادة في الجلسة.
                  </p>
                  <div className="grid-2" style={{ gap: '0.65rem' }}>
                    <div>
                      <label className="form-label" htmlFor="inv-cost-syp">
                        تكلفة الوحدة (ل.س)
                      </label>
                      <input
                        id="inv-cost-syp"
                        className="input"
                        inputMode="decimal"
                        value={createForm.unitCost}
                        onChange={(e) => setCreateForm((f) => ({ ...f, unitCost: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="inv-cost-usd">
                        تكلفة الوحدة (USD)
                      </label>
                      <input
                        id="inv-cost-usd"
                        className="input"
                        inputMode="decimal"
                        dir="ltr"
                        value={createForm.unitCostUsd}
                        onChange={(e) => setCreateForm((f) => ({ ...f, unitCostUsd: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
              ) : isDermWarehouseAssistant ? (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  تعريف سعر المادة (ل.س أو دولار) يتم من قبل مدير قسم الجلدية فقط.
                </p>
              ) : isAdmin && !showDermDualPricingCreate ? (
                <div>
                  <label className="form-label" htmlFor="inv-cost">
                    تكلفة الوحدة (ل.س) (اختياري)
                  </label>
                  <input
                    id="inv-cost"
                    className="input"
                    inputMode="decimal"
                    value={createForm.unitCost}
                    onChange={(e) => setCreateForm((f) => ({ ...f, unitCost: e.target.value }))}
                  />
                </div>
              ) : null}
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
                    const createPayload: Record<string, unknown> = {
                      name: createForm.name.trim(),
                      unit: createForm.unit.trim(),
                      department: isAdmin
                        ? createForm.department
                        : isDermWarehouseStaff
                          ? 'dermatology_private'
                          : 'skin',
                      quantity: Number(createForm.quantity) || 0,
                      safetyStockLevel: Number(createForm.safetyStockLevel) || 0,
                    }
                    if (showDermDualPricingCreate) {
                      createPayload.unitCost = Number(createForm.unitCost) || 0
                      createPayload.unitCostUsd = Number(createForm.unitCostUsd) || 0
                    } else if (isSkinWarehouseSpecialist || isAdmin) {
                      createPayload.unitCost = Number(createForm.unitCost) || undefined
                    }
                    await api('/api/inventory/items', {
                      method: 'POST',
                      body: JSON.stringify(createPayload),
                    })
                    setCreateOpen(false)
                    setCreateForm(emptyCreate)
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
                      {departmentOptions.map((d) => (
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
              ) : showDermManagerFullEdit ? (
                <>
                  <div>
                    <label className="form-label" htmlFor="ed-sku-dm">
                      SKU
                    </label>
                    <input
                      id="ed-sku-dm"
                      className="input"
                      dir="ltr"
                      value={editForm.sku}
                      onChange={(e) => setEditForm((f) => ({ ...f, sku: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ed-name-dm">
                      الاسم
                    </label>
                    <input
                      id="ed-name-dm"
                      className="input"
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="ed-unit-dm">
                      الوحدة
                    </label>
                    <input
                      id="ed-unit-dm"
                      className="input"
                      value={editForm.unit}
                      onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>القسم: مستودع جلدية</p>
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
                  يمكنك تعديل الكمية وحد الأمان فقط. التعديل الكامل للمادة والسعر من مدير قسم الجلدية.
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
              {showDermDualPricingEdit ? (
                <>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    السعر: ل.س أو USD — يكفي أحد العملتين.
                  </p>
                  <div className="grid-2" style={{ gap: '0.65rem' }}>
                    <div>
                      <label className="form-label" htmlFor="ed-cost">
                        تكلفة الوحدة (ل.س)
                      </label>
                      <input
                        id="ed-cost"
                        className="input"
                        inputMode="decimal"
                        value={editForm.unitCost}
                        onChange={(e) => setEditForm((f) => ({ ...f, unitCost: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="ed-cost-usd">
                        تكلفة الوحدة (USD)
                      </label>
                      <input
                        id="ed-cost-usd"
                        className="input"
                        inputMode="decimal"
                        dir="ltr"
                        value={editForm.unitCostUsd}
                        onChange={(e) => setEditForm((f) => ({ ...f, unitCostUsd: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
              ) : isAdmin ? (
                <div>
                  <label className="form-label" htmlFor="ed-cost">
                    تكلفة الوحدة (ل.س)
                  </label>
                  <input
                    id="ed-cost"
                    className="input"
                    inputMode="decimal"
                    value={editForm.unitCost}
                    onChange={(e) => setEditForm((f) => ({ ...f, unitCost: e.target.value }))}
                  />
                </div>
              ) : showDermManagerFullEdit ? (
                <>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    السعر: ل.س أو USD — يكفي أحد العملتين.
                  </p>
                  <div className="grid-2" style={{ gap: '0.65rem' }}>
                    <div>
                      <label className="form-label" htmlFor="ed-cost-dm">
                        تكلفة الوحدة (ل.س)
                      </label>
                      <input
                        id="ed-cost-dm"
                        className="input"
                        inputMode="decimal"
                        value={editForm.unitCost}
                        onChange={(e) => setEditForm((f) => ({ ...f, unitCost: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="ed-cost-usd-dm">
                        تكلفة الوحدة (USD)
                      </label>
                      <input
                        id="ed-cost-usd-dm"
                        className="input"
                        inputMode="decimal"
                        dir="ltr"
                        value={editForm.unitCostUsd}
                        onChange={(e) => setEditForm((f) => ({ ...f, unitCostUsd: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
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
                  if (isAdmin || showDermManagerFullEdit) {
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
                      body.active = editForm.active
                      if (editForm.department === 'dermatology_private') {
                        body.unitCostUsd = Number(editForm.unitCostUsd) || 0
                      } else {
                        body.unitCostUsd = 0
                      }
                    } else if (showDermManagerFullEdit) {
                      body.sku = editForm.sku.trim()
                      body.name = editForm.name.trim()
                      body.unit = editForm.unit.trim()
                      body.department = 'dermatology_private'
                      body.unitCost = Number(editForm.unitCost) || 0
                      body.unitCostUsd = Number(editForm.unitCostUsd) || 0
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
