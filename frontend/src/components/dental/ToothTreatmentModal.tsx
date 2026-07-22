import { useEffect, useState } from 'react'
import { useClinic } from '../../context/ClinicContext'
import {
  arabicToothName,
  emptyLabWork,
  emptyTreatment,
  formatUsdAmount,
  labWorkHasData,
  normalizeLabWork,
  normalizeTreatment,
  roundUsd,
  treatmentEffectiveTotalSyp,
  treatmentHasData,
  treatmentPaidTotal,
  treatmentPaidTotalUsd,
  treatmentRemaining,
  type DentalLabWork,
  type DentalPayment,
  type DentalToothState,
  type DentalToothTreatment,
} from './dentalChartTypes'

export type DentalProviderOption = {
  id: string
  name: string
  virtual?: boolean
  noShare?: boolean
}

type Props = {
  tooth: DentalToothState
  canEdit: boolean
  saving?: boolean
  providers: DentalProviderOption[]
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

export function ToothTreatmentModal({ tooth, canEdit, saving, providers, onClose, onSave }: Props) {
  const { usdSypRate } = useClinic()
  const rate = usdSypRate != null && usdSypRate > 0 ? usdSypRate : null

  const [drafts, setDrafts] = useState<DentalToothTreatment[]>(() => {
    const list = (tooth.treatments || []).map((t) => normalizeTreatment(t, rate))
    return list.length > 0 ? list : [emptyTreatment()]
  })
  const [labDrafts, setLabDrafts] = useState<DentalLabWork[]>(() =>
    (tooth.labWorks || []).map((x) => normalizeLabWork(x)),
  )
  const [payAmountById, setPayAmountById] = useState<Record<string, string>>({})
  const [payCurrencyById, setPayCurrencyById] = useState<Record<string, 'syp' | 'usd'>>({})
  const [payNoteById, setPayNoteById] = useState<Record<string, string>>({})
  const [payDateById, setPayDateById] = useState<Record<string, string>>({})
  const [localErr, setLocalErr] = useState('')

  useEffect(() => {
    if (!providers.length) return
    setDrafts((prev) =>
      prev.map((row) => {
        if (row.providerUserId) return row
        if (!row.doctorName.trim()) return row
        const match = providers.find((p) => p.name.trim() === row.doctorName.trim())
        return match ? { ...row, providerUserId: match.id, doctorName: match.name } : row
      }),
    )
  }, [providers])

  function procedureKey(t: DentalToothTreatment, idx: number) {
    return t.id || `idx-${idx}`
  }

  function updateProcedure(idx: number, patch: Partial<DentalToothTreatment>) {
    setDrafts((prev) =>
      prev.map((row, i) => (i === idx ? normalizeTreatment({ ...row, ...patch }, rate) : row)),
    )
  }

  function setCostSyp(idx: number, value: string) {
    const n = Math.max(0, Math.round(Number(value.replace(/[^\d]/g, '')) || 0))
    updateProcedure(idx, { totalCostSyp: n })
  }

  function setCostUsd(idx: number, value: string) {
    const cleaned = value.replace(/[^\d.]/g, '')
    const n = Math.max(0, roundUsd(Number(cleaned) || 0))
    updateProcedure(idx, {
      totalCostUsd: n,
      costUsdSypRate: n > 0 ? rate || drafts[idx]?.costUsdSypRate || 0 : 0,
    })
  }

  function selectDoctor(idx: number, providerId: string) {
    const p = providers.find((x) => x.id === providerId)
    updateProcedure(idx, {
      providerUserId: p ? p.id : null,
      doctorName: p ? p.name : '',
      providerKey: p?.id === '__elias__' || p?.noShare ? 'elias' : '',
    })
  }

  function selectLabDoctor(idx: number, providerId: string) {
    const p = providers.find((x) => x.id === providerId)
    setLabDrafts((prev) =>
      prev.map((x, i) =>
        i === idx
          ? normalizeLabWork({
              ...x,
              providerUserId: p ? p.id : null,
              doctorName: p ? p.name : '',
              providerKey: p?.id === '__elias__' || p?.noShare ? 'elias' : '',
            })
          : x,
      ),
    )
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
    const currency = payCurrencyById[key] || 'syp'
    const remaining = treatmentRemaining(row, rate)
    const effectiveTotal = treatmentEffectiveTotalSyp(row, rate)

    if (!(effectiveTotal > 0)) {
      setLocalErr(`الإجراء ${idx + 1}: حدد التكلفة الكلية بالليرة أو الدولار أولاً.`)
      return
    }

    let payment: DentalPayment
    if (currency === 'usd') {
      if (!(rate != null && rate > 0)) {
        setLocalErr('لا يوجد سعر صرف لليوم — لا يمكن تسجيل دفعة بالدولار.')
        return
      }
      const amountUsd = Math.max(0, roundUsd(Number(String(payAmountById[key] || '').replace(/,/g, '')) || 0))
      if (!(amountUsd > 0)) {
        setLocalErr(`الإجراء ${idx + 1}: أدخل مبلغ دفعة بالدولار أكبر من صفر.`)
        return
      }
      const amountSyp = Math.round(amountUsd * rate)
      if (amountSyp > remaining) {
        setLocalErr(
          `الإجراء ${idx + 1}: المبلغ أكبر من المتبقي (${remaining.toLocaleString('ar-SY')} ل.س).`,
        )
        return
      }
      payment = {
        id: `p-${Date.now()}-${idx}`,
        amountSyp,
        amountUsd,
        currency: 'usd',
        usdSypRateUsed: rate,
        paidAt: payDateById[key] || todayIsoDate(),
        note: (payNoteById[key] || '').trim(),
      }
    } else {
      const amount = Math.max(0, Math.round(Number(String(payAmountById[key] || '').replace(/[^\d]/g, '')) || 0))
      if (!(amount > 0)) {
        setLocalErr(`الإجراء ${idx + 1}: أدخل مبلغ دفعة أكبر من صفر.`)
        return
      }
      if (amount > remaining) {
        setLocalErr(
          `الإجراء ${idx + 1}: المبلغ أكبر من المتبقي (${remaining.toLocaleString('ar-SY')} ل.س).`,
        )
        return
      }
      payment = {
        id: `p-${Date.now()}-${idx}`,
        amountSyp: amount,
        amountUsd: 0,
        currency: 'syp',
        usdSypRateUsed: 0,
        paidAt: payDateById[key] || todayIsoDate(),
        note: (payNoteById[key] || '').trim(),
      }
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
    const next = drafts.map((d) => normalizeTreatment(d, rate))
    for (let i = 0; i < next.length; i += 1) {
      const t = next[i]
      if (!treatmentHasData(t)) continue
      const effective = treatmentEffectiveTotalSyp(t, rate)
      if (t.totalCostUsd > 0 && !(t.costUsdSypRate > 0) && !(rate != null && rate > 0)) {
        setLocalErr(`الإجراء ${i + 1}: تكلفة بالدولار تتطلب سعر صرف لليوم النشط.`)
        return
      }
      if (effective > 0 && !t.providerUserId) {
        setLocalErr(`الإجراء ${i + 1}: اختر الطبيب المعالج من القائمة (مطلوب للنظام المالي).`)
        return
      }
      if (treatmentPaidTotal(t) > effective && effective > 0) {
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
          const paidUsd = treatmentPaidTotalUsd(draft)
          const remaining = treatmentRemaining(draft, rate)
          const effectiveTotal = treatmentEffectiveTotalSyp(draft, rate)
          const payCurrency = payCurrencyById[key] || 'syp'
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
                    onChange={(e) => setCostSyp(idx, e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="form-label">التكلفة الكلية (USD)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    disabled={!canEdit}
                    value={draft.totalCostUsd ? String(draft.totalCostUsd) : ''}
                    onChange={(e) => setCostUsd(idx, e.target.value)}
                    placeholder="0"
                  />
                  {rate != null ? (
                    <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      سعر اليوم: {rate.toLocaleString('ar-SY')} ل.س / USD
                    </p>
                  ) : (
                    <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'var(--danger)' }}>
                      لا يوجد سعر صرف لليوم — التكلفة بالدولار لن تُحسب حتى يُفتح اليوم بسعر.
                    </p>
                  )}
                </div>
                <div>
                  <label className="form-label">اسم الطبيب المعالج</label>
                  <select
                    className="input"
                    disabled={!canEdit}
                    value={draft.providerUserId || ''}
                    onChange={(e) => selectDoctor(idx, e.target.value)}
                  >
                    <option value="">— اختر الطبيب —</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    {draft.providerUserId &&
                    !providers.some((p) => p.id === draft.providerUserId) &&
                    draft.doctorName ? (
                      <option value={draft.providerUserId}>{draft.doctorName} (غير نشط)</option>
                    ) : null}
                  </select>
                  {draft.providerUserId === '__elias__' ? (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      إجراءاته تُضاف لربح قسم الأسنان بالكامل بعد خصم مخابره (بدون نسبة 40٪).
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="form-label">تاريخ الإجراء</label>
                  <input
                    className="input"
                    type="date"
                    dir="ltr"
                    disabled={!canEdit}
                    value={draft.businessDate || todayIsoDate()}
                    onChange={(e) => updateProcedure(idx, { businessDate: e.target.value })}
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
                  <div className="lbl">الكلي (مكافئ)</div>
                  <div className="val" style={{ fontSize: '0.9rem' }}>
                    {effectiveTotal.toLocaleString('ar-SY')} ل.س
                  </div>
                  {draft.totalCostUsd > 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      منها {formatUsdAmount(draft.totalCostUsd)} USD
                      {draft.totalCostSyp > 0 ? ` + ${draft.totalCostSyp.toLocaleString('ar-SY')} ل.س` : ''}
                    </div>
                  ) : null}
                </div>
                <div className="stat-card">
                  <div className="lbl">المدفوع</div>
                  <div className="val" style={{ fontSize: '0.9rem' }}>
                    {paid.toLocaleString('ar-SY')} ل.س
                  </div>
                  {paidUsd > 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      منها {formatUsdAmount(paidUsd)} USD
                    </div>
                  ) : null}
                </div>
                <div className="stat-card" style={{ borderColor: remaining > 0 ? 'var(--warning)' : undefined }}>
                  <div className="lbl">المتبقي</div>
                  <div
                    className="val"
                    style={{ fontSize: '0.9rem', color: remaining > 0 ? 'var(--warning)' : 'var(--success)' }}
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
                      <th>العملة</th>
                      <th>المبلغ</th>
                      <th>ملاحظة</th>
                      {canEdit ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.payments.length === 0 ? (
                      <tr>
                        <td colSpan={canEdit ? 6 : 5} style={{ color: 'var(--text-muted)' }}>
                          لا دفعات بعد.
                        </td>
                      </tr>
                    ) : (
                      draft.payments.map((p, pIdx) => (
                        <tr key={p.id}>
                          <td>{pIdx + 1}</td>
                          <td>{p.paidAt || '—'}</td>
                          <td>{p.currency === 'usd' ? 'USD' : 'ل.س'}</td>
                          <td dir="ltr">
                            {p.currency === 'usd'
                              ? `${formatUsdAmount(p.amountUsd)} USD (${p.amountSyp.toLocaleString('ar-SY')} ل.س)`
                              : `${p.amountSyp.toLocaleString('ar-SY')} ل.س`}
                          </td>
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
                      <label className="form-label">عملة الدفعة</label>
                      <select
                        className="input"
                        value={payCurrency}
                        onChange={(e) =>
                          setPayCurrencyById((p) => ({
                            ...p,
                            [key]: e.target.value === 'usd' ? 'usd' : 'syp',
                          }))
                        }
                      >
                        <option value="syp">ليرة سورية</option>
                        <option value="usd">دولار USD</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">
                        {payCurrency === 'usd' ? 'مبلغ دفعة (USD)' : 'مبلغ دفعة (ل.س)'}
                      </label>
                      <input
                        className="input"
                        inputMode={payCurrency === 'usd' ? 'decimal' : 'numeric'}
                        dir="ltr"
                        value={payAmountById[key] || ''}
                        onChange={(e) => setPayAmountById((p) => ({ ...p, [key]: e.target.value }))}
                        placeholder={
                          remaining > 0
                            ? payCurrency === 'usd' && rate
                              ? String(roundUsd(remaining / rate))
                              : String(remaining)
                            : '0'
                        }
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
            سجل أعمال المخابر لهذا السن. اربط المخبر بالطبيب المعالج (مهم لحساب د. الياس).
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>اسم المخبر</th>
                  <th>وصف الإجراء</th>
                  <th>الطبيب</th>
                  <th>المبلغ (ل.س)</th>
                  <th>التاريخ</th>
                  {canEdit ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {labDrafts.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 6 : 5} style={{ color: 'var(--text-muted)' }}>
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
                          <select
                            className="input"
                            value={row.providerUserId || ''}
                            onChange={(e) => selectLabDoctor(idx, e.target.value)}
                          >
                            <option value="">—</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          row.doctorName || '—'
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
                      <td>
                        {canEdit ? (
                          <input
                            className="input"
                            type="date"
                            dir="ltr"
                            value={row.businessDate || todayIsoDate()}
                            onChange={(e) =>
                              setLabDrafts((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, businessDate: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        ) : (
                          <span dir="ltr">{row.businessDate || '—'}</span>
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
              onClick={() => {
                const fromProc = drafts.find((d) => d.providerUserId)
                const base = emptyLabWork()
                if (fromProc) {
                  setLabDrafts((prev) => [
                    ...prev,
                    normalizeLabWork({
                      ...base,
                      providerUserId: fromProc.providerUserId,
                      doctorName: fromProc.doctorName,
                      providerKey: fromProc.providerKey,
                    }),
                  ])
                } else {
                  setLabDrafts((prev) => [...prev, base])
                }
              }}
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
