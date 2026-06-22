import { useEffect, useMemo, useState } from 'react'
import {
  buildBillingPaymentRequestBody,
  computePaymentSettlementPreview,
  defaultBillingPaymentFormState,
  effectiveDueFromListAndPct,
  parseDiscountPercentInput,
  resolveEffectiveDueSyp,
  resolveUsdCashOffer,
  validateBillingPaymentForm,
  mixedNetReceivedSyp,
  type BillingPaymentFormState,
  type BillingPaymentRequestBody,
} from '../utils/billingPaymentForm'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'

export type BillingPaymentModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (body: BillingPaymentRequestBody) => void | Promise<void>
  busy?: boolean
  externalError?: string
  title: string
  subtitle?: string
  listDueSyp: number
  presetDiscountPercent?: number
  billingCurrency?: 'SYP' | 'USD'
  listDueUsd?: number
  effectiveDueUsd?: number
  usdSypRate?: number | null
  itemBusinessDate?: string
  clinicBusinessDate?: string
  usdSypBusinessDayRate?: number | null
  confirmLabel?: string
  bankOptions?: { id: string; name: string }[]
  /** السماح بتأكيد التحصيل بمبلغ مستلم صفر (مثلاً حفظ باكج بدون قبض نقدي الآن) */
  allowZeroAmount?: boolean
}

function formatUsdAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function formatDueLabel(opts: {
  billingCurrency: 'SYP' | 'USD'
  listDueSyp: number
  effectiveDueSyp: number
  presetDiscountPercent?: number
  listDueUsd?: number
  effectiveDueUsd?: number
}): string {
  const pct = Number(opts.presetDiscountPercent) || 0
  if (opts.billingCurrency === 'USD') {
    const due = Number(opts.effectiveDueUsd) || 0
    const list = Number(opts.listDueUsd) || 0
    if (pct > 0) {
      return `السعر الأصلي: ${formatUsdAmount(list)} USD — بعد الخصم (${pct.toLocaleString('ar-SY')}%): ${formatUsdAmount(due)} USD`
    }
    return `${formatUsdAmount(due)} USD`
  }
  if (pct > 0) {
    return `السعر الأصلي: ${opts.listDueSyp.toLocaleString('ar-SY')} ل.س — بعد الخصم (${pct.toLocaleString('ar-SY')}%): ${opts.effectiveDueSyp.toLocaleString('ar-SY')} ل.س`
  }
  return `${opts.effectiveDueSyp.toLocaleString('ar-SY')} ل.س`
}

