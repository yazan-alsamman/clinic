import { BusinessDay } from '../models/BusinessDay.js'
import { round6 } from '../utils/money.js'

function netReceivedSypAfterUsdCollection(amountUsd, patientRefundSyp, patientRefundUsd, rate) {
  const u = Number(amountUsd)
  const r = Number(rate)
  const rs = Math.round(Number(patientRefundSyp) || 0)
  const ru = Number(patientRefundUsd) || 0
  if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(r) || r <= 0) return 0
  if (ru > 0) return Math.round((u - ru) * r) - rs
  return Math.round(u * r) - rs
}

export function normalizePayCurrency(raw) {
  const s = String(raw || 'SYP').trim().toUpperCase()
  if (s === 'USD') return 'USD'
  if (s === 'MIXED') return 'MIXED'
  return 'SYP'
}

export function parseSypReceivedFromBody(body) {
  const raw = Number(body?.amountSyp)
  if (!Number.isFinite(raw) || raw < 0) return { ok: false }
  return { ok: true, receivedSyp: Math.round(raw) }
}

export function mixedNetReceivedSyp(sypCash, usdAmount, rate) {
  const syp = Math.max(0, Math.round(Number(sypCash) || 0))
  const usd = Number(usdAmount) || 0
  const r = Number(rate) || 0
  if (!(r > 0)) return syp
  if (!(usd > 0)) return syp
  return syp + Math.round(usd * r)
}

export function isZeroCollectionAllowed(netReceivedSyp, dueForSettlement) {
  const net = Math.round(Number(netReceivedSyp) || 0)
  const due = Math.round(Number(dueForSettlement) || 0)
  // تحصيل صفر مسموح دائماً (ذمة كاملة، أو بند بلا مستحق)
  return net === 0 && due >= 0
}

export function assertBillingCollectionAmountValid({ netReceivedSyp, dueForSettlement }) {
  const net = Math.round(Number(netReceivedSyp) || 0)
  if (net < 0) {
    const err = new Error('مبلغ الدفع غير صالح')
    err.code = 'INVALID_AMOUNT'
    throw err
  }
  const zeroAllowed = isZeroCollectionAllowed(net, dueForSettlement)
  if (!zeroAllowed && net <= 0) {
    const err = new Error('مبلغ الدفع غير صالح')
    err.code = 'INVALID_AMOUNT'
    throw err
  }
}

export async function fetchUsdSypRateForBusinessDate(businessDate) {
  const bd = await BusinessDay.findOne({ businessDate: String(businessDate || '').trim() }).lean()
  const rate = Number(bd?.usdSypRate)
  if (!Number.isFinite(rate) || rate <= 0) return null
  return rate
}

/**
 * يُحلّل مبالغ التحصيل من طلب الاستقبال (ليرة / دولار / مختلط).
 * @returns {Promise<{
 *   payCurrency: 'SYP' | 'USD' | 'MIXED',
 *   netReceivedSyp: number,
 *   receivedAmountSyp: number,
 *   receivedAmountUsd: number,
 *   patientRefundSyp: number,
 *   patientRefundUsd: number,
 *   usdSypRateUsed: number,
 *   amountUsdRaw: number,
 * }>}
 */
