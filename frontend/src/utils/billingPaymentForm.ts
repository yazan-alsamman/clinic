import { normalizeDecimalDigits } from './normalizeDigits'
import {
  netReceivedSypAfterUsdCollection,
  settlementDeltaAfterUsdCashNetAbsorb,
  usdRoundedUpCashOffer,
} from './usdExactDue'

export type PayCurrency = 'SYP' | 'USD'
export type PaymentChannel = 'cash' | 'bank'

export type BillingPaymentRequestBody = {
  payCurrency: PayCurrency
  paymentChannel: PaymentChannel
  bankName?: string
  amountSyp?: number
  amountUsd?: number
  discountPercent?: number
  refundCurrency?: PayCurrency
  refundAmount?: number
}

export type BillingPaymentFormState = {
  payCurrency: PayCurrency
  payChannel: PaymentChannel
  payBankName: string
  paySyp: string
  payUsd: string
  payRefundCurrency: PayCurrency
  payRefundAmount: string
  payDiscountEnabled: boolean
  payDiscountPercent: string
}

function stripPct(s: string) {
  return s.replace(/%/g, '').trim()
}

export function parseDiscountPercentInput(enabled: boolean, percentStr: string): number {
  if (!enabled) return 0
  const n = parseFloat(normalizeDecimalDigits(stripPct(percentStr)))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, n)
}

export function effectiveDueFromListAndPct(list: number, pct: number): number {
  const L = Math.round(Number(list) || 0)
  if (!(L > 0)) return 0
  if (!(pct > 0)) return L
  return Math.max(1, Math.round(L * (1 - pct / 100)))
}

export function resolveEffectiveDueSyp(opts: {
  listDueSyp: number
  presetDiscountPercent?: number
  payDiscountEnabled: boolean
  payDiscountPercent: string
}): number {
  const preset = Number(opts.presetDiscountPercent) || 0
  if (preset > 0) {
    return effectiveDueFromListAndPct(opts.listDueSyp, preset)
  }
  const pct = parseDiscountPercentInput(opts.payDiscountEnabled, opts.payDiscountPercent)
  return effectiveDueFromListAndPct(opts.listDueSyp, pct)
}

export function resolveUsdCashOffer(opts: {
  billingCurrency: 'SYP' | 'USD'
  effectiveDueSyp: number
  effectiveDueUsd?: number
  payPreviewRate: number | null
}) {
  if (opts.billingCurrency === 'USD') {
    const dueUsd = Number(opts.effectiveDueUsd) || 0
    if (!(dueUsd > 0)) return null
    return { usdFieldValue: String(dueUsd), impliedRefundSyp: 0 }
  }
  if (!opts.payPreviewRate || !(opts.effectiveDueSyp > 0)) return null
  return usdRoundedUpCashOffer(opts.effectiveDueSyp, opts.payPreviewRate)
}

export function defaultBillingPaymentFormState(listDueSyp: number): BillingPaymentFormState {
  return {
    payCurrency: 'SYP',
    payChannel: 'cash',
    payBankName: '',
    paySyp: String(Math.max(0, Math.round(listDueSyp))),
    payUsd: '',
    payRefundCurrency: 'SYP',
    payRefundAmount: '',
    payDiscountEnabled: false,
    payDiscountPercent: '',
  }
}

export function hasPositiveReceivedAmount(form: BillingPaymentFormState): boolean {
  if (form.payCurrency === 'SYP') {
    const syp = Number(normalizeDecimalDigits(form.paySyp))
    return Number.isFinite(syp) && syp > 0
  }
  const usd = parseFloat(normalizeDecimalDigits(form.payUsd))
  return Number.isFinite(usd) && usd > 0
}

export function paymentRequestHasCollection(body: BillingPaymentRequestBody): boolean {
  if (body.payCurrency === 'USD') return (Number(body.amountUsd) || 0) > 0
  return (Number(body.amountSyp) || 0) > 0
}

