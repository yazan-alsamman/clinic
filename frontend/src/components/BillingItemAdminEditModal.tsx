import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

type MaterialLine = {
  inventoryItemId?: string
  sku: string
  name: string
  unit: string
  quantity: number
  unitCostSyp: number
  lineCostSyp: number
  chargedUnitPriceSyp: number
  lineChargeSyp: number
}

type LaserLine = {
  procedureOptionId: string
  areaLabel: string
  pw: string
  pulse: string
  shotCount: string
  chargeByPulseCount: boolean
  isAddon: boolean
  lineCostSyp: number
}

type AdminDetail = {
  billingItem: {
    id: string
    patientId: string
    patientName: string
    fileNumber: string
    department: string
    procedureLabel: string
    listAmountDueSyp: number
    discountPercent: number
    effectiveAmountDueSyp: number
    amountDueSyp: number
    businessDate: string
    status: string
    isPackagePrepaid: boolean
  }
  clinicalSession: {
    id: string
    procedureDescription: string
    sessionFeeSyp: number
    businessDate: string
    notes: string
    materialCostSypTotal: number
    materialChargeSypTotal: number
    materials: MaterialLine[]
    providerName: string
    isPackageSession: boolean
  } | null
  laserSession: {
    id: string
    laserType: string
    pw: string
    pulse: string
    shotCount: string
    chargeByPulseCount: boolean
    notes: string
    room: string
    discountPercent: number
    costSyp: number
    laserCoverApplied: boolean
    lineItems: LaserLine[]
    operatorName: string
    treatmentNumber: number
  } | null
}

const deptLabel: Record<string, string> = {
  laser: 'ليزر',
  dermatology: 'جلدية',
  dental: 'أسنان',
  solarium: 'سولاريوم',
  skin: 'بشرة',
}

function emptyLaserLine(): LaserLine {
  return {
    procedureOptionId: '',
    areaLabel: '',
    pw: '',
    pulse: '',
    shotCount: '',
    chargeByPulseCount: false,
    isAddon: false,
    lineCostSyp: 0,
  }
}

function emptyMaterial(): MaterialLine {
  return {
    sku: '',
    name: '',
    unit: 'وحدة',
    quantity: 1,
    unitCostSyp: 0,
    lineCostSyp: 0,
    chargedUnitPriceSyp: 0,
    lineChargeSyp: 0,
  }
}

export type BillingItemAdminEditModalProps = {
  billingItemId: string
  onClose: () => void
  onSaved: () => void
}