export function BillingPaymentModal({
  open,
  onClose,
  onConfirm,
  busy = false,
  externalError = '',
  title,
  subtitle,
  listDueSyp,
  presetDiscountPercent = 0,
  billingCurrency = 'SYP',
  listDueUsd,
  effectiveDueUsd,
  usdSypRate = null,
  itemBusinessDate,
  clinicBusinessDate,
  usdSypBusinessDayRate = null,
  confirmLabel = 'تأكيد استلام الدفع',
  bankOptions = [],
  allowZeroAmount = true,
}: BillingPaymentModalProps) {
  const [form, setForm] = useState<BillingPaymentFormState>(() => defaultBillingPaymentFormState(listDueSyp))
  const [localErr, setLocalErr] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(defaultBillingPaymentFormState(listDueSyp))
    setLocalErr('')
  }, [open, listDueSyp])

  const effectiveDueSyp = useMemo(
    () =>
      resolveEffectiveDueSyp({
        listDueSyp,
        presetDiscountPercent,
        payDiscountEnabled: form.payDiscountEnabled,
        payDiscountPercent: form.payDiscountPercent,
      }),
    [listDueSyp, presetDiscountPercent, form.payDiscountEnabled, form.payDiscountPercent],
  )

  const payPreviewRate = useMemo(() => {
    const fromItem = usdSypBusinessDayRate != null ? Number(usdSypBusinessDayRate) : NaN
    if (Number.isFinite(fromItem) && fromItem > 0) return fromItem
    if (
      itemBusinessDate &&
      clinicBusinessDate &&
      itemBusinessDate === clinicBusinessDate &&
      usdSypRate != null &&
      usdSypRate > 0
    ) {
      return usdSypRate
    }
    return null
  }, [usdSypBusinessDayRate, itemBusinessDate, clinicBusinessDate, usdSypRate])

  const usdCashOffer = useMemo(
    () =>
      resolveUsdCashOffer({
        billingCurrency,
        effectiveDueSyp,
        effectiveDueUsd,
        payPreviewRate,
      }),
    [billingCurrency, effectiveDueSyp, effectiveDueUsd, payPreviewRate],
  )

  useEffect(() => {
    if (!open || form.payCurrency !== 'USD' || !usdCashOffer) return
    setForm((prev) => ({
      ...prev,
      payUsd: usdCashOffer.usdFieldValue,
      payRefundCurrency: 'SYP',
      payRefundAmount: usdCashOffer.impliedRefundSyp > 0 ? String(usdCashOffer.impliedRefundSyp) : '',
    }))
  }, [open, form.payCurrency, usdCashOffer])

  const mixedNetPreview = useMemo(() => {
    if (form.payCurrency !== 'MIXED' || !payPreviewRate) return null
    const syp = Number(normalizeDecimalDigits(form.paySyp))
    const usd = parseFloat(normalizeDecimalDigits(form.payUsd))
    if (!Number.isFinite(syp) || !Number.isFinite(usd)) return null
    return mixedNetReceivedSyp(syp, usd, payPreviewRate)
  }, [form.payCurrency, form.paySyp, form.payUsd, payPreviewRate])

  const settlementPreview = useMemo(
    () =>
      computePaymentSettlementPreview({
        form,
        effectiveDueSyp,
        payPreviewRate,
      }),
    [form, effectiveDueSyp, payPreviewRate],
  )

  const displayErr = localErr || externalError
  const canConfirm = !busy

  function patchForm(patch: Partial<BillingPaymentFormState>) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function applyUsdCashOfferFill() {
    if (!payPreviewRate || !usdCashOffer) return
    patchForm({
      payUsd: usdCashOffer.usdFieldValue,
      payRefundCurrency: 'SYP',
      payRefundAmount: usdCashOffer.impliedRefundSyp > 0 ? String(usdCashOffer.impliedRefundSyp) : '',
    })
  }

  async function handleConfirm() {
    setLocalErr('')
    const validationErr = validateBillingPaymentForm({
      form,
      listDueSyp,
      presetDiscountPercent,
      payPreviewRate,
      allowZeroAmount,
    })
    if (validationErr) {
      setLocalErr(validationErr)
      return
    }
    await onConfirm(buildBillingPaymentRequestBody({ form, presetDiscountPercent }))
  }

  if (!open) return null

  const presetPct = Number(presetDiscountPercent) || 0

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {subtitle ? (
          <p style={{ color: 'var(--text-muted)', marginTop: '-0.2rem' }}>{subtitle}</p>
        ) : null}
        <p style={{ margin: '0.35rem 0', fontWeight: 600 }} dir={billingCurrency === 'USD' ? 'ltr' : undefined}>
          المستحق:{' '}
          {formatDueLabel({
            billingCurrency,
            listDueSyp,
            effectiveDueSyp,
            presetDiscountPercent,
            listDueUsd,
            effectiveDueUsd,
          })}
        </p>
        {billingCurrency === 'SYP' && payPreviewRate && effectiveDueSyp > 0 ? (
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }} dir="ltr">
            يعادل المستحق المحفوظ للبند:{' '}
            {(effectiveDueSyp / payPreviewRate).toLocaleString('en-US', { maximumFractionDigits: 6 })} USD عند سعر{' '}
            {payPreviewRate.toLocaleString('ar-SY')} ل.س لكل 1 USD
          </p>
        ) : null}
        {billingCurrency === 'USD' && effectiveDueSyp > 0 ? (
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            يعادل تقريباً {effectiveDueSyp.toLocaleString('ar-SY')} ل.س في السجلات الداخلية عند سعر اليوم المحفوظ
          </p>
        ) : null}
        {form.payCurrency === 'USD' && payPreviewRate != null && usdCashOffer ? (
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
        ) : itemBusinessDate && clinicBusinessDate && itemBusinessDate !== clinicBusinessDate ? (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
            تاريخ البند يختلف عن يوم العمل الحالي — عند الدفع بالدولار يُستخدم سعر الصرف المحفوظ لذلك التاريخ.
          </p>
        ) : form.payCurrency === 'USD' && !payPreviewRate ? (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
            لا يتوفر سعر صرف في الواجهة لهذا البند — سيتحقق الخادم من السعر المحفوظ لتاريخ البند.
          </p>
        ) : null}
        {effectiveDueSyp <= 0 ? (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            المستحق صفر — يمكنك إدخال مبلغ تحصيل الآن، أو ترك المستلم صفراً وتأكيد الحفظ بدون قبض نقدي.
          </p>
        ) : null}

        <div style={{ marginTop: '0.55rem', paddingTop: '0.55rem', borderTop: '1px solid var(--border)' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              cursor: presetPct > 0 ? 'default' : 'pointer',
              fontWeight: 600,
              opacity: presetPct > 0 ? 0.6 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={form.payDiscountEnabled}
              disabled={presetPct > 0 || busy}
              onChange={(e) => {
                const on = e.target.checked
                let pct = parseDiscountPercentInput(on, form.payDiscountPercent)
                if (on && !form.payDiscountPercent.trim()) pct = 10
                const eff = effectiveDueFromListAndPct(listDueSyp, on ? pct : 0)
                patchForm({
                  payDiscountEnabled: on,
                  payDiscountPercent: on && !form.payDiscountPercent.trim() ? '10' : on ? form.payDiscountPercent : '',
                  paySyp: form.payCurrency === 'SYP' ? String(eff) : form.paySyp,
                })
              }}
            />
            تطبيق خصم (نسبة مئوية على المستحق)
          </label>
          {presetPct > 0 ? (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              هذا البند عليه خصم مُدخل مسبقاً، وسيتم التحصيل تلقائياً على السعر بعد الخصم.
            </p>
          ) : null}
          {form.payDiscountEnabled ? (
            <>
              <p style={{ margin: '0.45rem 0 0', fontWeight: 700 }}>
                المستحق بعد الخصم: {effectiveDueSyp.toLocaleString('ar-SY')} ل.س
                {payPreviewRate && payPreviewRate > 0 ? (
                  <span dir="ltr" style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginRight: '0.45rem' }}>
                    {' '}
                    (≈ {(effectiveDueSyp / payPreviewRate).toLocaleString('en-US', { maximumFractionDigits: 4 })} USD)
                  </span>
                ) : null}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' }}>
                {([5, 10, 15, 20] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.82rem', padding: '0.25rem 0.5rem' }}
                    disabled={busy}
                    onClick={() => {
                      const eff = effectiveDueFromListAndPct(listDueSyp, p)
                      patchForm({
                        payDiscountPercent: String(p),
                        paySyp: form.payCurrency === 'SYP' ? String(eff) : form.paySyp,
                      })
                    }}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <label className="form-label" style={{ display: 'block', marginTop: '0.45rem' }}>
                نسبة الخصم %
              </label>
              <input
                className="input"
                inputMode="decimal"
                dir="ltr"
                disabled={busy}
                value={form.payDiscountPercent}
                onChange={(e) => {
                  const pct = parseDiscountPercentInput(true, e.target.value)
                  const eff = effectiveDueFromListAndPct(listDueSyp, pct)
                  patchForm({
                    payDiscountPercent: e.target.value,
                    paySyp: form.payCurrency === 'SYP' ? String(eff) : form.paySyp,
                  })
                }}
                placeholder="مثال: 10 أو 12.5"
                style={{ marginTop: '0.25rem', maxWidth: 220 }}
              />
              <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                قيمة الخصم من القائمة:{' '}
                <strong>{(listDueSyp - effectiveDueSyp).toLocaleString('ar-SY')} ل.س</strong> — يُحسب قبض التحصيل
                والترجيع مقابل <strong>المستحق بعد الخصم</strong>.
              </p>
            </>
          ) : null}
        </div>

        <div style={{ marginTop: '0.55rem' }}>
          <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
            عملة التحصيل
          </span>
          {billingCurrency === 'USD' ? (
            <p style={{ margin: '0 0 0.45rem', fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              السعر الأصلي بالدولار — يمكن التحصيل بالليرة (حسب المقابل المحفوظ أعلاه) أو بالدولار.
            </p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="billing-pay-currency"
                checked={form.payCurrency === 'SYP'}
                disabled={busy}
                onChange={() => {
                  patchForm({
                    payCurrency: 'SYP',
                    paySyp: String(effectiveDueSyp),
                    payRefundCurrency: 'SYP',
                    payRefundAmount: '',
                  })
                }}
              />
              ليرة سورية
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="billing-pay-currency"
                checked={form.payCurrency === 'USD'}
                disabled={busy}
                onChange={() => {
                  const next: Partial<BillingPaymentFormState> = {
                    payCurrency: 'USD',
                    payRefundCurrency: 'SYP',
                    payRefundAmount: '',
                  }
                  if (billingCurrency === 'USD' && effectiveDueUsd != null && effectiveDueUsd > 0) {
                    next.payUsd = String(effectiveDueUsd)
                  } else if (payPreviewRate && effectiveDueSyp > 0 && usdCashOffer) {
                    next.payUsd = usdCashOffer.usdFieldValue
                  } else {
                    next.payUsd = ''
                  }
                  patchForm(next)
                }}
              />
              دولار أمريكي (USD)
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="billing-pay-currency"
                checked={form.payCurrency === 'MIXED'}
                disabled={busy}
                onChange={() => {
                  patchForm({
                    payCurrency: 'MIXED',
                    paySyp: String(effectiveDueSyp),
                    payUsd: '',
                    payRefundCurrency: 'SYP',
                    payRefundAmount: '',
                  })
                }}
              />
              ليرة ودولار معاً
            </label>
          </div>
          {form.payCurrency === 'MIXED' && payPreviewRate ? (
            <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              يُحسب الإجمالي: ليرة نقدية + (دولار × {payPreviewRate.toLocaleString('ar-SY')}) ثم يُقارن بالمستحق.
              {mixedNetPreview != null ? (
                <>
                  {' '}
                  الإجمالي الحالي: <strong>{mixedNetPreview.toLocaleString('ar-SY')} ل.س</strong>
                </>
              ) : null}
            </p>
          ) : form.payCurrency === 'MIXED' && !payPreviewRate ? (
            <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
              لا يتوفر سعر صرف — أدخل جزء الليرة فقط أو فعّل يوم العمل لإدخال الدولار.
            </p>
          ) : null}
        </div>

        <div style={{ marginTop: '0.55rem' }}>
          <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
            طريقة استلام الدفع
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="billing-pay-channel"
                checked={form.payChannel === 'cash'}
                disabled={busy}
                onChange={() => patchForm({ payChannel: 'cash', payBankName: '' })}
              />
              كاش
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="billing-pay-channel"
                checked={form.payChannel === 'bank'}
                disabled={busy}
                onChange={() => patchForm({ payChannel: 'bank' })}
              />
              بنك
            </label>
          </div>
        </div>

        {form.payChannel === 'bank' ? (
          <div style={{ marginTop: '0.55rem' }}>
            <label className="form-label" htmlFor="billing-pay-bank-select">
              البنك
            </label>
            <select
              id="billing-pay-bank-select"
              className="select"
              value={form.payBankName}
              disabled={busy}
              onChange={(e) => patchForm({ payBankName: e.target.value })}
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
              بعد اختيار البنك، أدخل المبلغ المستلم{' '}
              {form.payCurrency === 'USD'
                ? 'بالدولار'
                : form.payCurrency === 'MIXED'
                  ? 'بالليرة و/أو بالدولار'
                  : 'بالليرة'}{' '}
              أدناه.
            </p>
          </div>
        ) : null}

        <div style={{ marginTop: '0.5rem' }}>
          {form.payCurrency === 'SYP' ? (
            <>
              <label className="form-label">المبلغ المستلم (ل.س)</label>
              <input
                className="input"
                inputMode="decimal"
                disabled={busy}
                value={form.paySyp}
                onChange={(e) => patchForm({ paySyp: e.target.value })}
                placeholder="0"
                style={{ marginTop: '0.25rem', maxWidth: 280 }}
              />
            </>
          ) : form.payCurrency === 'MIXED' ? (
            <>
              <label className="form-label">المبلغ المستلم نقداً (ل.س)</label>
              <input
                className="input"
                inputMode="decimal"
                disabled={busy}
                value={form.paySyp}
                onChange={(e) => patchForm({ paySyp: e.target.value })}
                placeholder="0"
                style={{ marginTop: '0.25rem', maxWidth: 280 }}
              />
              <label className="form-label" style={{ display: 'block', marginTop: '0.55rem' }}>
                المبلغ المستلم (USD)
              </label>
              <input
                className="input"
                inputMode="decimal"
                dir="ltr"
                step="any"
                disabled={busy}
                value={form.payUsd}
                onChange={(e) => patchForm({ payUsd: e.target.value })}
                placeholder="0"
                style={{ marginTop: '0.25rem', maxWidth: 320 }}
              />
              {payPreviewRate ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  مقابل الدولار بالليرة = USD × {payPreviewRate.toLocaleString('ar-SY')} (تقريب أقرب ليرة).
                </p>
              ) : null}
            </>
          ) : (
            <>
              <label className="form-label">المبلغ المستلم (USD)</label>
              <input
                className="input"
                inputMode="decimal"
                dir="ltr"
                step="any"
                disabled={busy}
                value={form.payUsd}
                onChange={(e) => patchForm({ payUsd: e.target.value })}
                placeholder="0"
                style={{ marginTop: '0.25rem', maxWidth: 320 }}
              />
              {payPreviewRate && effectiveDueSyp > 0 && usdCashOffer ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}
                  disabled={busy}
                  onClick={() => applyUsdCashOfferFill()}
                >
                  تعبئة المبلغ (دولار مُقرّب + ترجيع ليرة عند الحاجة)
                </button>
              ) : null}
              {payPreviewRate ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  المقابل بالليرة = المبلغ بالدولار × {payPreviewRate.toLocaleString('ar-SY')} (تقريب أقرب ليرة). إن
                  احتجت دولاراً مُقرّباً مع ترجيع بالليرة لمطابقة المستحق دون رصيد زائد، استخدم زر «تعبئة المبلغ»؛ وإلا
                  اترك الترجيع فارغاً.
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
                  المبلغ الذي رُدّ للمريض بعد التحصيل (إن وُجد). يُطرح من المستلم لحساب الصافي مقابل المستحق.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="billing-refund-currency"
                      checked={form.payRefundCurrency === 'SYP'}
                      disabled={busy}
                      onChange={() => patchForm({ payRefundCurrency: 'SYP' })}
                    />
                    بالليرة السورية
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="billing-refund-currency"
                      checked={form.payRefundCurrency === 'USD'}
                      disabled={busy}
                      onChange={() => patchForm({ payRefundCurrency: 'USD' })}
                    />
                    بالدولار (USD)
                  </label>
                </div>
                <label className="form-label" style={{ display: 'block', marginTop: '0.45rem' }}>
                  مبلغ الترجيع {form.payRefundCurrency === 'SYP' ? '(ل.س)' : '(USD)'}
                </label>
                <input
                  className="input"
                  inputMode="decimal"
                  dir={form.payRefundCurrency === 'USD' ? 'ltr' : undefined}
                  step={form.payRefundCurrency === 'USD' ? 'any' : undefined}
                  disabled={busy}
                  value={form.payRefundAmount}
                  onChange={(e) => patchForm({ payRefundAmount: e.target.value })}
                  placeholder="اتركه فارغاً إن لم يكن هناك ترجيع"
                  style={{ marginTop: '0.25rem', maxWidth: 320 }}
                />
              </div>
            </>
          )}
        </div>

        {settlementPreview.kind === 'invalid_net' ? (
          <p style={{ marginTop: '0.45rem', color: 'var(--danger)' }}>
            صافي المبلغ بعد الترجيع غير كافٍ — راجع المستلم بالدولار ومبلغ الترجيع.
          </p>
        ) : settlementPreview.kind === 'under' ? (
          <p style={{ marginTop: '0.45rem', color: 'var(--warning)' }}>
            الصافي بعد الترجيع أقل من المستحق — سيتم تسجيل الباقي كذمة على المريض (
            {Math.abs(settlementPreview.delta).toLocaleString('ar-SY')} ل.س).
          </p>
        ) : settlementPreview.kind === 'over' ? (
          <p style={{ marginTop: '0.45rem', color: 'var(--success)' }}>
            الصافي بعد الترجيع أعلى من المستحق — سيتم تسجيل الزيادة كرصيد إضافي للمريض (
            {settlementPreview.delta.toLocaleString('ar-SY')} ل.س).
          </p>
        ) : settlementPreview.kind === 'exact' ? (
          <p style={{ marginTop: '0.45rem', color: 'var(--text-muted)' }}>
            الصافي بعد الترجيع مطابق للمستحق{form.payDiscountEnabled ? ' بعد الخصم' : ''} (محاسبياً بالليرة).
          </p>
        ) : null}

        {displayErr ? <p style={{ color: 'var(--danger)', marginTop: '0.65rem' }}>{displayErr}</p> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose()}>
            إلغاء
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canConfirm}
            onClick={() => void handleConfirm()}
          >
            {busy ? 'جاري الحفظ…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