export function netCollectedSypFromPayment(
  payment: BillingPaymentRequestBody,
  usdSypRate: number | null,
): number {
  if (payment.payCurrency === 'USD') {
    const usd = Number(payment.amountUsd) || 0
    const rate = Number(usdSypRate) || 0
    if (!(usd > 0) || !(rate > 0)) return 0
    let net = Math.round(usd * rate)
    if (payment.refundAmount != null && payment.refundAmount > 0) {
      if (payment.refundCurrency === 'USD') {
        net = netReceivedSypAfterUsdCollection({
          amountUsd: usd,
          patientRefundSyp: 0,
          patientRefundUsd: Number(payment.refundAmount),
          rate,
        })
      } else {
        net = netReceivedSypAfterUsdCollection({
          amountUsd: usd,
          patientRefundSyp: Math.round(Number(payment.refundAmount)),
          patientRefundUsd: 0,
          rate,
        })
      }
    }
    return Math.max(0, net)
  }
  return Math.max(0, Math.round(Number(payment.amountSyp) || 0))
}

export function validateBillingPaymentForm(opts: {
  form: BillingPaymentFormState
  listDueSyp: number
  presetDiscountPercent?: number
  payPreviewRate: number | null
  allowZeroAmount?: boolean
}): string | null {
  const { form } = opts
  const allowZero = opts.allowZeroAmount !== false
  if (form.payDiscountEnabled) {
    const p = parseDiscountPercentInput(true, form.payDiscountPercent)
    if (!(p > 0) || p > 100) return 'أدخل نسبة خصم صالحة بين 1 و 100%.'
  }
  const hasReceived = hasPositiveReceivedAmount(form)
  if (form.payChannel === 'bank' && hasReceived && !form.payBankName.trim()) {
    return 'اختر البنك ثم أدخل المبلغ المستلم.'
  }
  if (form.payCurrency === 'SYP') {
    const syp = Number(normalizeDecimalDigits(form.paySyp))
    if (!Number.isFinite(syp) || syp < 0) return 'أدخل مبلغاً صالحاً بالليرة السورية.'
    if (!allowZero && syp <= 0) return 'أدخل مبلغاً صالحاً بالليرة السورية.'
    return null
  }
  const usd = parseFloat(normalizeDecimalDigits(form.payUsd))
  if (!Number.isFinite(usd) || usd < 0) return 'أدخل مبلغاً صالحاً بالدولار.'
  if (!allowZero && usd <= 0) return 'أدخل مبلغاً صالحاً بالدولار.'
  if (!hasReceived) return null
  if (form.payRefundAmount.trim()) {
    const ref =
      form.payRefundCurrency === 'SYP'
        ? Number(normalizeDecimalDigits(form.payRefundAmount))
        : parseFloat(normalizeDecimalDigits(form.payRefundAmount))
    if (!Number.isFinite(ref) || ref < 0) {
      return 'مبلغ الترجيع غير صالح — أدخل رقماً صحيحاً أو افرغ الحقل.'
    }
  }
  if (opts.payPreviewRate && opts.payPreviewRate > 0) {
    const usdG = parseFloat(normalizeDecimalDigits(form.payUsd))
    if (Number.isFinite(usdG) && usdG > 0) {
      const grossSyp = Math.round(usdG * opts.payPreviewRate)
      let refSyp = 0
      let refUsd = 0
      if (form.payRefundAmount.trim()) {
        if (form.payRefundCurrency === 'SYP') {
          refSyp = Math.round(Number(normalizeDecimalDigits(form.payRefundAmount)) || 0)
        } else {
          refUsd = parseFloat(normalizeDecimalDigits(form.payRefundAmount)) || 0
        }
      }
      const refEquiv = refSyp + Math.round(refUsd * opts.payPreviewRate)
      if (refEquiv > grossSyp) {
        return 'إجمالي الترجيع (ليرة ومقابل دولار) لا يمكن أن يتجاوز المبلغ المستلم.'
      }
      const netSyp = netReceivedSypAfterUsdCollection({
        amountUsd: usdG,
        patientRefundSyp: refSyp,
        patientRefundUsd: refUsd,
        rate: opts.payPreviewRate,
      })
      if (netSyp < 0) return 'صافي المبلغ بعد الترجيع غير صالح.'
    }
  }
  return null
}

