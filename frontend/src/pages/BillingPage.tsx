import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type Item = {
  id: string
  patientName: string
  providerName: string
  department: string
  procedureLabel: string
  amountDueUsd: number
  status: string
  businessDate?: string
}

const BILLING_ROLES = ['super_admin', 'reception'] as const

const deptLabel: Record<string, string> = {
  laser: 'ليزر',
  dermatology: 'جلدية',
  dental: 'أسنان',
}

export function BillingPage() {
  const { user } = useAuth()
  const { businessDate, usdSypRate } = useClinic()
  const allowed = BILLING_ROLES.includes(user?.role as (typeof BILLING_ROLES)[number])

  const [date, setDate] = useState('')
  const [viewAllPending, setViewAllPending] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'other'>('cash')
  const [payOpen, setPayOpen] = useState(false)
  const [payItem, setPayItem] = useState<Item | null>(null)
  const [payUsd, setPayUsd] = useState('')
  const [paySyp, setPaySyp] = useState('')

  useEffect(() => {
    if (businessDate && !date) setDate(businessDate)
  }, [businessDate, date])

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    try {
      setLoading(true)
      if (viewAllPending && user?.role === 'super_admin') {
        const data = await api<{ items: Item[] }>('/api/billing/pending-all?limit=100')
        setItems(data.items)
        return
      }
      if (!date) {
        setItems([])
        return
      }
      const data = await api<{ items: Item[] }>(
        `/api/billing/pending?date=${encodeURIComponent(date)}`,
      )
      setItems(data.items)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر التحميل')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [allowed, date, user?.role, viewAllPending])

  useEffect(() => {
    void load()
  }, [load])

  async function completePay(id: string) {
    setBusyId(id)
    setErr('')
    try {
      const usd = Number(payUsd)
      const syp = Number(paySyp)
      await api(`/api/billing/${encodeURIComponent(id)}/complete-payment`, {
        method: 'POST',
        body: JSON.stringify({
          method,
          amountUsd: Number.isFinite(usd) && usd > 0 ? usd : undefined,
          amountSyp: Number.isFinite(syp) && syp > 0 ? syp : undefined,
        }),
      })
      setPayOpen(false)
      setPayItem(null)
      setPayUsd('')
      setPaySyp('')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'فشل التحصيل')
    } finally {
      setBusyId(null)
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">التحصيل</h1>
        <p className="page-desc">للاستقبال والمدير فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">بنود بانتظار التحصيل</h1>
      <p className="page-desc">بعد تأكيد استلام الدفع يُنشأ الترحيل المحاسبي تلقائياً.</p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'flex-end',
          marginTop: '0.5rem',
        }}
      >
        {user?.role === 'super_admin' ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={viewAllPending}
              onChange={(e) => setViewAllPending(e.target.checked)}
            />
            <span style={{ fontSize: '0.9rem' }}>عرض كل المعلّقة (أي تاريخ)</span>
          </label>
        ) : null}
        {!viewAllPending ? (
          <label>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
              تاريخ يوم العمل
            </span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        ) : null}
        <label>
          <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
            طريقة الدفع
          </span>
          <select
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            <option value="cash">نقد</option>
            <option value="card">بطاقة</option>
            <option value="transfer">تحويل</option>
            <option value="other">أخرى</option>
          </select>
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          تحديث
        </button>
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '1rem' }}>{err}</p> : null}

      {loading ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0 }}>جاري التحميل…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>لا توجد بنود معلّقة.</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
          {items.map((b) => (
            <li key={b.id} className="card">
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <strong>{b.patientName || 'مريض'}</strong>
                  <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>
                    {deptLabel[b.department] ?? b.department}
                  </span>
                  {b.businessDate ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      — {b.businessDate}
                    </span>
                  ) : null}
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    {b.procedureLabel} — المقدّم: {b.providerName || '—'}
                  </p>
                  <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
                    {b.amountDueUsd} USD
                    {usdSypRate && usdSypRate > 0 ? (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                        {' '}
                        — {(Number(b.amountDueUsd || 0) * Number(usdSypRate)).toLocaleString('en-US')} ل.س
                      </span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyId === b.id}
                  onClick={() => {
                    setPayItem(b)
                    setPayUsd(String(Number(b.amountDueUsd || 0)))
                    setPaySyp('')
                    setPayOpen(true)
                  }}
                >
                  {busyId === b.id ? '…' : 'تأكيد استلام الدفع'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {payOpen && payItem ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPayOpen(false)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>تأكيد استلام الدفع</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '-0.2rem' }}>
              {payItem.patientName} — {payItem.procedureLabel}
            </p>
            <p style={{ margin: '0.35rem 0', fontWeight: 600 }}>
              سعر الجلسة: {payItem.amountDueUsd} USD
              {usdSypRate && usdSypRate > 0 ? (
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                  {' '}
                  — {(Number(payItem.amountDueUsd || 0) * Number(usdSypRate)).toLocaleString('en-US')} ل.س
                </span>
              ) : null}
            </p>
            <div className="grid-2" style={{ marginTop: '0.5rem' }}>
              <div>
                <label className="form-label">المبلغ المستلم (USD)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={payUsd}
                  onChange={(e) => setPayUsd(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="form-label">المبلغ المستلم (SYP)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={paySyp}
                  onChange={(e) => setPaySyp(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              يكفي إدخال أحد الحقلين.
            </p>
            {(() => {
              const usd = Number(payUsd)
              const syp = Number(paySyp)
              const rate = Number(usdSypRate || 0)
              const receivedUsd =
                Number.isFinite(usd) && usd > 0
                  ? usd
                  : Number.isFinite(syp) && syp > 0 && rate > 0
                    ? syp / rate
                    : 0
              const due = Number(payItem.amountDueUsd || 0)
              if (!(receivedUsd > 0) || !(due > 0)) return null
              const delta = receivedUsd - due
              if (delta < -0.0001) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--warning)' }}>
                    المبلغ أقل من سعر الجلسة — سيتم تسجيل الباقي كذمة على المريض ({Math.abs(delta).toFixed(2)} USD).
                  </p>
                )
              }
              if (delta > 0.0001) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--success)' }}>
                    المبلغ أعلى من سعر الجلسة — سيتم تسجيل الزيادة كرصيد إضافي للمريض ({delta.toFixed(2)} USD).
                  </p>
                )
              }
              return (
                <p style={{ marginTop: '0.45rem', color: 'var(--text-muted)' }}>
                  المبلغ مطابق لسعر الجلسة.
                </p>
              )
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setPayOpen(false)}>
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyId === payItem.id}
                onClick={() => void completePay(payItem.id)}
              >
                {busyId === payItem.id ? 'جاري الحفظ…' : 'تأكيد استلام الدفع'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
