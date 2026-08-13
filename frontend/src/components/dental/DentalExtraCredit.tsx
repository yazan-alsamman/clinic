import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useClinic } from '../../context/ClinicContext'
import { formatUsdAmount, roundUsd } from './dentalChartTypes'

type CreditItem = {
  id: string
  procedureLabel: string
  amountDueSyp: number
  amountDueUsd: number
  currency: string
  status: string
  businessDate: string
}

type Props = {
  patientId: string
  canEdit: boolean
  prepaidCreditSyp: number
  onCreditChange?: (prepaidCreditSyp: number) => void
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function DentalExtraCredit({ patientId, canEdit, prepaidCreditSyp, onCreditChange }: Props) {
  const { usdSypRate, businessDate: clinicBusinessDate } = useClinic()
  const [items, setItems] = useState<CreditItem[]>([])
  const [creditSyp, setCreditSyp] = useState(Math.max(0, Math.round(prepaidCreditSyp || 0)))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [amountSyp, setAmountSyp] = useState(0)
  const [amountUsd, setAmountUsd] = useState(0)
  const [businessDate, setBusinessDate] = useState(clinicBusinessDate || todayIsoDate())
  const onCreditChangeRef = useRef(onCreditChange)
  onCreditChangeRef.current = onCreditChange

  const load = useCallback(async () => {
    setErr('')
    setLoading(true)
    try {
      const data = await api<{ prepaidCreditSyp: number; items: CreditItem[] }>(
        `/api/dental/credit-topup/${encodeURIComponent(patientId)}`,
      )
      const nextCredit = Math.max(0, Math.round(Number(data.prepaidCreditSyp) || 0))
      setCreditSyp(nextCredit)
      setItems(Array.isArray(data.items) ? data.items : [])
      onCreditChangeRef.current?.(nextCredit)
    } catch (e) {
      setItems([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الرصيد الإضافي')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (clinicBusinessDate) setBusinessDate(clinicBusinessDate)
  }, [clinicBusinessDate])

  async function addCredit() {
    if (!(amountSyp > 0) && !(amountUsd > 0)) {
      setErr('أدخل مبلغ الرصيد بالليرة أو بالدولار')
      return
    }
    if (amountUsd > 0 && !(usdSypRate != null && usdSypRate > 0)) {
      setErr('سعر صرف الدولار غير متوفر — أدخل المبلغ بالليرة أو فعّل يوم العمل')
      return
    }
    setSaving(true)
    setErr('')
    setOkMsg('')
    try {
      await api(`/api/dental/credit-topup/${encodeURIComponent(patientId)}`, {
        method: 'POST',
        body: JSON.stringify({
          amountSyp,
          amountUsd,
          businessDate,
        }),
      })
      setAmountSyp(0)
      setAmountUsd(0)
      setOkMsg('تم إرسال الرصيد إلى التحصيل — يُضاف لمحفظة المريض بعد القبض، ثم يُخصم عند تحصيل الإجراءات.')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر إضافة الرصيد الإضافي')
    } finally {
      setSaving(false)
    }
  }

  async function cancelItem(id: string) {
    if (!canEdit || saving) return
    if (!window.confirm('إلغاء بند الرصيد المعلّق؟')) return
    setSaving(true)
    setErr('')
    setOkMsg('')
    try {
      await api(`/api/dental/credit-topup/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setOkMsg('تم إلغاء البند المعلّق.')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر إلغاء البند')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 className="card-title">رصيد إضافي</h2>
      <p style={{ marginTop: '-0.35rem', marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        أدخل مبلغاً بالليرة أو بالدولار ليظهر فوراً في التحصيل. بعد قبضه يُضاف لرصيد المريض، ويُخصم تلقائياً عند تحصيل
        إجراءات الأسنان حتى يصبح الرصيد صفراً.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1rem',
          alignItems: 'baseline',
        }}
      >
        <span className="form-label" style={{ margin: 0 }}>
          الرصيد الحالي
        </span>
        <strong style={{ fontSize: '1.15rem', color: creditSyp > 0 ? 'var(--success)' : undefined }}>
          {creditSyp.toLocaleString('ar-SY')} ل.س
        </strong>
      </div>

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
          {items.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: '0 0 1rem' }}>لا توجد عمليات رصيد إضافي بعد.</p>
          ) : (
            <div className="table-wrap" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الوصف</th>
                    <th>المبلغ</th>
                    <th>الحالة</th>
                    {canEdit ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const pending = row.status === 'pending_payment'
                    return (
                      <tr key={row.id}>
                        <td>{row.businessDate || '—'}</td>
                        <td>{row.procedureLabel || 'رصيد إضافي'}</td>
                        <td>
                          {Math.round(Number(row.amountDueSyp) || 0).toLocaleString('ar-SY')} ل.س
                          {row.amountDueUsd > 0 ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {formatUsdAmount(row.amountDueUsd)} USD
                            </div>
                          ) : null}
                        </td>
                        <td
                          style={{
                            color: pending ? 'var(--warning)' : 'var(--success)',
                            fontWeight: 600,
                          }}
                        >
                          {pending ? 'بانتظار التحصيل' : 'محصّل — أُضيف للرصيد'}
                        </td>
                        {canEdit ? (
                          <td>
                            {pending ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: '0.78rem' }}
                                disabled={saving}
                                onClick={() => void cancelItem(row.id)}
                              >
                                إلغاء
                              </button>
                            ) : null}
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
              <strong style={{ fontSize: '0.92rem' }}>إضافة رصيد إضافي</strong>
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
                    value={String(amountSyp)}
                    onChange={(e) =>
                      setAmountSyp(Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)))
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="form-label">المبلغ (USD)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={String(amountUsd)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^\d.]/g, '')
                      setAmountUsd(Math.max(0, roundUsd(Number(cleaned) || 0)))
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
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => void addCredit()}
                >
                  {saving ? 'جاري الحفظ…' : 'حفظ وإرسال للتحصيل'}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
