import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'
import {
  netReceivedSypAfterUsdCollection,
  settlementDeltaAfterUsdNoRefundAbsorb,
  usdRoundedUpCashOffer,
} from '../utils/usdExactDue'

type Item = {
  id: string
  patientId: string
  patientName: string
  providerName: string
  department: string
  procedureLabel: string
  amountDueSyp: number
  status: string
  businessDate?: string
  /** سعر USD لتاريخ البند من الخادم (يطابق complete-payment) */
  usdSypBusinessDayRate?: number | null
  isPackagePrepaid?: boolean
  patientPackageId?: string
  patientPackageSessionId?: string
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
  const [packageBusyId, setPackageBusyId] = useState<string | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payItem, setPayItem] = useState<Item | null>(null)
  const [paySyp, setPaySyp] = useState('')
  const [payUsd, setPayUsd] = useState('')
  const [payCurrency, setPayCurrency] = useState<'SYP' | 'USD'>('SYP')
  const [payChannel, setPayChannel] = useState<'cash' | 'bank'>('cash')
  const [payBankName, setPayBankName] = useState('')
  const [bankOptions, setBankOptions] = useState<{ id: string; name: string }[]>([])
  /** عند التحصيل بالدولار: توثيق ما رُدّ للمريض (ل.س أو USD) */
  const [payRefundCurrency, setPayRefundCurrency] = useState<'SYP' | 'USD'>('SYP')
  const [payRefundAmount, setPayRefundAmount] = useState('')

  useEffect(() => {
    if (businessDate && !date) setDate(businessDate)
  }, [businessDate, date])

  useEffect(() => {
    if (!payOpen || !allowed) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ banks: { id: string; name: string }[] }>('/api/billing/payment-bank-options')
        if (!cancelled) setBankOptions(data.banks || [])
      } catch {
        if (!cancelled) setBankOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payOpen, allowed])

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
    setErr('')
    if (payItem && Math.round(Number(payItem.amountDueSyp) || 0) <= 0) {
      setErr('لا يوجد مبلغ مستحق على هذا البند — راجع التسعير في ملف المريض.')
      return
    }
    if (payChannel === 'bank' && !payBankName.trim()) {
      setErr('اختر البنك ثم أدخل المبلغ المستلم.')
      return
    }
    if (payCurrency === 'SYP') {
      const syp = Number(normalizeDecimalDigits(paySyp))
      if (!Number.isFinite(syp) || syp <= 0) {
        setErr('أدخل مبلغاً صالحاً بالليرة السورية.')
        return
      }
    } else {
      const usd = parseFloat(normalizeDecimalDigits(payUsd))
      if (!Number.isFinite(usd) || usd <= 0) {
        setErr('أدخل مبلغاً صالحاً بالدولار.')
        return
      }
      if (payRefundAmount.trim()) {
        const ref =
          payRefundCurrency === 'SYP'
            ? Number(normalizeDecimalDigits(payRefundAmount))
            : parseFloat(normalizeDecimalDigits(payRefundAmount))
        if (!Number.isFinite(ref) || ref < 0) {
          setErr('مبلغ الترجيع غير صالح — أدخل رقماً صحيحاً أو افرغ الحقل.')
          return
        }
      }
      if (payPreviewRate && payPreviewRate > 0) {
        const usdG = parseFloat(normalizeDecimalDigits(payUsd))
        if (Number.isFinite(usdG) && usdG > 0) {
          const grossSyp = Math.round(usdG * payPreviewRate)
          let refSyp = 0
          let refUsd = 0
          if (payRefundAmount.trim()) {
            if (payRefundCurrency === 'SYP') {
              refSyp = Math.round(Number(normalizeDecimalDigits(payRefundAmount)) || 0)
            } else {
              refUsd = parseFloat(normalizeDecimalDigits(payRefundAmount)) || 0
            }
          }
          const refEquiv = refSyp + Math.round(refUsd * payPreviewRate)
          if (refEquiv > grossSyp) {
            setErr('إجمالي الترجيع (ليرة ومقابل دولار) لا يمكن أن يتجاوز المبلغ المستلم.')
            return
          }
          const netSyp = netReceivedSypAfterUsdCollection({
            amountUsd: usdG,
            patientRefundSyp: refSyp,
            patientRefundUsd: refUsd,
            rate: payPreviewRate,
          })
          if (netSyp <= 0) {
            setErr('صافي المبلغ بعد الترجيع يجب أن يكون أكبر من صفر.')
            return
          }
        }
      }
    }
    setBusyId(id)
    try {
      const syp = Number(normalizeDecimalDigits(paySyp))
      const usd = parseFloat(normalizeDecimalDigits(payUsd))
      const refundTrim = payRefundAmount.trim()
      const refundPayload =
        payCurrency === 'USD' && refundTrim
          ? {
              refundCurrency: payRefundCurrency,
              refundAmount:
                payRefundCurrency === 'SYP'
                  ? Number(normalizeDecimalDigits(payRefundAmount))
                  : parseFloat(normalizeDecimalDigits(payRefundAmount)),
            }
          : payCurrency === 'USD'
            ? { refundCurrency: payRefundCurrency }
            : {}
      await api(`/api/billing/${encodeURIComponent(id)}/complete-payment`, {
        method: 'POST',
        body: JSON.stringify({
          payCurrency,
          paymentChannel: payChannel,
          bankName: payChannel === 'bank' ? payBankName.trim() : undefined,
          amountSyp:
            payCurrency === 'SYP' && Number.isFinite(syp) && syp > 0 ? Math.round(syp) : undefined,
          amountUsd: payCurrency === 'USD' && Number.isFinite(usd) && usd > 0 ? usd : undefined,
          ...refundPayload,
        }),
      })
      setPayOpen(false)
      setPayItem(null)
      setPaySyp('')
      setPayUsd('')
      setPayCurrency('SYP')
      setPayChannel('cash')
      setPayBankName('')
      setPayRefundCurrency('SYP')
      setPayRefundAmount('')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'فشل التحصيل')
    } finally {
      setBusyId(null)
    }
  }

  /** دفع إضافات خارج الباكج ثم إنقاص جلسة الباكج في خطوة واحدة */
  async function completePackageAddonPayAndConsume() {
    if (!payItem) return
    const pkgId = payItem.patientPackageId
    const sessId = payItem.patientPackageSessionId
    const patientId = payItem.patientId
    if (!pkgId || !sessId || !patientId) {
      setErr('تعذر تحديد جلسة الباكج المرتبطة بهذا البند.')
      return
    }
    setErr('')
    if (payChannel === 'bank' && !payBankName.trim()) {
      setErr('اختر البنك ثم أدخل المبلغ المستلم.')
      return
    }
    if (payCurrency === 'SYP') {
      const syp = Number(normalizeDecimalDigits(paySyp))
      if (!Number.isFinite(syp) || syp <= 0) {
        setErr('أدخل مبلغاً صالحاً بالليرة السورية.')
        return
      }
    } else {
      const usd = parseFloat(normalizeDecimalDigits(payUsd))
      if (!Number.isFinite(usd) || usd <= 0) {
        setErr('أدخل مبلغاً صالحاً بالدولار.')
        return
      }
      if (payRefundAmount.trim()) {
        const ref =
          payRefundCurrency === 'SYP'
            ? Number(normalizeDecimalDigits(payRefundAmount))
            : parseFloat(normalizeDecimalDigits(payRefundAmount))
        if (!Number.isFinite(ref) || ref < 0) {
          setErr('مبلغ الترجيع غير صالح — أدخل رقماً صحيحاً أو افرغ الحقل.')
          return
        }
      }
      if (payPreviewRate && payPreviewRate > 0) {
        const usdG = parseFloat(normalizeDecimalDigits(payUsd))
        if (Number.isFinite(usdG) && usdG > 0) {
          const grossSyp = Math.round(usdG * payPreviewRate)
          let refSyp = 0
          let refUsd = 0
          if (payRefundAmount.trim()) {
            if (payRefundCurrency === 'SYP') {
              refSyp = Math.round(Number(normalizeDecimalDigits(payRefundAmount)) || 0)
            } else {
              refUsd = parseFloat(normalizeDecimalDigits(payRefundAmount)) || 0
            }
          }
          const refEquiv = refSyp + Math.round(refUsd * payPreviewRate)
          if (refEquiv > grossSyp) {
            setErr('إجمالي الترجيع (ليرة ومقابل دولار) لا يمكن أن يتجاوز المبلغ المستلم.')
            return
          }
          const netSyp = netReceivedSypAfterUsdCollection({
            amountUsd: usdG,
            patientRefundSyp: refSyp,
            patientRefundUsd: refUsd,
            rate: payPreviewRate,
          })
          if (netSyp <= 0) {
            setErr('صافي المبلغ بعد الترجيع يجب أن يكون أكبر من صفر.')
            return
          }
        }
      }
    }
    setBusyId(payItem.id)
    try {
      const syp = Number(normalizeDecimalDigits(paySyp))
      const usd = parseFloat(normalizeDecimalDigits(payUsd))
      const refundTrim = payRefundAmount.trim()
      const refundPayload =
        payCurrency === 'USD' && refundTrim
          ? {
              refundCurrency: payRefundCurrency,
              refundAmount:
                payRefundCurrency === 'SYP'
                  ? Number(normalizeDecimalDigits(payRefundAmount))
                  : parseFloat(normalizeDecimalDigits(payRefundAmount)),
            }
          : payCurrency === 'USD'
            ? { refundCurrency: payRefundCurrency }
            : {}
      await api(`/api/billing/${encodeURIComponent(payItem.id)}/complete-payment`, {
        method: 'POST',
        body: JSON.stringify({
          payCurrency,
          paymentChannel: payChannel,
          bankName: payChannel === 'bank' ? payBankName.trim() : undefined,
          amountSyp:
            payCurrency === 'SYP' && Number.isFinite(syp) && syp > 0 ? Math.round(syp) : undefined,
          amountUsd: payCurrency === 'USD' && Number.isFinite(usd) && usd > 0 ? usd : undefined,
          ...refundPayload,
        }),
      })
      await api(
        `/api/patients/${encodeURIComponent(patientId)}/packages/${encodeURIComponent(pkgId)}/sessions/${encodeURIComponent(sessId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ completed: true }),
        },
      )
      setPayOpen(false)
      setPayItem(null)
      setPaySyp('')
      setPayUsd('')
      setPayCurrency('SYP')
      setPayChannel('cash')
      setPayBankName('')
      setPayRefundCurrency('SYP')
      setPayRefundAmount('')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'فشل إنقاص الجلسة والدفع')
    } finally {
      setBusyId(null)
    }
  }

  async function consumePackageSession(item: Item) {
    if (!item.patientId || !item.patientPackageId || !item.patientPackageSessionId) {
      setErr('تعذر تحديد جلسة الباكج المرتبطة بهذا البند.')
      return
    }
    setPackageBusyId(item.id)
    setErr('')
    try {
      await api(
        `/api/patients/${encodeURIComponent(item.patientId)}/packages/${encodeURIComponent(
          item.patientPackageId,
        )}/sessions/${encodeURIComponent(item.patientPackageSessionId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ completed: true }),
        },
      )
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر إنقاص جلسة الباكج')
    } finally {
      setPackageBusyId(null)
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

  const payPreviewRate = (() => {
    const fromItem = payItem?.usdSypBusinessDayRate != null ? Number(payItem.usdSypBusinessDayRate) : NaN
    if (payItem && Number.isFinite(fromItem) && fromItem > 0) return fromItem
    if (
      payItem?.businessDate &&
      businessDate &&
      payItem.businessDate === businessDate &&
      usdSypRate != null &&
      usdSypRate > 0
    )
      return usdSypRate
    return null
  })()
  const dueSypRounded = payItem ? Math.round(Number(payItem.amountDueSyp || 0)) : 0
  const usdCashOffer =
    payPreviewRate && dueSypRounded > 0 ? usdRoundedUpCashOffer(dueSypRounded, payPreviewRate) : null

  function applyUsdCashOfferFill() {
    if (!payPreviewRate || !usdCashOffer) return
    setPayUsd(usdCashOffer.usdFieldValue)
    setPayRefundCurrency('SYP')
    setPayRefundAmount(usdCashOffer.impliedRefundSyp > 0 ? String(usdCashOffer.impliedRefundSyp) : '')
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
                    {Number(b.amountDueSyp || 0).toLocaleString('ar-SY')} ل.س
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {b.isPackagePrepaid && (Number(b.amountDueSyp) || 0) > 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyId === b.id}
                      onClick={() => {
                        setPayItem(b)
                        setPaySyp(String(Number(b.amountDueSyp || 0)))
                        setPayUsd('')
                        setPayCurrency('SYP')
                        setPayChannel('cash')
                        setPayBankName('')
                        setPayRefundCurrency('SYP')
                        setPayRefundAmount('')
                        setPayOpen(true)
                      }}
                    >
                      {busyId === b.id ? 'جاري المعالجة…' : 'إنقاص جلسة و دفع'}
                    </button>
                  ) : null}
                  {b.isPackagePrepaid && (Number(b.amountDueSyp) || 0) <= 0 ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={packageBusyId === b.id}
                      onClick={() => void consumePackageSession(b)}
                    >
                      {packageBusyId === b.id ? 'جاري الإنقاص…' : 'إنقاص جلسة'}
                    </button>
                  ) : null}
                  {!b.isPackagePrepaid && (Number(b.amountDueSyp) || 0) > 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyId === b.id}
                      onClick={() => {
                        setPayItem(b)
                        setPaySyp(String(Number(b.amountDueSyp || 0)))
                        setPayUsd('')
                        setPayCurrency('SYP')
                        setPayChannel('cash')
                        setPayBankName('')
                        setPayRefundCurrency('SYP')
                        setPayRefundAmount('')
                        setPayOpen(true)
                      }}
                    >
                      {busyId === b.id ? '…' : 'تأكيد استلام الدفع'}
                    </button>
                  ) : !b.isPackagePrepaid && (Number(b.amountDueSyp) || 0) <= 0 ? (
                    <span className="chip" style={{ background: 'var(--warning-dim)', color: 'var(--amber)' }}>
                      مستحق ٠ — راجع الملف
                    </span>
                  ) : null}
                </div>
                {b.isPackagePrepaid && (Number(b.amountDueSyp) || 0) > 0 ? (
                  <p style={{ margin: '0.35rem 0 0', color: 'var(--warning)', fontSize: '0.82rem' }}>
                    جلسة باكج مع مناطق إضافية خارج الباكج — استخدم «إنقاص جلسة و دفع» لتسجيل الدفعة ثم خصم جلسة من
                    الباكج.
                  </p>
                ) : b.isPackagePrepaid ? (
                  <p style={{ margin: '0.35rem 0 0', color: 'var(--warning)', fontSize: '0.82rem' }}>
                    هذه الجلسة مدفوعة مسبقاً — تأكد من إتمام جلسة من ضمن الباكج لهذا المريض.
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {payOpen && payItem ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setPayOpen(false)
            setPayRefundCurrency('SYP')
            setPayRefundAmount('')
          }}
        >
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {payItem.isPackagePrepaid && (Number(payItem.amountDueSyp) || 0) > 0
                ? 'إنقاص جلسة باكج ودفع الإضافات'
                : 'تأكيد استلام الدفع'}
            </h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '-0.2rem' }}>
              {payItem.patientName} — {payItem.procedureLabel}
            </p>
            <p style={{ margin: '0.35rem 0', fontWeight: 600 }}>
              المستحق: {Number(payItem.amountDueSyp || 0).toLocaleString('ar-SY')} ل.س
            </p>
            {payPreviewRate && Math.round(Number(payItem.amountDueSyp || 0)) > 0 ? (
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }} dir="ltr">
                يعادل المستحق المحفوظ للبند:{' '}
                {(Math.round(Number(payItem.amountDueSyp || 0)) / payPreviewRate).toLocaleString('en-US', {
                  maximumFractionDigits: 6,
                })}{' '}
                USD عند سعر {payPreviewRate.toLocaleString('ar-SY')} ل.س لكل 1 USD
              </p>
            ) : null}
            {payPreviewRate != null && usdCashOffer ? (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                وفق سعر اليوم ({payPreviewRate.toLocaleString('ar-SY')} ل.س لكل 1 USD): اقتراح عملي — استلام{' '}
                <strong dir="ltr">{usdCashOffer.usdFieldValue}</strong> USD
                {usdCashOffer.impliedRefundSyp > 0 ? (
                  <>
                    {' '}
                    ثم ترجيع <strong>{usdCashOffer.impliedRefundSyp.toLocaleString('ar-SY')}</strong> ل.س فيُحسب الصافي
                    مطابقاً للمستحق دون رصيد إضافي — اضغط «تعبئة المبلغ» لتعبئة المستلم والترجيع معاً.
                  </>
                ) : (
                  <> يطابق المستحق بالليرة. استخدم «تعبئة المبلغ» لتعبئة الحقل.</>
                )}
              </p>
            ) : payItem.businessDate && businessDate && payItem.businessDate !== businessDate ? (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
                تاريخ البند يختلف عن يوم العمل الحالي — عند الدفع بالدولار يُستخدم سعر الصرف المحفوظ لذلك التاريخ.
              </p>
            ) : payCurrency === 'USD' && !payPreviewRate ? (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
                لا يتوفر سعر صرف في الواجهة لهذا البند — سيتحقق الخادم من السعر المحفوظ لتاريخ البند.
              </p>
            ) : null}
            {Math.round(Number(payItem.amountDueSyp) || 0) <= 0 ? (
              <p style={{ color: 'var(--danger)', marginTop: '0.35rem', fontSize: '0.88rem' }}>
                لا يمكن تأكيد الدفع: المستحق صفر. أغلق النافذة وراجع تسعير الجلسة في ملف المريض.
              </p>
            ) : null}
            <div style={{ marginTop: '0.55rem' }}>
              <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
                عملة التحصيل
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-currency"
                    checked={payCurrency === 'SYP'}
                    onChange={() => {
                      setPayCurrency('SYP')
                      setPaySyp(String(Math.round(Number(payItem.amountDueSyp || 0))))
                      setPayRefundCurrency('SYP')
                      setPayRefundAmount('')
                    }}
                  />
                  ليرة سورية
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-currency"
                    checked={payCurrency === 'USD'}
                    onChange={() => {
                      setPayCurrency('USD')
                      if (payPreviewRate && dueSypRounded > 0) {
                        const o = usdRoundedUpCashOffer(dueSypRounded, payPreviewRate)
                        if (o) {
                          setPayUsd(o.usdFieldValue)
                          setPayRefundCurrency('SYP')
                          setPayRefundAmount('')
                        } else {
                          setPayUsd('')
                          setPayRefundAmount('')
                        }
                      } else {
                        setPayUsd('')
                        setPayRefundAmount('')
                      }
                    }}
                  />
                  دولار أمريكي (USD)
                </label>
              </div>
            </div>
            <div style={{ marginTop: '0.55rem' }}>
              <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
                طريقة استلام الدفع
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-channel"
                    checked={payChannel === 'cash'}
                    onChange={() => {
                      setPayChannel('cash')
                      setPayBankName('')
                    }}
                  />
                  كاش
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-channel"
                    checked={payChannel === 'bank'}
                    onChange={() => setPayChannel('bank')}
                  />
                  بنك
                </label>
              </div>
            </div>
            {payChannel === 'bank' ? (
              <div style={{ marginTop: '0.55rem' }}>
                <label className="form-label" htmlFor="pay-bank-select">
                  البنك
                </label>
                <select
                  id="pay-bank-select"
                  className="select"
                  value={payBankName}
                  onChange={(e) => setPayBankName(e.target.value)}
                  style={{ maxWidth: '100%', marginTop: '0.25rem' }}
                >
                  <option value="">— اختر البنك —</option>
                  {bankOptions.map((bk) => (
                    <option key={bk.id} value={bk.name}>
                      {bk.name}
                    </option>
                  ))}
                </select>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  بعد اختيار البنك، أدخل المبلغ المستلم {payCurrency === 'USD' ? 'بالدولار' : 'بالليرة'} أدناه.
                </p>
              </div>
            ) : null}
            <div style={{ marginTop: '0.5rem' }}>
              {payCurrency === 'SYP' ? (
                <>
                  <label className="form-label">المبلغ المستلم (ل.س)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={paySyp}
                    onChange={(e) => setPaySyp(e.target.value)}
                    placeholder="0"
                    style={{ marginTop: '0.25rem', maxWidth: 280 }}
                  />
                </>
              ) : (
                <>
                  <label className="form-label">المبلغ المستلم (USD)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    step="any"
                    value={payUsd}
                    onChange={(e) => setPayUsd(e.target.value)}
                    placeholder="0"
                    style={{ marginTop: '0.25rem', maxWidth: 320 }}
                  />
                  {payPreviewRate && dueSypRounded > 0 && usdCashOffer ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}
                      onClick={() => applyUsdCashOfferFill()}
                    >
                      تعبئة المبلغ (دولار مُقرّب + ترجيع ليرة عند الحاجة)
                    </button>
                  ) : null}
                  {payPreviewRate ? (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      المقابل بالليرة = المبلغ بالدولار × {payPreviewRate.toLocaleString('ar-SY')} (تقريب أقرب ليرة). إن
                      احتجت دولاراً مُقرّباً مع ترجيع بالليرة لمطابقة المستحق دون رصيد زائد، استخدم زر «تعبئة المبلغ»؛
                      وإلا اترك الترجيع فارغاً (مثلاً قبض المبلغ بالدولار فقط عندما يكفي ذلك).
                    </p>
                  ) : null}
                  <div
                    style={{
                      marginTop: '0.65rem',
                      paddingTop: '0.65rem',
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <span className="form-label" style={{ display: 'block', marginBottom: '0.25rem' }}>
                      ترجيع
                    </span>
                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      المبلغ الذي رُدّ للمريض بعد التحصيل (إن وُجد). يُطرح من المستلم لحساب الصافي مقابل المستحق ولن
                      يُسجَّل رصيد إضافي إذا كان الصافي يطابق المستحق.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="refund-currency"
                          checked={payRefundCurrency === 'SYP'}
                          onChange={() => setPayRefundCurrency('SYP')}
                        />
                        بالليرة السورية
                      </label>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="refund-currency"
                          checked={payRefundCurrency === 'USD'}
                          onChange={() => setPayRefundCurrency('USD')}
                        />
                        بالدولار (USD)
                      </label>
                    </div>
                    <label className="form-label" style={{ display: 'block', marginTop: '0.45rem' }}>
                      مبلغ الترجيع {payRefundCurrency === 'SYP' ? '(ل.س)' : '(USD)'}
                    </label>
                    <input
                      className="input"
                      inputMode="decimal"
                      dir={payRefundCurrency === 'USD' ? 'ltr' : undefined}
                      step={payRefundCurrency === 'USD' ? 'any' : undefined}
                      value={payRefundAmount}
                      onChange={(e) => setPayRefundAmount(e.target.value)}
                      placeholder="اتركه فارغاً إن لم يكن هناك ترجيع"
                      style={{ marginTop: '0.25rem', maxWidth: 320 }}
                    />
                  </div>
                </>
              )}
            </div>
            {(() => {
              const due = Math.round(Number(payItem.amountDueSyp || 0))
              if (!(due > 0)) return null
              let grossSyp = 0
              let netSyp = 0
              let refSyp = 0
              let refUsd = 0
              let usdParsed = 0
              if (payCurrency === 'SYP') {
                const syp = Number(normalizeDecimalDigits(paySyp))
                grossSyp = Number.isFinite(syp) && syp > 0 ? Math.round(syp) : 0
                netSyp = grossSyp
              } else {
                const usd = parseFloat(normalizeDecimalDigits(payUsd))
                usdParsed = usd
                if (!payPreviewRate || !Number.isFinite(usd) || usd <= 0) return null
                grossSyp = Math.round(usd * payPreviewRate)
                if (payRefundAmount.trim()) {
                  if (payRefundCurrency === 'SYP') {
                    const r = Number(normalizeDecimalDigits(payRefundAmount))
                    if (Number.isFinite(r) && r > 0) refSyp = Math.round(r)
                  } else {
                    const r = parseFloat(normalizeDecimalDigits(payRefundAmount))
                    if (Number.isFinite(r) && r > 0) refUsd = r
                  }
                }
                netSyp = netReceivedSypAfterUsdCollection({
                  amountUsd: usd,
                  patientRefundSyp: refSyp,
                  patientRefundUsd: refUsd,
                  rate: payPreviewRate,
                })
                if (payRefundCurrency === 'USD' && refUsd > 0) {
                  const dueUsd = due / payPreviewRate
                  const netUsd = usd - refUsd
                  if (Number.isFinite(dueUsd) && Number.isFinite(netUsd) && Math.abs(netUsd - dueUsd) < 1e-7) {
                    netSyp = due
                  }
                }
              }
              if (!(grossSyp > 0)) return null

              if (payCurrency === 'USD' && netSyp <= 0) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--danger)' }}>
                    صافي المبلغ بعد الترجيع غير كافٍ — راجع المستلم بالدولار ومبلغ الترجيع.
                  </p>
                )
              }

              let delta = netSyp - due
              if (payCurrency === 'USD' && payPreviewRate) {
                delta = settlementDeltaAfterUsdNoRefundAbsorb({
                  payCurrency: 'USD',
                  netReceivedSyp: netSyp,
                  amountDueSyp: due,
                  rate: payPreviewRate,
                  amountUsd: usdParsed,
                  patientRefundSyp: refSyp,
                  patientRefundUsd: refUsd,
                })
              }
              if (delta < 0) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--warning)' }}>
                    الصافي بعد الترجيع أقل من المستحق — سيتم تسجيل الباقي كذمة على المريض (
                    {Math.abs(delta).toLocaleString('ar-SY')} ل.س).
                  </p>
                )
              }
              if (delta > 0) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--success)' }}>
                    الصافي بعد الترجيع أعلى من المستحق — سيتم تسجيل الزيادة كرصيد إضافي للمريض (
                    {delta.toLocaleString('ar-SY')} ل.س).
                  </p>
                )
              }
              return (
                <p style={{ marginTop: '0.45rem', color: 'var(--text-muted)' }}>
                  الصافي بعد الترجيع مطابق للمستحق (محاسبياً بالليرة).
                </p>
              )
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPayOpen(false)
                  setPayRefundCurrency('SYP')
                  setPayRefundAmount('')
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyId === payItem.id || Math.round(Number(payItem.amountDueSyp) || 0) <= 0}
                onClick={() =>
                  void (payItem.isPackagePrepaid && (Number(payItem.amountDueSyp) || 0) > 0
                    ? completePackageAddonPayAndConsume()
                    : completePay(payItem.id))
                }
              >
                {busyId === payItem.id
                  ? 'جاري الحفظ…'
                  : payItem.isPackagePrepaid && (Number(payItem.amountDueSyp) || 0) > 0
                    ? 'تأكيد الدفع وإنقاص الجلسة'
                    : 'تأكيد استلام الدفع'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