export function BillingItemAdminEditModal({ billingItemId, onClose, onSaved }: BillingItemAdminEditModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<AdminDetail | null>(null)

  const [procedureLabel, setProcedureLabel] = useState('')
  const [listAmountDueSyp, setListAmountDueSyp] = useState('')
  const [discountPercent, setDiscountPercent] = useState('')
  const [businessDate, setBusinessDate] = useState('')

  const [procedureDescription, setProcedureDescription] = useState('')
  const [sessionFeeSyp, setSessionFeeSyp] = useState('')
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [materials, setMaterials] = useState<MaterialLine[]>([])

  const [laserType, setLaserType] = useState('Mix')
  const [laserRoom, setLaserRoom] = useState('1')
  const [laserNotes, setLaserNotes] = useState('')
  const [laserPw, setLaserPw] = useState('')
  const [laserPulse, setLaserPulse] = useState('')
  const [laserShotCount, setLaserShotCount] = useState('')
  const [laserChargeByPulse, setLaserChargeByPulse] = useState(false)
  const [laserCostSyp, setLaserCostSyp] = useState('')
  const [laserDiscountPercent, setLaserDiscountPercent] = useState('')
  const [laserCoverApplied, setLaserCoverApplied] = useState(false)
  const [lineItems, setLineItems] = useState<LaserLine[]>([])

  const applyDetail = useCallback((d: AdminDetail) => {
    setDetail(d)
    const b = d.billingItem
    setProcedureLabel(b.procedureLabel)
    setListAmountDueSyp(String(b.listAmountDueSyp || 0))
    setDiscountPercent(String(b.discountPercent || 0))
    setBusinessDate(b.businessDate || '')
    const cs = d.clinicalSession
    if (cs) {
      setProcedureDescription(cs.procedureDescription)
      setSessionFeeSyp(String(cs.sessionFeeSyp || 0))
      setClinicalNotes(cs.notes)
      setMaterials(cs.materials?.length ? cs.materials.map((m) => ({ ...m })) : [])
    }
    const ls = d.laserSession
    if (ls) {
      setLaserType(ls.laserType || 'Mix')
      setLaserRoom(ls.room || '1')
      setLaserNotes(ls.notes)
      setLaserPw(ls.pw)
      setLaserPulse(ls.pulse)
      setLaserShotCount(ls.shotCount)
      setLaserChargeByPulse(ls.chargeByPulseCount)
      setLaserCostSyp(String(ls.costSyp || 0))
      setLaserDiscountPercent(String(ls.discountPercent || 0))
      setLaserCoverApplied(ls.laserCoverApplied)
      setLineItems(ls.lineItems?.length ? ls.lineItems.map((x) => ({ ...x })) : [emptyLaserLine()])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr('')
      try {
        const data = await api<AdminDetail>(`/api/billing/${encodeURIComponent(billingItemId)}/admin-detail`)
        if (!cancelled) applyDetail(data)
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : 'تعذر تحميل البند')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [billingItemId, applyDetail])

  async function save() {
    setErr('')
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        billing: {
          procedureLabel: procedureLabel.trim(),
          listAmountDueSyp: Math.round(parseFloat(listAmountDueSyp) || 0),
          discountPercent: parseFloat(discountPercent) || 0,
          businessDate: businessDate.trim(),
        },
      }
      if (detail?.clinicalSession) {
        body.clinical = {
          procedureDescription: procedureDescription.trim(),
          sessionFeeSyp: Math.round(parseFloat(sessionFeeSyp) || 0),
          notes: clinicalNotes.trim(),
          materials,
        }
      }
      if (detail?.laserSession) {
        body.laser = {
          laserType,
          room: laserRoom,
          notes: laserNotes.trim(),
          pw: laserPw,
          pulse: laserPulse,
          shotCount: laserShotCount,
          chargeByPulseCount: laserChargeByPulse,
          costSyp: Math.round(parseFloat(laserCostSyp) || 0),
          discountPercent: parseFloat(laserDiscountPercent) || 0,
          laserCoverApplied,
          lineItems,
        }
      }
      await api(`/api/billing/${encodeURIComponent(billingItemId)}/admin-full-edit`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      onSaved()
      onClose()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حفظ التعديلات')
    } finally {
      setSaving(false)
    }
  }

  const dept = detail?.billingItem.department || ''

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!saving) onClose()
      }}
    >
      <div
        className="modal"
        style={{ maxWidth: 920, maxHeight: '92vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="card-title" style={{ marginTop: 0 }}>
          تعديل بند التحصيل (مدير النظام)
        </h3>
        {detail ? (
          <p style={{ marginTop: '-0.2rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            {detail.billingItem.patientName}
            {detail.billingItem.fileNumber ? ` — ${detail.billingItem.fileNumber}` : ''} —{' '}
            {deptLabel[dept] ?? dept}
            {detail.billingItem.isPackagePrepaid ? ' — باكج' : ''}
          </p>
        ) : null}

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
        ) : (
          <>
            <section style={{ marginTop: '1rem' }}>
              <h4 className="form-label" style={{ fontWeight: 700 }}>
                الفوترة والتحصيل
              </h4>
              <div className="grid-2" style={{ marginTop: '0.5rem' }}>
                <div>
                  <label className="form-label">وصف البند (يظهر في التحصيل)</label>
                  <input className="input" value={procedureLabel} onChange={(e) => setProcedureLabel(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">تاريخ العمل</label>
                  <input
                    className="input"
                    type="date"
                    dir="ltr"
                    value={businessDate}
                    onChange={(e) => setBusinessDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">المبلغ المستحق (قبل الخصم) ل.س</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={listAmountDueSyp}
                    onChange={(e) => setListAmountDueSyp(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">نسبة الخصم %</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                  />
                </div>
              </div>
            </section>

            {detail?.clinicalSession ? (
              <section style={{ marginTop: '1.25rem' }}>
                <h4 className="form-label" style={{ fontWeight: 700 }}>
                  الجلسة السريرية
                  {detail.clinicalSession.providerName ? (
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginRight: '0.35rem' }}>
                      — {detail.clinicalSession.providerName}
                    </span>
                  ) : null}
                </h4>
                <div className="grid-2" style={{ marginTop: '0.5rem' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">نوع الإجراء / الوصف</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={procedureDescription}
                      onChange={(e) => setProcedureDescription(e.target.value)}
                    />
                  </div>
                  {dept !== 'laser' ? (
                    <div>
                      <label className="form-label">رسوم الجلسة (ل.س)</label>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={sessionFeeSyp}
                        onChange={(e) => setSessionFeeSyp(e.target.value)}
                      />
                    </div>
                  ) : null}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">ملاحظات</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={clinicalNotes}
                      onChange={(e) => setClinicalNotes(e.target.value)}
                    />
                  </div>
                </div>

                {(dept === 'dermatology' || dept === 'dental' || materials.length > 0) ? (
                  <div style={{ marginTop: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="form-label" style={{ margin: 0 }}>
                        المواد المستخدمة
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => setMaterials((prev) => [...prev, emptyMaterial()])}
                      >
                        + مادة
                      </button>
                    </div>
                    <div style={{ display: 'grid', gap: '0.55rem', marginTop: '0.45rem' }}>
                      {materials.map((m, idx) => (
                        <div
                          key={idx}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '0.55rem',
                            display: 'grid',
                            gap: '0.35rem',
                          }}
                        >
                          <div className="grid-2">
                            <input
                              className="input"
                              placeholder="اسم المادة"
                              value={m.name}
                              onChange={(e) =>
                                setMaterials((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                                )
                              }
                            />
                            <input
                              className="input"
                              placeholder="SKU"
                              value={m.sku}
                              onChange={(e) =>
                                setMaterials((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, sku: e.target.value } : x)),
                                )
                              }
                            />
                          </div>
                          <div className="grid-2">
                            <input
                              className="input"
                              inputMode="decimal"
                              placeholder="الكمية"
                              value={String(m.quantity)}
                              onChange={(e) =>
                                setMaterials((prev) =>
                                  prev.map((x, i) =>
                                    i === idx ? { ...x, quantity: Math.max(0, Number(e.target.value) || 0) } : x,
                                  ),
                                )
                              }
                            />
                            <input
                              className="input"
                              inputMode="decimal"
                              placeholder="تكلفة السطر ل.س"
                              value={String(m.lineCostSyp)}
                              onChange={(e) =>
                                setMaterials((prev) =>
                                  prev.map((x, i) =>
                                    i === idx
                                      ? { ...x, lineCostSyp: Math.round(Number(e.target.value) || 0) }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="grid-2">
                            <input
                              className="input"
                              inputMode="decimal"
                              placeholder="سعر الوحدة للمريض ل.س"
                              value={String(m.chargedUnitPriceSyp)}
                              onChange={(e) =>
                                setMaterials((prev) =>
                                  prev.map((x, i) =>
                                    i === idx
                                      ? {
                                          ...x,
                                          chargedUnitPriceSyp: Math.round(Number(e.target.value) || 0),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <input
                              className="input"
                              inputMode="decimal"
                              placeholder="مبلغ التحصيل للسطر ل.س"
                              value={String(m.lineChargeSyp)}
                              onChange={(e) =>
                                setMaterials((prev) =>
                                  prev.map((x, i) =>
                                    i === idx
                                      ? { ...x, lineChargeSyp: Math.round(Number(e.target.value) || 0) }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: '0.75rem', color: 'var(--danger)', justifySelf: 'start' }}
                            onClick={() => setMaterials((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            حذف السطر
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {detail?.laserSession ? (
              <section style={{ marginTop: '1.25rem' }}>
                <h4 className="form-label" style={{ fontWeight: 700 }}>
                  جلسة الليزر #{detail.laserSession.treatmentNumber} — {detail.laserSession.operatorName || '—'}
                </h4>
                <div className="grid-2" style={{ marginTop: '0.5rem' }}>
                  <div>
                    <label className="form-label">نوع الليزر</label>
                    <select className="select" value={laserType} onChange={(e) => setLaserType(e.target.value)}>
                      <option value="Mix">Mix</option>
                      <option value="Yag">Yag</option>
                      <option value="Alex">Alex</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">الغرفة</label>
                    <select className="select" value={laserRoom} onChange={(e) => setLaserRoom(e.target.value)}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">إجمالي التكلفة (ل.س)</label>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={laserCostSyp}
                      onChange={(e) => setLaserCostSyp(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">خصم الليزر %</label>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={laserDiscountPercent}
                      onChange={(e) => setLaserDiscountPercent(e.target.value)}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input
                      type="checkbox"
                      checked={laserCoverApplied}
                      onChange={(e) => setLaserCoverApplied(e.target.checked)}
                    />
                    كفر ليزر مُطبَّق
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input
                      type="checkbox"
                      checked={laserChargeByPulse}
                      onChange={(e) => setLaserChargeByPulse(e.target.checked)}
                    />
                    محاسبة على عدد الضربات (للجلسة كاملة)
                  </label>
                </div>
                <div style={{ marginTop: '0.65rem' }}>
                  <label className="form-label">ملاحظات الليزر</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={laserNotes}
                    onChange={(e) => setLaserNotes(e.target.value)}
                  />
                </div>

                <div style={{ marginTop: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="form-label" style={{ margin: 0 }}>
                      أسطر المناطق (P.W / Pulse / Shots)
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.78rem' }}
                      onClick={() => setLineItems((prev) => [...prev, emptyLaserLine()])}
                    >
                      + سطر
                    </button>
                  </div>
                  <div className="table-wrap" style={{ marginTop: '0.45rem' }}>
                    <table className="data-table" style={{ fontSize: '0.82rem' }}>
                      <thead>
                        <tr>
                          <th>المنطقة</th>
                          <th>P.W</th>
                          <th>Pulse</th>
                          <th>Shots</th>
                          <th>ضربات؟</th>
                          <th>ل.س</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map((row, idx) => (
                          <tr key={idx}>
                            <td>
                              <input
                                className="input"
                                style={{ minWidth: 100 }}
                                value={row.areaLabel}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((x, i) => (i === idx ? { ...x, areaLabel: e.target.value } : x)),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="input"
                                value={row.pw}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((x, i) => (i === idx ? { ...x, pw: e.target.value } : x)),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="input"
                                value={row.pulse}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((x, i) => (i === idx ? { ...x, pulse: e.target.value } : x)),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="input"
                                value={row.shotCount}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((x, i) => (i === idx ? { ...x, shotCount: e.target.value } : x)),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={row.chargeByPulseCount}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, chargeByPulseCount: e.target.checked } : x,
                                    ),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="input"
                                inputMode="decimal"
                                style={{ maxWidth: 90 }}
                                value={String(row.lineCostSyp)}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((x, i) =>
                                      i === idx
                                        ? { ...x, lineCostSyp: Math.round(Number(e.target.value) || 0) }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem' }}
                                onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
                              >
                                حذف
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {err ? <p style={{ color: 'var(--danger)', marginTop: '0.85rem' }}>{err}</p> : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.1rem' }}>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
                إلغاء
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'جاري الحفظ…' : 'حفظ التعديلات'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