export async function resolveBillingPaymentReceipt(reqBody, businessDate) {
  const payCurrency = normalizePayCurrency(reqBody?.payCurrency)
  let receivedAmountSyp = 0
  let receivedAmountUsd = 0
  let patientRefundSyp = 0
  let patientRefundUsd = 0
  let usdSypRateUsed = 0
  let amountUsdRaw = 0
  let netReceivedSyp = 0

  if (payCurrency === 'USD') {
    amountUsdRaw = Number(reqBody.amountUsd)
    if (reqBody.amountUsd == null || String(reqBody.amountUsd).trim() === '') {
      amountUsdRaw = 0
    }
    if (!Number.isFinite(amountUsdRaw) || amountUsdRaw < 0) {
      const err = new Error('مبلغ الدفع بالدولار غير صالح')
      err.code = 'INVALID_USD'
      throw err
    }
    // تحصيل صفر بالدولار (ذمة كاملة) — لا يحتاج سعر صرف
    if (amountUsdRaw === 0) {
      return {
        payCurrency,
        netReceivedSyp: 0,
        receivedAmountSyp: 0,
        receivedAmountUsd: 0,
        patientRefundSyp: 0,
        patientRefundUsd: 0,
        usdSypRateUsed: 0,
        amountUsdRaw: 0,
      }
    }
    const rate = await fetchUsdSypRateForBusinessDate(businessDate)
    if (rate == null) {
      const err = new Error(
        'لا يتوفر سعر صرف مسجّل لتاريخ هذا البند. يجب تفعيل يوم العمل ذلك اليوم مع إدخال سعر الدولار مقابل الليرة.',
      )
      err.code = 'NO_RATE'
      throw err
    }
    usdSypRateUsed = rate
    receivedAmountSyp = Math.round(amountUsdRaw * rate)
    receivedAmountUsd = round6(amountUsdRaw)
    if (receivedAmountSyp <= 0) {
      const err = new Error('المبلغ بالدولار صغير جداً بالنسبة لسعر الصرف.')
      err.code = 'INVALID_USD'
      throw err
    }

    const refundCurRaw = String(reqBody.refundCurrency || '').trim().toUpperCase()
    const refundCurrency = refundCurRaw === 'USD' ? 'USD' : refundCurRaw === 'SYP' ? 'SYP' : null
    if (refundCurrency === 'SYP') {
      const refSyp = Number(reqBody.refundAmount)
      if (reqBody.refundAmount != null && String(reqBody.refundAmount).trim() !== '') {
        if (!Number.isFinite(refSyp) || refSyp < 0) {
          const err = new Error('مبلغ الترجيع بالليرة غير صالح')
          err.code = 'INVALID_REFUND'
          throw err
        }
        patientRefundSyp = refSyp > 0 ? Math.round(refSyp) : 0
      }
    } else if (refundCurrency === 'USD') {
      const refUsd = Number(reqBody.refundAmount)
      if (reqBody.refundAmount != null && String(reqBody.refundAmount).trim() !== '') {
        if (!Number.isFinite(refUsd) || refUsd < 0) {
          const err = new Error('مبلغ الترجيع بالدولار غير صالح')
          err.code = 'INVALID_REFUND'
          throw err
        }
        patientRefundUsd = refUsd > 0 ? round6(refUsd) : 0
      }
    } else if (reqBody.refundAmount != null && String(reqBody.refundAmount).trim() !== '') {
      const err = new Error('حدد عملة الترجيع (ليرة أو دولار) عند إدخال مبلغ الترجيع')
      err.code = 'INVALID_REFUND'
      throw err
    }

    if (patientRefundSyp > 0 && patientRefundSyp > receivedAmountSyp) {
      const err = new Error('مبلغ الترجيع بالليرة أكبر من المقابل المستلم بالليرة لهذه الدفعة')
      err.code = 'INVALID_REFUND'
      throw err
    }
    if (patientRefundUsd > 0 && patientRefundUsd > amountUsdRaw) {
      const err = new Error('مبلغ الترجيع بالدولار أكبر من المبلغ المستلم بالدولار')
      err.code = 'INVALID_REFUND'
      throw err
    }
    const refundSypEquivUsd = patientRefundUsd > 0 ? Math.round(patientRefundUsd * rate) : 0
    if (patientRefundSyp + refundSypEquivUsd > receivedAmountSyp) {
      const err = new Error('إجمالي الترجيع (ليرة ومقابل دولار) يتجاوز المبلغ المستلم بالليرة')
      err.code = 'INVALID_REFUND'
      throw err
    }

    netReceivedSyp = netReceivedSypAfterUsdCollection(
      amountUsdRaw,
      patientRefundSyp,
      patientRefundUsd,
      usdSypRateUsed,
    )
  } else if (payCurrency === 'MIXED') {
    const parsedSyp = parseSypReceivedFromBody(reqBody)
    if (!parsedSyp.ok) {
      const err = new Error('مبلغ الليرة في التحصيل المختلط غير صالح')
      err.code = 'INVALID_AMOUNT'
      throw err
    }
    amountUsdRaw =
      reqBody.amountUsd == null || String(reqBody.amountUsd).trim() === ''
        ? 0
        : Number(reqBody.amountUsd)
    if (!Number.isFinite(amountUsdRaw) || amountUsdRaw < 0) {
      const err = new Error('مبلغ الدولار في التحصيل المختلط غير صالح')
      err.code = 'INVALID_USD'
      throw err
    }
    // تحصيل صفر مختلط — لا يحتاج سعر صرف
    if (parsedSyp.receivedSyp === 0 && amountUsdRaw === 0) {
      return {
        payCurrency,
        netReceivedSyp: 0,
        receivedAmountSyp: 0,
        receivedAmountUsd: 0,
        patientRefundSyp: 0,
        patientRefundUsd: 0,
        usdSypRateUsed: 0,
        amountUsdRaw: 0,
      }
    }
    const rate = await fetchUsdSypRateForBusinessDate(businessDate)
    if (rate == null) {
      const err = new Error(
        'لا يتوفر سعر صرف مسجّل لتاريخ هذا البند. يجب تفعيل يوم العمل ذلك اليوم مع إدخال سعر الدولار مقابل الليرة.',
      )
      err.code = 'NO_RATE'
      throw err
    }
    usdSypRateUsed = rate
    receivedAmountSyp = parsedSyp.receivedSyp
    receivedAmountUsd = amountUsdRaw > 0 ? round6(amountUsdRaw) : 0
    netReceivedSyp = mixedNetReceivedSyp(receivedAmountSyp, amountUsdRaw, rate)
  } else {
    const parsed = parseSypReceivedFromBody(reqBody)
    if (!parsed.ok) {
      const err = new Error('مبلغ الدفع غير صالح')
      err.code = 'INVALID_AMOUNT'
      throw err
    }
    receivedAmountSyp = parsed.receivedSyp
    netReceivedSyp = receivedAmountSyp
  }

  return {
    payCurrency,
    netReceivedSyp,
    receivedAmountSyp,
    receivedAmountUsd,
    patientRefundSyp,
    patientRefundUsd,
    usdSypRateUsed,
    amountUsdRaw,
  }
}

export function paymentRecordReceivedFields(receipt) {
  const payCurrency = receipt.payCurrency
  return {
    payCurrency,
    receivedAmountSyp: Math.round(Number(receipt.receivedAmountSyp) || 0),
    receivedAmountUsd:
      payCurrency === 'USD' || payCurrency === 'MIXED'
        ? round6(Number(receipt.receivedAmountUsd) || 0)
        : 0,
    patientRefundSyp: payCurrency === 'USD' ? Math.round(Number(receipt.patientRefundSyp) || 0) : 0,
    patientRefundUsd: payCurrency === 'USD' ? round6(Number(receipt.patientRefundUsd) || 0) : 0,
  }
}
