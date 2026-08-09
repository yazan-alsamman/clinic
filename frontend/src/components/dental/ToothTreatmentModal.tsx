import { useEffect, useState } from 'react'
import { useClinic } from '../../context/ClinicContext'
import {
  arabicToothName,
  emptyLabWork,
  emptyTreatment,
  formatUsdAmount,
  labEffectiveAmountSyp,
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
  type DentalToothState,
  type DentalToothTreatment,
} from './dentalChartTypes'

export type DentalProviderOption = {
  id: string
  name: string
  virtual?: boolean
  noShare?: boolean
}

export type DentalLabOption = {
  id: string
  name: string
}

type Props = {
  tooth: DentalToothState
  canEdit: boolean
  saving?: boolean
  providers: DentalProviderOption[]
  labs?: DentalLabOption[]
  /** حالة الدخول: وصف فقط بدون تكلفة/دفعات/مخابر */
  baselineOnly?: boolean
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

export function ToothTreatmentModal({
  tooth,
  canEdit,
  saving,
  providers,
  labs = [],
  baselineOnly = false,
  onClose,
  onSave,
}: Props) {
  const { usdSypRate } = useClinic()
  const rate = usdSypRate != null && usdSypRate > 0 ? usdSypRate : null

  const [drafts, setDrafts] = useState<DentalToothTreatment[]>(() => {
    const list = (tooth.treatments || []).map((t) => normalizeTreatment(t, rate))
    if (baselineOnly) {
      const docs = list.filter(
        (t) =>
          !(t.totalCostSyp > 0 || t.totalCostUsd > 0 || t.payments.length > 0 || Boolean(t.providerUserId)),
      )
      return docs.length > 0 ? docs : [emptyTreatment()]
    }
    return list.length > 0 ? list : [emptyTreatment()]
  })
  const [labDrafts, setLabDrafts] = useState<DentalLabWork[]>(() =>
    (tooth.labWorks || []).map((x) => normalizeLabWork(x, rate)),
  )
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
          ? normalizeLabWork(
              {
                ...x,
                providerUserId: p ? p.id : null,
                doctorName: p ? p.name : '',
                providerKey: p?.id === '__elias__' || p?.noShare ? 'elias' : '',
              },
              rate,
            )
          : x,
      ),
    )
  }

  function selectLabCatalog(idx: number, labId: string) {
    const lab = labs.find((x) => x.id === labId)
    setLabDrafts((prev) =>
      prev.map((x, i) =>
        i === idx
          ? normalizeLabWork(
              {
                ...x,
                labId: lab ? lab.id : null,
                labName: lab ? lab.name : '',
              },
              rate,
            )
          : x,
      ),
    )
  }

  function setLabAmountSyp(idx: number, value: string) {
    const n = Math.max(0, Math.round(Number(value.replace(/[^\d]/g, '')) || 0))
    setLabDrafts((prev) =>
      prev.map((x, i) => (i === idx ? normalizeLabWork({ ...x, amountSyp: n }, rate) : x)),
    )
  }

  function setLabAmountUsd(idx: number, value: string) {
    const cleaned = value.replace(/[^\d.]/g, '')
    const n = Math.max(0, roundUsd(Number(cleaned) || 0))
    setLabDrafts((prev) =>
      prev.map((x, i) =>
        i === idx
          ? normalizeLabWork(
              {
                ...x,
                amountUsd: n,
                usdSypRate: n > 0 ? rate || x.usdSypRate || 0 : 0,
              },
              rate,
            )
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

  function handleSave() {
    setLocalErr('')
    if (baselineOnly) {
      const financial = (tooth.treatments || [])
        .map((t) => normalizeTreatment(t, rate))
        .filter(
          (t) =>
            t.totalCostSyp > 0 ||
            t.totalCostUsd > 0 ||
            t.payments.length > 0 ||
            Boolean(t.providerUserId),
        )
      const docs = drafts
        .map((d) =>
          normalizeTreatment(
            {
              ...emptyTreatment(),
              id: d.id,
              procedureDescription: d.procedureDescription,
            },
            rate,
          ),
        )
        .filter((t) => Boolean(t.procedureDescription.trim()))
      const finIds = new Set(financial.map((t) => String(t.id || '')).filter(Boolean))
      const docsOnly = docs.filter((d) => !d.id || !finIds.has(String(d.id)))
      onSave({
        treatments: [...financial, ...docsOnly],
        labWorks: (tooth.labWorks || []).map((x) => normalizeLabWork(x, rate)).filter(labWorkHasData),
      })
      return
    }
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
    const labsKept = labDrafts.map((x) => normalizeLabWork(x, rate)).filter(labWorkHasData)
    for (let i = 0; i < labsKept.length; i += 1) {
      const lab = labsKept[i]
      if (!lab.labId && !lab.labName.trim()) {
        setLocalErr(`سطر المخبر ${i + 1}: اختر المخبر من القائمة.`)
        return
      }
      if (lab.amountUsd > 0 && !(lab.usdSypRate > 0) && !(rate != null && rate > 0)) {
        setLocalErr(`سطر المخبر ${i + 1}: تكلفة بالدولار تتطلب سعر صرف لليوم النشط.`)
        return
      }
    }
    onSave({ treatments: kept.length > 0 ? kept : [], labWorks: labsKept })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 820, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>
              إجراءات السن {tooth.fdi}
            </h3>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              {arabicToothName(tooth.fdi)}
              {baselineOnly
                ? ' — حالة الدخول: وصف فقط (بدون تكلفة أو دفعات).'
                : ' — التكلفة تُرسل تلقائياً لتحصيل الاستقبال (لا دفع من هنا).'}
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

              {!baselineOnly ? (
              <>
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
                  <div className="lbl">المحصّل (استقبال)</div>
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

              {effectiveTotal > 0 ? (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.65rem 0.75rem',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    fontSize: '0.85rem',
                  }}
                >
                  <strong>التحصيل: </strong>
                  {draft.billingStatus === 'paid' || (paid > 0 && remaining <= 0) ? (
                    <span style={{ color: 'var(--success)' }}>محصّل من الاستقبال</span>
                  ) : draft.billingStatus === 'pending_payment' || draft.billingItemId ? (
                    <span style={{ color: 'var(--warning)' }}>بانتظار التحصيل في الاستقبال</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>
                      عند الحفظ يُرسل البند تلقائياً لطابور التحصيل
                    </span>
                  )}
                  {draft.payments.length > 0 ? (
                    <ul style={{ margin: '0.45rem 0 0', paddingRight: '1.1rem' }}>
                      {draft.payments.map((p) => (
                        <li key={p.id}>
                          {p.paidAt || '—'} —{' '}
                          {p.currency === 'usd'
                            ? `${formatUsdAmount(p.amountUsd)} USD`
                            : `${p.amountSyp.toLocaleString('ar-SY')} ل.س`}
                          {p.note ? ` (${p.note})` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              </>
              ) : null}
            </section>
          )
        })}

        {canEdit && !baselineOnly ? (
          <button type="button" className="btn btn-secondary" style={{ marginTop: '0.85rem', width: '100%' }} onClick={addProcedure}>
            + إضافة إجراء آخر
          </button>
        ) : null}

        {canEdit && baselineOnly && drafts.length < 5 ? (
          <button type="button" className="btn btn-secondary" style={{ marginTop: '0.85rem', width: '100%' }} onClick={addProcedure}>
            + إضافة وصف آخر
          </button>
        ) : null}

        {!baselineOnly ? (
        <section
          style={{
            marginTop: '1.15rem',
            padding: '0.95rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--bg)',
          }}
        >
          <h4 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>المخابر</h4>
          <p style={{ margin: '0 0 0.85rem', fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            اختر المخبر من القائمة (تُدار من صفحة المخابر)، ثم سجّل وصف العمل والمبلغ بالليرة أو الدولار، واربط
            الطبيب المعالج (مهم لحساب د. الياس).
          </p>

          {labDrafts.length === 0 ? (
            <p style={{ margin: '0 0 0.65rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              لا سجلات مخابر بعد.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {labDrafts.map((row, idx) => {
                const effective = labEffectiveAmountSyp(row, rate)
                const selectValue =
                  row.labId && labs.some((l) => l.id === row.labId)
                    ? row.labId
                    : labs.find((l) => l.name.trim() === row.labName.trim())?.id || ''
                return (
                  <div
                    key={row.id || `lab-${idx}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: '0.85rem',
                      background: 'var(--surface-solid)',
                      display: 'grid',
                      gap: '0.65rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong style={{ fontSize: '0.9rem' }}>سطر مخبر {idx + 1}</strong>
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.78rem' }}
                          onClick={() => setLabDrafts((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          حذف
                        </button>
                      ) : null}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '0.65rem',
                      }}
                    >
                      <div>
                        <label className="form-label">اسم المخبر</label>
                        {canEdit ? (
                          labs.length > 0 ? (
                            <select
                              className="input"
                              value={selectValue}
                              onChange={(e) => selectLabCatalog(idx, e.target.value)}
                            >
                              <option value="">— اختر مخبر —</option>
                              {labs.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                              {row.labName && !selectValue ? (
                                <option value="" disabled>
                                  {row.labName} (غير في القائمة)
                                </option>
                              ) : null}
                            </select>
                          ) : (
                            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--amber)' }}>
                              لا مخابر في القائمة — أضفها من صفحة «المخابر» أولاً.
                            </p>
                          )
                        ) : (
                          <div>{row.labName || '—'}</div>
                        )}
                      </div>

                      <div>
                        <label className="form-label">الطبيب</label>
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
                          <div>{row.doctorName || '—'}</div>
                        )}
                      </div>

                      <div>
                        <label className="form-label">التاريخ</label>
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
                          <div dir="ltr">{row.businessDate || '—'}</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="form-label">وصف الإجراء</label>
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
                          placeholder="مثال: تاج خزفي / وجه تجميلي"
                        />
                      ) : (
                        <div>{row.procedureDescription || '—'}</div>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '0.65rem',
                        alignItems: 'end',
                      }}
                    >
                      <div>
                        <label className="form-label">المبلغ (ل.س)</label>
                        {canEdit ? (
                          <input
                            className="input"
                            inputMode="numeric"
                            dir="ltr"
                            value={row.amountSyp ? String(row.amountSyp) : ''}
                            onChange={(e) => setLabAmountSyp(idx, e.target.value)}
                            placeholder="0"
                          />
                        ) : (
                          <div dir="ltr">{row.amountSyp.toLocaleString('ar-SY')} ل.س</div>
                        )}
                      </div>
                      <div>
                        <label className="form-label">المبلغ (USD)</label>
                        {canEdit ? (
                          <input
                            className="input"
                            inputMode="decimal"
                            dir="ltr"
                            value={row.amountUsd ? String(row.amountUsd) : ''}
                            onChange={(e) => setLabAmountUsd(idx, e.target.value)}
                            placeholder="0"
                          />
                        ) : row.amountUsd > 0 ? (
                          <div dir="ltr">{formatUsdAmount(row.amountUsd)} USD</div>
                        ) : (
                          <div>—</div>
                        )}
                      </div>
                      <div>
                        <label className="form-label">الإجمالي المكافئ</label>
                        <div dir="ltr" style={{ fontWeight: 700, padding: '0.45rem 0' }}>
                          {effective > 0 ? `${effective.toLocaleString('ar-SY')} ل.س` : '—'}
                        </div>
                        {row.amountUsd > 0 && rate != null ? (
                          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            سعر الصرف {rate.toLocaleString('ar-SY')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {canEdit ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '0.85rem', fontSize: '0.86rem' }}
              onClick={() => {
                const fromProc = drafts.find((d) => d.providerUserId)
                const base = emptyLabWork()
                if (fromProc) {
                  setLabDrafts((prev) => [
                    ...prev,
                    normalizeLabWork(
                      {
                        ...base,
                        providerUserId: fromProc.providerUserId,
                        doctorName: fromProc.doctorName,
                        providerKey: fromProc.providerKey,
                      },
                      rate,
                    ),
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
        ) : null}

        {localErr ? (
          <p style={{ color: 'var(--danger)', margin: '0.75rem 0 0', fontSize: '0.88rem' }}>{localErr}</p>
        ) : null}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
          {canEdit ? (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'جاري الحفظ…' : baselineOnly ? 'حفظ الوصف' : 'حفظ الإجراءات والمخابر'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
