import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useClinic } from '../../context/ClinicContext'
import {
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
  type DentalChartDto,
  type DentalLabWork,
  type DentalToothTreatment,
} from './dentalChartTypes'
import type { DentalLabOption, DentalProviderOption } from './ToothTreatmentModal'

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

export function DentalGeneralProcedures({ patientId, canEdit }: Props) {
  const { usdSypRate } = useClinic()
  const rate = usdSypRate != null && usdSypRate > 0 ? usdSypRate : null

  const [rows, setRows] = useState<DentalToothTreatment[]>([])
  const [labRows, setLabRows] = useState<DentalLabWork[]>([])
  const [providers, setProviders] = useState<DentalProviderOption[]>([])
  const [labs, setLabs] = useState<DentalLabOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [desc, setDesc] = useState('')
  const [costSyp, setCostSyp] = useState(0)
  const [costUsd, setCostUsd] = useState(0)
  const [providerId, setProviderId] = useState('')
  const [businessDate, setBusinessDate] = useState(todayIsoDate)

  const [labDraft, setLabDraft] = useState<DentalLabWork>(() => emptyLabWork())

  const load = useCallback(async () => {
    setErr('')
    setLoading(true)
    try {
      const [chartRes, providersRes, labsRes] = await Promise.all([
        api<{ chart: DentalChartDto }>(`/api/dental/chart/${encodeURIComponent(patientId)}`),
        api<{ providers: DentalProviderOption[] }>('/api/dental/providers').catch(() => ({
          providers: [] as DentalProviderOption[],
        })),
        api<{ labs: DentalLabOption[] }>('/api/dental/labs').catch(() => ({
          labs: [] as DentalLabOption[],
        })),
      ])
      setProviders(providersRes.providers || [])
      setLabs(labsRes.labs || [])
      const list = (chartRes.chart?.generalTreatments || []).map((t) => normalizeTreatment(t, rate))
      setRows(list.filter(treatmentHasData))
      const labsList = (chartRes.chart?.generalLabWorks || []).map((x) => normalizeLabWork(x, rate))
      setLabRows(labsList.filter(labWorkHasData))
    } catch (e) {
      setRows([])
      setLabRows([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الإجراءات العامة')
    } finally {
      setLoading(false)
    }
  }, [patientId, rate])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setDesc('')
    setCostSyp(0)
    setCostUsd(0)
    setProviderId('')
    setBusinessDate(todayIsoDate())
  }

  function resetLabForm() {
    setLabDraft(emptyLabWork())
  }

  async function saveAll(nextTreatments: DentalToothTreatment[], nextLabs: DentalLabWork[]) {
    setSaving(true)
    setErr('')
    setOkMsg('')
    try {
      const treatmentsPayload = nextTreatments
        .map((t) =>
          normalizeTreatment({
            ...t,
            procedureDescription: String(t.procedureDescription || '').trim(),
          }),
        )
        .filter(treatmentHasData)
      const labsPayload = nextLabs
        .map((x) =>
          normalizeLabWork(
            {
              ...x,
              procedureDescription: String(x.procedureDescription || '').trim(),
            },
            rate,
          ),
        )
        .filter(labWorkHasData)
      const data = await api<{ chart: DentalChartDto }>(
        `/api/dental/chart/${encodeURIComponent(patientId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            generalTreatments: treatmentsPayload,
            generalLabWorks: labsPayload,
          }),
        },
      )
      const list = (data.chart?.generalTreatments || []).map((t) => normalizeTreatment(t, rate))
      setRows(list.filter(treatmentHasData))
      const labsList = (data.chart?.generalLabWorks || []).map((x) => normalizeLabWork(x, rate))
      setLabRows(labsList.filter(labWorkHasData))
      setOkMsg('تم الحفظ — البنود ذات السعر تذهب للتحصيل')
      return true
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حفظ الإجراء العام')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function addProcedure() {
    const description = desc.trim()
    if (!description) {
      setErr('أدخل وصف الإجراء (مثل تنظيف أو تبييض)')
      return
    }
    if (!(costSyp >= 0) || !(costUsd >= 0)) {
      setErr('السعر غير صالح')
      return
    }
    const p = providers.find((x) => x.id === providerId)
    if (!p) {
      setErr('اختر الطبيب')
      return
    }
    const row = normalizeTreatment(
      {
        ...emptyTreatment(),
        procedureDescription: description,
        totalCostSyp: costSyp,
        totalCostUsd: costUsd,
        costUsdSypRate: costUsd > 0 ? rate || 0 : 0,
        doctorName: p.name,
        providerUserId: p.id,
        providerKey: p.id === '__elias__' || p.noShare ? 'elias' : '',
        businessDate,
        payments: [],
      },
      rate,
    )
    const ok = await saveAll([...rows, row], labRows)
    if (ok) resetForm()
  }

  async function addLab() {
    const draft = normalizeLabWork(labDraft, rate)
    if (!labWorkHasData(draft)) {
      setErr('أدخل مخبراً ووصفاً أو مبلغاً لسجل المخبر')
      return
    }
    if (!draft.labId && !draft.labName.trim()) {
      setErr('اختر المخبر من القائمة')
      return
    }
    const ok = await saveAll(rows, [...labRows, draft])
    if (ok) resetLabForm()
  }

  async function removeRow(idx: number) {
    if (!canEdit || saving) return
    if (rows[idx]?.billingStatus === 'paid') {
      setErr('لا يمكن حذف إجراء محصّل')
      return
    }
    if (!window.confirm('حذف هذا الإجراء العام؟')) return
    await saveAll(
      rows.filter((_, i) => i !== idx),
      labRows,
    )
  }

  async function removeLab(idx: number) {
    if (!canEdit || saving) return
    if (!window.confirm('حذف سجل المخبر هذا؟')) return
    await saveAll(
      rows,
      labRows.filter((_, i) => i !== idx),
    )
  }

  function selectLabCatalog(labId: string) {
    const lab = labs.find((x) => x.id === labId)
    setLabDraft((prev) =>
      normalizeLabWork(
        {
          ...prev,
          labId: lab ? lab.id : null,
          labName: lab ? lab.name : '',
        },
        rate,
      ),
    )
  }

  function selectLabDoctor(providerKey: string) {
    const p = providers.find((x) => x.id === providerKey)
    setLabDraft((prev) =>
      normalizeLabWork(
        {
          ...prev,
          providerUserId: p ? p.id : null,
          doctorName: p ? p.name : '',
          providerKey: p?.id === '__elias__' || p?.noShare ? 'elias' : '',
        },
        rate,
      ),
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 className="card-title">إجراءات عامة</h2>
      <p style={{ marginTop: '-0.35rem', marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        إجراءات على كامل الفم وليست مرتبطة بسن واحد — مثل التنظيف أو التبييض. يمكن إدخال 0 ل.س أو 0 دولار (مجاني). عند
        إدخال سعر أكبر من صفر مع الطبيب يُرسل البند إلى التحصيل. يمكن أيضاً ربط مخبر بالإجراءات العامة.
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
          {rows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: '0 0 1rem' }}>لا توجد إجراءات عامة بعد.</p>
          ) : (
            <div className="table-wrap" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الوصف</th>
                    <th>الطبيب</th>
                    <th>السعر</th>
                    <th>التحصيل</th>
                    {canEdit ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, idx) => {
                    const effective = treatmentEffectiveTotalSyp(t, rate)
                    const paid = treatmentPaidTotal(t)
                    const paidUsd = treatmentPaidTotalUsd(t)
                    const remaining = treatmentRemaining(t, rate)
                    const statusLabel =
                      t.billingStatus === 'paid' || (paid > 0 && remaining <= 0)
                        ? 'محصّل'
                        : t.billingStatus === 'pending_payment' || t.billingItemId
                          ? 'بانتظار التحصيل'
                          : '—'
                    return (
                      <tr key={t.id || `g-${idx}`}>
                        <td>{t.businessDate || '—'}</td>
                        <td>{t.procedureDescription.trim() || '—'}</td>
                        <td>{t.doctorName || '—'}</td>
                        <td>
                          {effective.toLocaleString('ar-SY')} ل.س
                          {t.totalCostUsd > 0 ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              منها {formatUsdAmount(t.totalCostUsd)} USD
                              {paidUsd > 0 ? ` · محصّل ${formatUsdAmount(paidUsd)} USD` : ''}
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
                              disabled={saving || t.billingStatus === 'paid'}
                              onClick={() => void removeRow(idx)}
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
            <div
              style={{
                display: 'grid',
                gap: '0.65rem',
                padding: '0.85rem',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                marginBottom: '1rem',
              }}
            >
              <strong style={{ fontSize: '0.92rem' }}>إضافة إجراء عام</strong>
              <label className="form-label">وصف الإجراء</label>
              <input
                className="input"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="مثال: تنظيف أسنان / تبييض"
                disabled={saving}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '0.55rem',
                }}
              >
                <div>
                  <label className="form-label">السعر (ل.س)</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={String(costSyp)}
                    onChange={(e) =>
                      setCostSyp(Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)))
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="form-label">السعر (USD)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={String(costUsd)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^\d.]/g, '')
                      setCostUsd(Math.max(0, roundUsd(Number(cleaned) || 0)))
                    }}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="form-label">التاريخ</label>
                  <input
                    className="input"
                    type="date"
                    value={businessDate}
                    onChange={(e) => setBusinessDate(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="form-label">الطبيب</label>
                  <select
                    className="select"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    disabled={saving}
                  >
                    <option value="">— اختر الطبيب —</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => void addProcedure()}
                >
                  {saving
                    ? 'جاري الحفظ…'
                    : costSyp > 0 || costUsd > 0
                      ? 'حفظ وإرسال للتحصيل'
                      : 'حفظ'}
                </button>
              </div>
            </div>
          ) : null}

          <section
            style={{
              marginTop: '0.35rem',
              padding: '0.95rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--bg)',
            }}
          >
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>مخابر الإجراءات العامة</h3>
            <p style={{ margin: '0 0 0.85rem', fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              سجّل أعمال المخبر المرتبطة بإجراء عام (وليست بسن محدد)، مع اختيار المخبر والطبيب والمبلغ.
            </p>

            {labRows.length === 0 ? (
              <p style={{ margin: '0 0 0.75rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                لا سجلات مخابر للإجراءات العامة بعد.
              </p>
            ) : (
              <div className="table-wrap" style={{ marginBottom: '0.85rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المخبر</th>
                      <th>الوصف</th>
                      <th>الطبيب</th>
                      <th>المبلغ</th>
                      {canEdit ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {labRows.map((lab, idx) => {
                      const effective = labEffectiveAmountSyp(lab, rate)
                      return (
                        <tr key={lab.id || `glab-${idx}`}>
                          <td dir="ltr">{lab.businessDate || '—'}</td>
                          <td>{lab.labName || '—'}</td>
                          <td>{lab.procedureDescription.trim() || '—'}</td>
                          <td>{lab.doctorName || '—'}</td>
                          <td>
                            {effective.toLocaleString('ar-SY')} ل.س
                            {lab.amountUsd > 0 ? (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                منها {formatUsdAmount(lab.amountUsd)} USD
                              </div>
                            ) : null}
                          </td>
                          {canEdit ? (
                            <td>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: '0.78rem' }}
                                disabled={saving}
                                onClick={() => void removeLab(idx)}
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
              <div
                style={{
                  display: 'grid',
                  gap: '0.65rem',
                  padding: '0.85rem',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                }}
              >
                <strong style={{ fontSize: '0.92rem' }}>إضافة مخبر لإجراء عام</strong>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '0.55rem',
                  }}
                >
                  <div>
                    <label className="form-label">المخبر</label>
                    {labs.length > 0 ? (
                      <select
                        className="select"
                        value={labDraft.labId || ''}
                        onChange={(e) => selectLabCatalog(e.target.value)}
                        disabled={saving}
                      >
                        <option value="">— اختر مخبر —</option>
                        {labs.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--amber)' }}>
                        لا مخابر في القائمة — أضفها من صفحة «المخابر» أولاً.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="form-label">الطبيب</label>
                    <select
                      className="select"
                      value={labDraft.providerUserId || ''}
                      onChange={(e) => selectLabDoctor(e.target.value)}
                      disabled={saving}
                    >
                      <option value="">—</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">التاريخ</label>
                    <input
                      className="input"
                      type="date"
                      value={labDraft.businessDate || todayIsoDate()}
                      onChange={(e) =>
                        setLabDraft((prev) => normalizeLabWork({ ...prev, businessDate: e.target.value }, rate))
                      }
                      disabled={saving}
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label">وصف العمل</label>
                  <input
                    className="input"
                    value={labDraft.procedureDescription}
                    onChange={(e) =>
                      setLabDraft((prev) =>
                        normalizeLabWork({ ...prev, procedureDescription: e.target.value }, rate),
                      )
                    }
                    placeholder="مثال: طقم متحرك / وجه تجميلي"
                    disabled={saving}
                  />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '0.55rem',
                  }}
                >
                  <div>
                    <label className="form-label">المبلغ (ل.س)</label>
                    <input
                      className="input"
                      inputMode="numeric"
                      dir="ltr"
                      value={String(Math.max(0, Number(labDraft.amountSyp) || 0))}
                      onChange={(e) =>
                        setLabDraft((prev) =>
                          normalizeLabWork(
                            {
                              ...prev,
                              amountSyp: Math.max(
                                0,
                                Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0),
                              ),
                            },
                            rate,
                          ),
                        )
                      }
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="form-label">المبلغ (USD)</label>
                    <input
                      className="input"
                      inputMode="decimal"
                      dir="ltr"
                      value={String(labDraft.amountUsd || 0)}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^\d.]/g, '')
                        const n = Math.max(0, roundUsd(Number(cleaned) || 0))
                        setLabDraft((prev) =>
                          normalizeLabWork(
                            {
                              ...prev,
                              amountUsd: n,
                              usdSypRate: n > 0 ? rate || prev.usdSypRate || 0 : 0,
                            },
                            rate,
                          ),
                        )
                      }}
                      disabled={saving}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving || labs.length === 0}
                    onClick={() => void addLab()}
                  >
                    {saving ? 'جاري الحفظ…' : 'حفظ المخبر'}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}
