import { useState } from 'react'
import {
  arabicToothName,
  emptyLabWork,
  emptyTreatment,
  labWorkHasData,
  normalizeLabWork,
  normalizeTreatment,
  treatmentHasData,
  treatmentPaidTotal,
  treatmentRemaining,
  type DentalLabWork,
  type DentalPayment,
  type DentalToothState,
  type DentalToothTreatment,
} from './dentalChartTypes'

type Props = {
  tooth: DentalToothState
  canEdit: boolean
  saving?: boolean
  onClose: () => void
  onSave: (payload: { treatments: DentalToothTreatment[]; labWorks: DentalLabWork[] }) => void
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ToothTreatmentModal({ tooth, canEdit, saving, onClose, onSave }: Props) {
  const [drafts, setDrafts] = useState<DentalToothTreatment[]>(() => {
    const list = (tooth.treatments || []).map((t) => normalizeTreatment(t))
    return list.length > 0 ? list : [emptyTreatment()]
  })
  const [labDrafts, setLabDrafts] = useState<DentalLabWork[]>(() =>
    (tooth.labWorks || []).map((x) => normalizeLabWork(x)),
  )
  const [payAmountById, setPayAmountById] = useState<Record<string, string>>({})
  const [payNoteById, setPayNoteById] = useState<Record<string, string>>({})
  const [payDateById, setPayDateById] = useState<Record<string, string>>({})
  const [localErr, setLocalErr] = useState('')

  function procedureKey(t: DentalToothTreatment, idx: number) {
    return t.id || `idx-${idx}`
  }

  function updateProcedure(idx: number, patch: Partial<DentalToothTreatment>) {
    setDrafts((prev) => prev.map((row, i) => (i === idx ? normalizeTreatment({ ...row, ...patch }) : row)))
  }

  function addProcedure() {
    setDrafts((prev) => [...prev, emptyTreatment()])
  }

  function removeProcedure(idx: number) {
    setDrafts((prev) => {
      if (prev.length <= 1) return [emptyTreatment()]
      return prev.filter((_, i) => i !== idx)
    })
  }

  function addPayment(idx: number) {
    setLocalErr('')
    const row = drafts[idx]
    if (!row) return
    const key = procedureKey(row, idx)
    const amount = Math.max(0, Math.round(Number(payAmountById[key] || '') || 0))
    const remaining = treatmentRemaining(row)
    if (!(amount > 0)) {
      setLocalErr(`الإجراء ${idx + 1}: أدخل مبلغ دفعة أكبر من صفر.`)
      return
    }
    if (!(row.totalCostSyp > 0)) {
      setLocalErr(`الإجراء ${idx + 1}: حدد التكلفة الكلية أولاً.`)
      return
    }
    if (amount > remaining) {
      setLocalErr(`الإجراء ${idx + 1}: المبلغ أكبر من المتبقي (${remaining.toLocaleString('ar-SY')} ل.س).`)
      return
    }
    const payment: DentalPayment = {
      id: `p-${Date.now()}-${idx}`,
      amountSyp: amount,
      paidAt: payDateById[key] || todayIsoDate(),
      note: (payNoteById[key] || '').trim(),
    }
    updateProcedure(idx, { payments: [...row.payments, payment] })
    setPayAmountById((p) => ({ ...p, [key]: '' }))
    setPayNoteById((p) => ({ ...p, [key]: '' }))
  }

  function removePayment(procIdx: number, paymentId: string) {
    const row = drafts[procIdx]
    if (!row) return
    updateProcedure(procIdx, { payments: row.payments.filter((p) => p.id !== paymentId) })
  }

  function handleSave() {
    setLocalErr('')
    const next = drafts.map((d) => normalizeTreatment(d))
    for (let i = 0; i < next.length; i += 1) {
      const t = next[i]
      if (treatmentPaidTotal(t) > t.totalCostSyp && t.totalCostSyp > 0) {
        setLocalErr(`الإجراء ${i + 1}: مجموع الدفعات يتجاوز التكلفة الكلية.`)
        return
      }
    }
    const kept = next.filter(treatmentHasData)
    const labs = labDrafts.map((x) => normalizeLabWork(x)).filter(labWorkHasData)
    onSave({ treatments: kept.length > 0 ? kept : [], labWorks: labs })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 680, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>
              إجراءات السن {tooth.fdi}
            </h3>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              {arabicToothName(tooth.fdi)} — يمكن إضافة أكثر من إجراء (لكل إجراء طبيب وتكلفة ودفعات).
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            إغلاق
          </button>
        </div>

        {drafts.map((draft, idx) => {
          const key = procedureKey(draft, idx)
          const paid = treatmentPaidTotal(draft)
          const remaining = treatmentRemaining(draft)
          return (
            <section
              key={key}
              style={{
                marginTop: '1rem',
                padding: '0.85rem',
                border: '1px solid var(--border)',
                borderRadius: 12,
                background: 'var(--surface-solid)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <strong style={{ fontSize: '0.95rem' }}>الإجراء {idx + 1}</strong>
                {canEdit && drafts.length > 1 ? (
                  <button type="button" className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => removeProcedure(idx)}>
                    حذف الإجراء
                  </button>
                ) : null}
              </div>

              <label className="form-label" style={{ marginTop: '0.75rem' }}>
                وصف الإجراء
              </label>
              <textarea
                className="textarea"
                value={draft.procedureDescription}
                disabled={!canEdit}
                onChange={(e) => updateProcedure(idx, { procedureDescription: e.target.value })}
                rows={3}
                placeholder="مثال: حشوة كومبوزيت — عصب — تاج…"
              />

              <div className="grid-2" style={{ marginTop: '0.75rem', gap: '0.75rem' }}>
                <div>
                  <label className="form-label">التكلفة الكلية (ل.س)</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    dir="ltr"
                    disabled={!canEdit}
                    value={draft.totalCostSyp ? String(draft.totalCostSyp) : ''}
                    onChange={(e) => {
                      const n = Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0))
                      updateProcedure(idx, { totalCostSyp: n })
                    }}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="form-label">اسم الطبيب المعالج</label>
                  <input
                    className="input"
                    disabled={!canEdit}
                    value={draft.doctorName}
                    onChange={(e) => updateProcedure(idx, { doctorName: e.target.value })}
                    placeholder="اسم الطبيب"
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: '0.85rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '0.5rem',
                }}
              >
                <div className="stat-card">
                  <div className="lbl">الكلي</div>
                  <div className="val" style={{ fontSize: '0.95rem' }}>
                    {draft.totalCostSyp.toLocaleString('ar-SY')} ل.س
                  </div>
                </div>
                <div className="stat-card">
                  <div className="lbl">المدفوع</div>
                  <div className="val" style={{ fontSize: '0.95rem' }}>
                    {paid.toLocaleString('ar-SY')} ل.س
                  </div>
                </div>
                <div className="stat-card" style={{ borderColor: remaining > 0 ? 'var(--warning)' : undefined }}>
                  <div className="lbl">المتبقي</div>
                  <div
                    className="val"
                    style={{ fontSize: '0.95rem', color: remaining > 0 ? 'var(--warning)' : 'var(--success)' }}
                  >
                    {remaining.toLocaleString('ar-SY')} ل.س
                  </div>
                </div>
              </div>

              <h4 style={{ margin: '0.9rem 0 0.45rem', fontSize: '0.88rem' }}>جدول دفعات هذا الإجراء</h4>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>التاريخ</th>
                      <th>المبلغ</th>
                      <th>ملاحظة</th>
                      {canEdit ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.payments.length === 0 ? (
                      <tr>
                        <td colSpan={canEdit ? 5 : 4} style={{ color: 'var(--text-muted)' }}>
                          لا دفعات بعد.
                        </td>
                      </tr>
                    ) : (
                      draft.payments.map((p, pIdx) => (
                        <tr key={p.id}>
                          <td>{pIdx + 1}</td>
                          <td>{p.paidAt || '—'}</td>
                          <td dir="ltr">{p.amountSyp.toLocaleString('ar-SY')} ل.س</td>
                          <td>{p.note || '—'}</td>
                          {canEdit ? (
                            <td>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: '0.75rem' }}
                                onClick={() => removePayment(idx, p.id)}
                              >
                                حذف
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {canEdit ? (
                <div style={{ marginTop: '0.65rem' }}>
                  <div className="grid-2" style={{ gap: '0.55rem' }}>
                    <div>
                      <label className="form-label">مبلغ دفعة (ل.س)</label>
                      <input
                        className="input"
                        inputMode="numeric"
                        dir="ltr"
                        value={payAmountById[key] || ''}
                        onChange={(e) => setPayAmountById((p) => ({ ...p, [key]: e.target.value }))}
                        placeholder={remaining > 0 ? String(remaining) : '0'}
                      />
                    </div>
                    <div>
                      <label className="form-label">تاريخ الدفع</label>
                      <input
                        className="input"
                        type="date"
                        value={payDateById[key] || todayIsoDate()}
                        onChange={(e) => setPayDateById((p) => ({ ...p, [key]: e.target.value }))}
                      />
                    </div>
                  </div>
                  <label className="form-label" style={{ marginTop: '0.45rem' }}>
                    ملاحظة (اختياري)
                  </label>
                  <input
                    className="input"
                    value={payNoteById[key] || ''}
                    onChange={(e) => setPayNoteById((p) => ({ ...p, [key]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: '0.55rem', fontSize: '0.82rem' }}
                    disabled={remaining <= 0}
                    onClick={() => addPayment(idx)}
                  >
                    إضافة دفعة لهذا الإجراء
                  </button>
                </div>
              ) : null}
            </section>
          )
        })}

        {canEdit ? (
          <button type="button" className="btn btn-secondary" style={{ marginTop: '0.85rem', width: '100%' }} onClick={addProcedure}>
            + إضافة إجراء آخر
          </button>
        ) : null}

        <section
          style={{
            marginTop: '1.15rem',
            padding: '0.85rem',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--bg)',
          }}
        >
          <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>المخابر</h4>
          <p style={{ margin: '0 0 0.65rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            سجل أعمال المخابر لهذا السن: اسم المخبر، وصف الإجراء، والمبلغ.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>اسم المخبر</th>
                  <th>وصف الإجراء</th>
                  <th>المبلغ (ل.س)</th>
                  {canEdit ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {labDrafts.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 4 : 3} style={{ color: 'var(--text-muted)' }}>
                      لا سجلات مخابر بعد.
                    </td>
                  </tr>
                ) : (
                  labDrafts.map((row, idx) => (
                    <tr key={row.id || `lab-${idx}`}>
                      <td>
                        {canEdit ? (
                          <input
                            className="input"
                            value={row.labName}
                            onChange={(e) =>
                              setLabDrafts((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, labName: e.target.value } : x)),
                              )
                            }
                            placeholder="اسم المخبر"
                          />
                        ) : (
                          row.labName || '—'
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <input
                            className="input"
                            value={row.procedureDescription}
                            onChange={(e) =>
                              setLabDrafts((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, procedureDescription: e.target.value } : x,
                                ),
                              )
                            }
                            placeholder="وصف الإجراء"
                          />
                        ) : (
                          row.procedureDescription || '—'
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <input
                            className="input"
                            inputMode="numeric"
                            dir="ltr"
                            value={row.amountSyp ? String(row.amountSyp) : ''}
                            onChange={(e) => {
                              const n = Math.max(
                                0,
                                Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0),
                              )
                              setLabDrafts((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, amountSyp: n } : x)),
                              )
                            }}
                            placeholder="0"
                          />
                        ) : (
                          <span dir="ltr">{row.amountSyp.toLocaleString('ar-SY')} ل.س</span>
                        )}
                      </td>
                      {canEdit ? (
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: '0.75rem' }}
                            onClick={() => setLabDrafts((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            حذف
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {canEdit ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '0.65rem', fontSize: '0.82rem' }}
              onClick={() => setLabDrafts((prev) => [...prev, emptyLabWork()])}
            >
              + إضافة سطر مخبر
            </button>
          ) : null}
        </section>

        {localErr ? (
          <p style={{ color: 'var(--danger)', margin: '0.75rem 0 0', fontSize: '0.88rem' }}>{localErr}</p>
        ) : null}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
          {canEdit ? (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'جاري الحفظ…' : 'حفظ الإجراءات والمخابر'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
