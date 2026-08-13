import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useClinic } from '../../context/ClinicContext'
import {
  emptyTreatment,
  formatUsdAmount,
  normalizeTreatment,
  roundUsd,
  treatmentEffectiveTotalSyp,
  treatmentHasData,
  treatmentPaidTotal,
  treatmentPaidTotalUsd,
  treatmentRemaining,
  type DentalChartDto,
  type DentalToothTreatment,
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

export function DentalGeneralProcedures({ patientId, canEdit }: Props) {
  const { usdSypRate } = useClinic()
  const rate = usdSypRate != null && usdSypRate > 0 ? usdSypRate : null

  const [rows, setRows] = useState<DentalToothTreatment[]>([])
  const [providers, setProviders] = useState<DentalProviderOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [desc, setDesc] = useState('')
  const [costSyp, setCostSyp] = useState(0)
  const [costUsd, setCostUsd] = useState(0)
  const [providerId, setProviderId] = useState('')
  const [businessDate, setBusinessDate] = useState(todayIsoDate)

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
      const list = (chartRes.chart?.generalTreatments || []).map((t) => normalizeTreatment(t, rate))
      setRows(list.filter(treatmentHasData))
    } catch (e) {
      setRows([])
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

  async function saveList(next: DentalToothTreatment[]) {
    setSaving(true)
    setErr('')
    setOkMsg('')
    try {
      const payload = next
        .map((t) =>
          normalizeTreatment({
            ...t,
            procedureDescription: String(t.procedureDescription || '').trim(),
          }),
        )
        .filter(treatmentHasData)
      const data = await api<{ chart: DentalChartDto }>(
        `/api/dental/chart/${encodeURIComponent(patientId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ generalTreatments: payload }),
        },
      )
      const list = (data.chart?.generalTreatments || []).map((t) => normalizeTreatment(t, rate))
      setRows(list.filter(treatmentHasData))
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
    const ok = await saveList([...rows, row])
    if (ok) resetForm()
  }

  async function removeRow(idx: number) {
    if (!canEdit || saving) return
    if (rows[idx]?.billingStatus === 'paid') {
      setErr('لا يمكن حذف إجراء محصّل')
      return
    }
    if (!window.confirm('حذف هذا الإجراء العام؟')) return
    const next = rows.filter((_, i) => i !== idx)
    await saveList(next)
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 className="card-title">إجراءات عامة</h2>
      <p style={{ marginTop: '-0.35rem', marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        إجراءات على كامل الفم وليست مرتبطة بسن واحد — مثل التنظيف أو التبييض. يمكن إدخال 0 ل.س أو 0 دولار (مجاني). عند
        إدخال سعر أكبر من صفر مع الطبيب يُرسل البند إلى التحصيل.
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
        </>
      )}
    </div>
  )
}