export function buildBillingPaymentRequestBody(opts: {
  form: BillingPaymentFormState
  presetDiscountPercent?: number
}): BillingPaymentRequestBody {
  const { form } = opts
  const syp = Number(normalizeDecimalDigits(form.paySyp))
  const usd = parseFloat(normalizeDecimalDigits(form.payUsd))
  const refundTrim = form.payRefundAmount.trim()
  const refundPayload =
    form.payCurrency === 'USD' && refundTrim
      ? {
          refundCurrency: form.payRefundCurrency,
          refundAmount:
            form.payRefundCurrency === 'SYP'
              ? Number(normalizeDecimalDigits(form.payRefundAmount))
              : parseFloat(normalizeDecimalDigits(form.payRefundAmount)),
        }
      : form.payCurrency === 'USD'
        ? { refundCurrency: form.payRefundCurrency }
        : {}
  const preset = Number(opts.presetDiscountPercent) || 0
  const discountPct =
    preset > 0 ? 0 : form.payDiscountEnabled ? parseDiscountPercentInput(true, form.payDiscountPercent) : 0
  return {
    payCurrency: form.payCurrency,
    paymentChannel: form.payChannel,
    bankName: form.payChannel === 'bank' ? form.payBankName.trim() : undefined,
    amountSyp:
      form.payCurrency === 'SYP' && Number.isFinite(syp) && syp >= 0 ? Math.round(syp) : undefined,
    amountUsd: form.payCurrency === 'USD' && Number.isFinite(usd) && usd >= 0 ? usd : undefined,
    discountPercent: discountPct > 0 ? discountPct : 0,
    ...refundPayload,
  }
}

export function computePaymentSettlementPreview(opts: {
  form: BillingPaymentFormState
  effectiveDueSyp: number
  payPreviewRate: number | null
}): { kind: 'none' } | { kind: 'invalid_net' } | { kind: 'under' | 'over' | 'exact'; delta: number } {
  const due = opts.effectiveDueSyp
  if (!(due > 0)) return { kind: 'none' }
  let grossSyp = 0
  let netSyp = 0
  let refSyp = 0
  let refUsd = 0
  let usdParsed = 0
  const { form, payPreviewRate } = opts
  if (form.payCurrency === 'SYP') {
    const syp = Number(normalizeDecimalDigits(form.paySyp))
    grossSyp = Number.isFinite(syp) && syp > 0 ? Math.round(syp) : 0
    netSyp = grossSyp
  } else {
    const usd = parseFloat(normalizeDecimalDigits(form.payUsd))
    usdParsed = usd
    if (!payPreviewRate || !Number.isFinite(usd) || usd <= 0) return { kind: 'none' }
    grossSyp = Math.round(usd * payPreviewRate)
    if (form.payRefundAmount.trim()) {
      if (form.payRefundCurrency === 'SYP') {
        const r = Number(normalizeDecimalDigits(form.payRefundAmount))
        if (Number.isFinite(r) && r > 0) refSyp = Math.round(r)
      } else {
        const r = parseFloat(normalizeDecimalDigits(form.payRefundAmount))
        if (Number.isFinite(r) && r > 0) refUsd = r
      }
    }
    netSyp = netReceivedSypAfterUsdCollection({
      amountUsd: usd,
      patientRefundSyp: refSyp,
      patientRefundUsd: refUsd,
      rate: payPreviewRate,
    })
  }
  if (!(grossSyp > 0)) return { kind: 'none' }
  if (form.payCurrency === 'USD' && netSyp <= 0) return { kind: 'invalid_net' }
  let delta = netSyp - due
  if (form.payCurrency === 'USD' && payPreviewRate) {
    delta = settlementDeltaAfterUsdCashNetAbsorb({
      payCurrency: 'USD',
      netReceivedSyp: netSyp,
      amountDueSyp: due,
      rate: payPreviewRate,
      amountUsd: usdParsed,
      patientRefundSyp: refSyp,
      patientRefundUsd: refUsd,
    })
  }
  if (delta < 0) return { kind: 'under', delta }
  if (delta > 0) return { kind: 'over', delta }
  return { kind: 'exact', delta: 0 }
}
