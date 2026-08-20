import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useClinic } from '../../context/ClinicContext'
import {
  emptyOrthodonticCase,
  emptyOrthoInstallment,
  formatUsdAmount,
  installmentEffectiveTotalSyp,
  installmentPaidTotal,
  installmentRemaining,
  normalizeOrthodonticCase,
  normalizeOrthoInstallment,
  orthodonticCaseHasData,
  type DentalChartDto,
  type DentalOrthodonticCase,
  type DentalOrthoInstallment,
} from './dentalChartTypes'
import type { DentalProviderOption } from './ToothTreatmentModal'

type Props = {
  patientId: string
  canEdit: boolean
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function DentalOrthodontics({ patientId, canEdit }: Props) {
  const { usdSypRate } = useClinic()
  const rate = usdSypRate != null && usdSypRate > 0 ? usdSypRate : null

  const [cases, setCases] = useState<DentalOrthodonticCase[]>([])
  const [providers, setProviders] = useState<DentalProviderOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [title, setTitle] = useState('تقويم')
  const [providerId, setProviderId] = useState('')
  const [totalCostSyp, setTotalCostSyp] = useState(0)
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [startedAt, setStartedAt] = useState(todayIsoDate)
  const [notes, setNotes] = useState('')

  const [installCaseIdx, setInstallCaseIdx] = useState<number | null>(null)
  const [instAmountSyp, setInstAmountSyp] = useState(0)
  const [instAmountUsd, setInstAmountUsd] = useState(0)
  const [instDate, setInstDate] = useState(todayIsoDate)
  const [instNote, setInstNote] = useState('')

  const load = useCallback(async () => {
    setErr('')
    setLoading(true)
    try {
      const [chartRes, providersRes] = await Promise.all([
        api<{ chart: DentalChartDto }>(`/api/dental/chart/${encodeURIComponent(patientId)}`),
        api<{ providers: DentalProviderOption[] }>('/api/dental/providers').catch(() => ({
          providers: [] as DentalProviderOption[],
        })),
      ])
      setProviders(providersRes.providers || [])
      const list = (chartRes.chart?.orthodonticCases || []).map((c) =>
        normalizeOrthodonticCase(c, rate),
      )
      setCases(list.filter(orthodonticCaseHasData))
    } catch (e) {
      setCases([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل التقويم')
    } finally {
      setLoading(false)
    }
  }, [patientId, rate])

  useEffect(() => {
    void load()
  }, [load])

  function resetCaseForm() {
    setTitle('تقويم')
    setProviderId('')
    setTotalCostSyp(0)
    setTotalCostUsd(0)
    setStartedAt(todayIsoDate())
    setNotes('')
  }

  function resetInstallForm() {
    setInstAmountSyp(0)
    setInstAmountUsd(0)
    setInstDate(todayIsoDate())
    setInstNote('')
  }

  async function saveAll(next: DentalOrthodonticCase[]) {
    setSaving(true)
    setErr('')
    setOkMsg('')
    try {
      const payload = next
        .map((c) => normalizeOrthodonticCase(c, rate))
        .filter(orthodonticCaseHasData)
        .map((c) => ({
          ...c,
          title: String(c.title || 'تقويم').trim() || 'تقويم',
          notes: String(c.notes || '').trim(),
          installments: (c.installments || []).map((x) =>
            normalizeOrthoInstallment(
              {
                ...x,
                note: String(x.note || '').trim(),
              },
              rate,
            ),
          ),
        }))
      const data = await api<{ chart: DentalChartDto }>(
        `/api/dental/chart/${encodeURIComponent(patientId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ orthodonticCases: payload }),
        },
      )
      const list = (data.chart?.orthodonticCases || []).map((c) =>
        normalizeOrthodonticCase(c, rate),
      )
      setCases(list.filter(orthodonticCaseHasData))
      setOkMsg('تم الحفظ — أقساط التقويم ذات المبلغ تذهب للتحصيل؛ حصة الطبيب من كل دفعة مسدّدة فقط')
      return true
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حفظ التقويم')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function addCase() {
    const p = providers.find((x) => x.id === providerId)
    if (!p) {
      setErr('اختر طبيب الأسنان المسؤول عن التقويم')
      return
    }
    const row = normalizeOrthodonticCase(
      {
        ...emptyOrthodonticCase(),
        title: title.trim() || 'تقويم',
        doctorName: p.name,
        providerUserId: p.id,
        providerKey: p.id === '__elias__' || p.noShare ? 'elias' : '',
        totalCostSyp,
        totalCostUsd,
        costUsdSypRate: totalCostUsd > 0 ? rate || 0 : 0,
        startedAt,
        notes: notes.trim(),
        installments: [],
      },
      rate,
    )
    const ok = await saveAll([...cases, row])
    if (ok) resetCaseForm()
  }

  async function addInstallment() {
    if (installCaseIdx == null || !cases[installCaseIdx]) {
      setErr('اختر حالة تقويم لإضافة قسط')
      return
    }
    if (!(instAmountSyp > 0) && !(instAmountUsd > 0)) {
      setErr('أدخل مبلغ القسط بالليرة أو بالدولار')
      return
    }
    const inst = normalizeOrthoInstallment(
      {
        ...emptyOrthoInstallment(),
        amountSyp: instAmountSyp,
        amountUsd: instAmountUsd,
        costUsdSypRate: instAmountUsd > 0 ? rate || 0 : 0,
        businessDate: instDate,
        note: instNote.trim(),
        payments: [],
      },
      rate,
    )
    const next = cases.map((c, i) =>
      i === installCaseIdx
        ? { ...c, installments: [...(c.installments || []), inst] }
        : c,
    )
    const ok = await saveAll(next)
    if (ok) {
      resetInstallForm()
      setInstallCaseIdx(null)
    }
  }

  async function removeCase(idx: number) {
    if (!canEdit || saving) return
    const c = cases[idx]
    const hasPaid = (c?.installments || []).some(
      (x) => x.billingStatus === 'paid' || installmentPaidTotal(x) > 0,
    )
    if (hasPaid) {
      setErr('لا يمكن حذف حالة تقويم فيها أقساط محصّلة')
      return
    }
    if (!window.confirm('حذف حالة التقويم هذه وكل أقساطها غير المحصّلة؟')) return
    await saveAll(cases.filter((_, i) => i !== idx))
  }

  async function removeInstallment(caseIdx: number, instIdx: number) {
    if (!canEdit || saving) return
    const inst = cases[caseIdx]?.installments?.[instIdx]
    if (inst?.billingStatus === 'paid' || (inst && installmentPaidTotal(inst) > 0)) {
      setErr('لا يمكن حذف قسط محصّل')
      return
    }
    if (!window.confirm('حذف هذا القسط؟')) return
    const next = cases.map((c, i) =>
      i === caseIdx
        ? { ...c, installments: (c.installments || []).filter((_, j) => j !== instIdx) }
        : c,
    )
    await saveAll(next)
  }

  function installmentStatusLabel(inst: DentalOrthoInstallment) {
    const paid = installmentPaidTotal(inst)
    const remaining = installmentRemaining(inst, rate)
    if (inst.billingStatus === 'paid' || (paid > 0 && remaining <= 0)) return 'محصّل'
    if (inst.billingStatus === 'pending_payment' || inst.billingItemId) return 'بانتظار التحصيل'
    return '—'
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 className="card-title">تقويم</h2>
      <p style={{ marginTop: '-0.35rem', marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        ربط حالة تقويم بطبيب أسنان، ثم إضافة أقساط للتحصيل (ل.س أو دولار). حصة الطبيب تُحسب من كل دفعة
        مسدّدة حسب نسبته في المركز — وليس من إجمالي الخطة دفعة واحدة.
      </p>

      {err ? (
        <p style={{ color: 'var(--danger)', margin: '0 0 0.75rem', fontSize: '0.88rem' }}>{err}</p>
      ) : null}
      {okMsg ? (
        <p style={{ color: 'var(--success)', margin: '0 0 0.75rem', fontSize: '0.88rem' }}>{okMsg}</p>
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
      ) : (
        <>
          {cases.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: '0 0 1rem' }}>لا توجد حالات تقويم بعد.</p>
          ) : (
            <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
              {cases.map((c, caseIdx) => {
                const planSyp =
                  Math.max(0, Math.round(c.totalCostSyp || 0)) +
                  (c.totalCostUsd > 0 && (c.costUsdSypRate || rate || 0) > 0
                    ? Math.round(c.totalCostUsd * (c.costUsdSypRate || rate || 0))
                    : 0)
                const paidAll = (c.installments || []).reduce(
                  (s, x) => s + installmentPaidTotal(x),
                  0,
                )
                return (
                  <div
                    key={c.id || `ortho-${caseIdx}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: '0.85rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.5rem 1rem',
                        justifyContent: 'space-between',
                        marginBottom: '0.65rem',
                      }}
                    >
                      <div>
                        <strong>{c.title || 'تقويم'}</strong>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          الطبيب: {c.doctorName || '—'} · بدء: {c.startedAt || '—'}
                          {planSyp > 0 ? ` · خطة ≈ ${planSyp.toLocaleString('ar-SY')} ل.س` : ''}
                          {paidAll > 0 ? ` · مسدّد ${paidAll.toLocaleString('ar-SY')} ل.س` : ''}
                        </div>
                        {c.notes.trim() ? (
                          <div style={{ fontSize: '0.82rem', marginTop: 4 }}>{c.notes.trim()}</div>
                        ) : null}
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.78rem' }}
                          disabled={saving}
                          onClick={() => void removeCase(caseIdx)}
                        >
                          حذف الحالة
                        </button>
                      ) : null}
                    </div>

                    {(c.installments || []).length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                        لا أقساط بعد.
                      </p>
                    ) : (
                      <div className="table-wrap" style={{ marginBottom: '0.65rem' }}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>التاريخ</th>
                              <th>ملاحظة</th>
                              <th>المبلغ</th>
                              <th>التحصيل</th>
                              {canEdit ? <th></th> : null}
                            </tr>
                          </thead>
                          <tbody>
                            {(c.installments || []).map((inst, instIdx) => {
                              const effective = installmentEffectiveTotalSyp(inst, rate)
                              const paid = installmentPaidTotal(inst)
                              const remaining = installmentRemaining(inst, rate)
                              const statusLabel = installmentStatusLabel(inst)
                              return (
                                <tr key={inst.id || `inst-${caseIdx}-${instIdx}`}>
                                  <td>{inst.businessDate || '—'}</td>
                                  <td>{inst.note.trim() || '—'}</td>
                                  <td>
                                    {effective.toLocaleString('ar-SY')} ل.س
                                    {inst.amountUsd > 0 ? (
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        منها {formatUsdAmount(inst.amountUsd)} USD
                                        {paid > 0 && remaining > 0
                                          ? ` · متبقي ${remaining.toLocaleString('ar-SY')}`
                                          : ''}
                                      </div>
                                    ) : paid > 0 && remaining > 0 ? (
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        متبقي {remaining.toLocaleString('ar-SY')} ل.س
                                      </div>
                                    ) : null}
                                  </td>
                                  <td
                                    style={{
                                      color:
                                        statusLabel === 'محصّل'
                                          ? 'var(--success)'
                                          : statusLabel === 'بانتظار التحصيل'
                                            ? 'var(--warning)'
                                            : undefined,
                                    }}
                                  >
                                    {statusLabel}
                                  </td>
                                  {canEdit ? (
                                    <td>
                                      <button
                                        type="button"
                                        className="btn btn-ghost"
                                        style={{ fontSize: '0.78rem' }}
                                        disabled={
                                          saving ||
                                          inst.billingStatus === 'paid' ||
                                          installmentPaidTotal(inst) > 0
                                        }
                                        onClick={() => void removeInstallment(caseIdx, instIdx)}
                                      >
                                        حذف
                                      </button>
                                    </td>
                                  ) : null}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {canEdit ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: '0.82rem' }}
                        disabled={saving}
                        onClick={() => {
                          setInstallCaseIdx(caseIdx)
                          resetInstallForm()
                          setErr('')
                          setOkMsg('')
                        }}
                      >
                        + إضافة قسط لهذه الحالة
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          {canEdit && installCaseIdx != null && cases[installCaseIdx] ? (
            <div
              style={{
                display: 'grid',
                gap: '0.65rem',
                padding: '0.85rem',
                borderRadius: 12,
                border: '1px solid var(--border)',
                marginBottom: '1rem',
                background: 'var(--surface-2, transparent)',
              }}
            >
              <strong style={{ fontSize: '0.92rem' }}>
                قسط جديد — {cases[installCaseIdx].title || 'تقويم'} ({cases[installCaseIdx].doctorName})
              </strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.65rem' }}>
                <label>
                  المبلغ ل.س
                  <input
                    type="number"
                    min={0}
                    value={instAmountSyp || ''}
                    onChange={(e) => setInstAmountSyp(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  />
                </label>
                <label>
                  المبلغ USD
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={instAmountUsd || ''}
                    onChange={(e) => setInstAmountUsd(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label>
                  التاريخ
                  <input type="date" value={instDate} onChange={(e) => setInstDate(e.target.value)} />
                </label>
                <label>
                  ملاحظة
                  <input value={instNote} onChange={(e) => setInstNote(e.target.value)} placeholder="قسط أول…" />
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void addInstallment()}>
                  حفظ القسط للتحصيل
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={() => {
                    setInstallCaseIdx(null)
                    resetInstallForm()
                  }}
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : null}

          {canEdit ? (
            <div
              style={{
                display: 'grid',
                gap: '0.65rem',
                padding: '0.85rem',
                borderRadius: 12,
                border: '1px solid var(--border)',
              }}
            >
              <strong style={{ fontSize: '0.92rem' }}>حالة تقويم جديدة</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.65rem' }}>
                <label>
                  العنوان
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="تقويم" />
                </label>
                <label>
                  الطبيب
                  <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                    <option value="">— اختر —</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  تاريخ البدء
                  <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
                </label>
                <label>
                  إجمالي الخطة ل.س (اختياري)
                  <input
                    type="number"
                    min={0}
                    value={totalCostSyp || ''}
                    onChange={(e) => setTotalCostSyp(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  />
                </label>
                <label>
                  إجمالي الخطة USD (اختياري)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={totalCostUsd || ''}
                    onChange={(e) => setTotalCostUsd(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              </div>
              <label>
                ملاحظات
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات اختيارية…"
                />
              </label>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void addCase()}>
                إضافة حالة تقويم
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
