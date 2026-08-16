import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { postBillingPayment } from './postingService.js'
import { resolvePaymentChannelFromBody } from './paymentChannelSettings.js'
import {
  assertBillingCollectionAmountValid,
  isZeroCollectionAllowed,
  parseSypReceivedFromBody,
  paymentRecordReceivedFields,
  resolveBillingPaymentReceipt,
  fetchUsdSypRateForBusinessDate,
} from './billingPaymentReceipt.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'
import { round6 } from '../utils/money.js'
import { BILLING_PAYMENT_DUPLICATE_MSG, isMongoDuplicateKeyError } from '../utils/mongoErrors.js'

/** توافق مع billing.js القديم */
export function isZeroSypCollectionAllowed(_receivedSyp, netReceivedSyp, dueForSettlement) {
  return isZeroCollectionAllowed(netReceivedSyp, dueForSettlement)
}

function resolveBillingDiscount(listDueSyp, discountPercentBody) {
  const list = Math.round(Number(listDueSyp) || 0)
  if (!(list > 0)) {
    return { discountPercent: 0, listAmountDueSyp: 0, effectiveAmountDueSyp: 0 }
  }
  const raw = Number(discountPercentBody)
  if (discountPercentBody == null || discountPercentBody === '' || !Number.isFinite(raw) || raw <= 0) {
    return { discountPercent: 0, listAmountDueSyp: list, effectiveAmountDueSyp: list }
  }
  if (raw > 100) {
    const err = new Error('DISCOUNT_RANGE')
    throw err
  }
  const eff = Math.round(list * (1 - raw / 100))
  if (eff < 1) {
    const err = new Error('DISCOUNT_TOO_DEEP')
    throw err
  }
  if (eff >= list) {
    return { discountPercent: 0, listAmountDueSyp: list, effectiveAmountDueSyp: list }
  }
  return { discountPercent: round6(raw), listAmountDueSyp: list, effectiveAmountDueSyp: eff }
}

function mapDiscountError(err) {
  if (err && err.message === 'DISCOUNT_RANGE') return 'نسبة الخصم يجب أن تكون بين 0 و 100.'
  if (err && err.message === 'DISCOUNT_TOO_DEEP') return 'الخصم كبير جداً — المستحق بعد الخصم أصبح أقل من 1 ل.س.'
  return null
}

export { parseSypReceivedFromBody, isZeroCollectionAllowed, assertBillingCollectionAmountValid }

/**
 * فرق التسوية: لا يُحوَّل دولار↔ليرة إلى رصيد إضافي إذا طابق الصافي المستحق.
 * تطابق الليرة (±1) أو الدولار (±0.02) يلغي الفائض/الذمة الناتجين عن سعر الصرف.
 */
export function computeBillingSettlementDelta({
  payCurrency,
  netReceivedSyp,
  dueAfterCreditSyp,
  dueAfterCreditUsd = 0,
  dueUsd = 0,
  creditAppliedSyp = 0,
  amountUsdRaw = 0,
  usdSypRateUsed = 0,
  rateForCredit = 0,
  patientRefundUsd = 0,
  absorbCashNetUsdQualifies = false,
  isUsdBilling = false,
}) {
  const rate = Number(usdSypRateUsed > 0 ? usdSypRateUsed : rateForCredit) || 0
  const remainingSyp = Math.round(Number(dueAfterCreditSyp) || 0)
  const netSyp = Math.round(Number(netReceivedSyp) || 0)
  const creditApplied = Math.round(Number(creditAppliedSyp) || 0)
  const billedUsd = round6(Number(dueUsd) || 0)
  let remainingUsd = round6(Number(dueAfterCreditUsd) || 0)

  if (isUsdBilling && billedUsd > 0) {
    if (!(remainingUsd > 0) && remainingSyp > 0 && rate > 0) {
      remainingUsd = round6(remainingSyp / rate)
    } else if (!(remainingUsd > 0) && remainingSyp === 0 && creditApplied === 0) {
      remainingUsd = billedUsd
    }
  }

  if (Math.abs(netSyp - remainingSyp) <= 1) {
    return { settlementDeltaSyp: 0, settlementDeltaUsd: 0 }
  }

  if (isUsdBilling && billedUsd > 0 && rate > 0) {
    const cur = String(payCurrency || 'SYP').toUpperCase()
    let netUsd
    if (cur === 'USD') {
      const refundUsd = round6(Number(patientRefundUsd) || 0)
      netUsd = round6(Math.max(0, Number(amountUsdRaw) - refundUsd))
    } else {
      netUsd = round6(netSyp / rate)
    }

    let settlementDeltaUsd = round6(netUsd - remainingUsd)
    if (Math.abs(settlementDeltaUsd) < 0.02) {
      return { settlementDeltaSyp: 0, settlementDeltaUsd: 0 }
    }
    if (
      cur === 'USD' &&
      settlementDeltaUsd > 0 &&
      settlementDeltaUsd * rate <= rate &&
      absorbCashNetUsdQualifies
    ) {
      return { settlementDeltaSyp: 0, settlementDeltaUsd: 0 }
    }
    return {
      settlementDeltaUsd,
      settlementDeltaSyp: Math.round(settlementDeltaUsd * rate),
    }
  }

  let settlementDeltaSyp = netSyp - remainingSyp
  if (
    String(payCurrency || '').toUpperCase() === 'USD' &&
    rate > 0 &&
    settlementDeltaSyp > 0 &&
    settlementDeltaSyp <= rate &&
    absorbCashNetUsdQualifies
  ) {
    settlementDeltaSyp = 0
  }
  if (Math.abs(settlementDeltaSyp) <= 1) settlementDeltaSyp = 0
  return { settlementDeltaSyp, settlementDeltaUsd: 0 }
}

/** خصم الرصيد الإضافي من المستحق قبل مقارنة المبلغ النقدي المستلم */
export function applyPrepaidCreditTowardDue({
  dueSyp,
  dueUsd = 0,
  prepaidCreditSyp = 0,
  usdSypRate = 0,
  isUsdBilling = false,
}) {
  const due = Math.max(0, Math.round(Number(dueSyp) || 0))
  let credit = Math.max(0, Math.round(Number(prepaidCreditSyp) || 0))
  const rate = Math.max(0, Number(usdSypRate) || 0)
  const dueUsdN = Math.max(0, round6(Number(dueUsd) || 0))

  if (!(credit > 0)) {
    return {
      creditAppliedSyp: 0,
      creditRemainingSyp: 0,
      dueAfterCreditSyp: due,
      dueAfterCreditUsd: isUsdBilling ? dueUsdN : 0,
    }
  }

  if (isUsdBilling && dueUsdN > 0 && rate > 0) {
    const creditAsUsd = round6(credit / rate)
    const useUsd = Math.min(creditAsUsd, dueUsdN)
    const creditAppliedSyp = Math.round(useUsd * rate)
    credit = Math.max(0, credit - creditAppliedSyp)
    const dueAfterCreditUsd = round6(dueUsdN - useUsd)
    return {
      creditAppliedSyp,
      creditRemainingSyp: credit,
      dueAfterCreditSyp: Math.round(dueAfterCreditUsd * rate),
      dueAfterCreditUsd,
    }
  }

  const creditAppliedSyp = Math.min(credit, due)
  credit = Math.max(0, credit - creditAppliedSyp)
  return {
    creditAppliedSyp,
    creditRemainingSyp: credit,
    dueAfterCreditSyp: Math.max(0, due - creditAppliedSyp),
    /** بدون سعر صرف: نبقي المستحق بالدولار كما هو إن كان البند مسعّراً بالدولار */
    dueAfterCreditUsd: isUsdBilling ? dueUsdN : 0,
  }
}

function netReceivedSypAfterUsdCollection(amountUsd, patientRefundSyp, patientRefundUsd, rate) {
  const u = Number(amountUsd)
  const r = Number(rate)
  const rs = Math.round(Number(patientRefundSyp) || 0)
  const ru = Number(patientRefundUsd) || 0
  if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(r) || r <= 0) return 0
  if (ru > 0) return Math.round((u - ru) * r) - rs
  return Math.round(u * r) - rs
}

/**
 * تأكيد دفع بند فوترة معلّق — نفس منطق POST /api/billing/:id/complete-payment
 *
 * @param {import('mongoose').Document} bi
 * @param {Record<string, unknown>} body
 * @param {import('mongoose').Document} receivedByUser
 * @param {{ skipPatientDebtUpdate?: boolean }} [opts]
 */
export async function completeBillingItemPayment(bi, body, receivedByUser, opts = {}) {
  if (!bi || bi.status !== 'pending_payment') {
    const err = new Error('البند ليس في انتظار الدفع')
    err.code = 'NOT_PENDING'
    throw err
  }

  const savedListDueSyp = Math.round(Number(bi.listAmountDueSyp || bi.amountDueSyp) || 0)
  const savedDiscountPercent = Number(bi.discountPercent) || 0
  const savedEffectiveDueSyp = Math.round(Number(bi.effectiveAmountDueSyp || bi.amountDueSyp) || 0)
  const dueBaseSyp = savedDiscountPercent > 0 ? savedEffectiveDueSyp : savedListDueSyp
  if (dueBaseSyp <= 0) {
    const err = new Error(
      bi.isPackagePrepaid
        ? 'هذه الجلسة ضمن باكج ولا يوجد مبلغ إضافي مستحق.'
        : 'لا يوجد مبلغ مستحق على هذا البند.',
    )
    err.code = 'ZERO_DUE'
    throw err
  }

  const reqBody = body ?? {}
  let discountMeta
  if (savedDiscountPercent > 0) {
    discountMeta = {
      discountPercent: savedDiscountPercent,
      listAmountDueSyp: savedListDueSyp,
      effectiveAmountDueSyp: savedEffectiveDueSyp,
    }
  } else {
    try {
      discountMeta = resolveBillingDiscount(savedListDueSyp, reqBody.discountPercent)
    } catch (e) {
      const msg = mapDiscountError(e)
      if (msg) {
        const err = new Error(msg)
        err.code = 'DISCOUNT'
        throw err
      }
      throw e
    }
  }
  const isCreditTopUp = bi.isCreditTopUp === true
  if (isCreditTopUp && discountMeta.discountPercent > 0) {
    const err = new Error('لا يمكن تطبيق خصم على شحن الرصيد الإضافي.')
    err.code = 'DISCOUNT'
    throw err
  }
  const dueForSettlement = discountMeta.effectiveAmountDueSyp
  const receipt = await resolveBillingPaymentReceipt(reqBody, bi.businessDate)
  const {
    payCurrency,
    netReceivedSyp,
    receivedAmountSyp: receivedSyp,
    receivedAmountUsd: receivedUsd,
    patientRefundSyp,
    patientRefundUsd,
    usdSypRateUsed,
    amountUsdRaw,
  } = receipt

  /** بند مسعّر بالدولار: الذمة/الفائض يُحفظان بالدولار عند الحاجة، والجرد يتبع عملة التحصيل */
  const isUsdBilling = String(bi.currency || 'SYP').toUpperCase() === 'USD'
  const dueUsd = isUsdBilling
    ? round6(Number(bi.effectiveAmountDueUsd || bi.amountDueUsd || bi.listAmountDueUsd) || 0)
    : 0

  let rateForCredit = usdSypRateUsed
  if (isUsdBilling && !(rateForCredit > 0)) {
    const fetched = await fetchUsdSypRateForBusinessDate(bi.businessDate)
    if (fetched != null) rateForCredit = fetched
  }

  const patient = await Patient.findById(bi.patientId).lean()
  let debt = Math.round(Number(patient?.outstandingDebtSyp) || 0)
  let debtUsd = round6(Number(patient?.outstandingDebtUsd) || 0)
  let credit = Math.round(Number(patient?.prepaidCreditSyp) || 0)

  let creditAppliedSyp = 0
  let dueAfterCreditSyp = dueForSettlement
  let dueAfterCreditUsd = dueUsd
  if (patient && !opts.skipPatientDebtUpdate && !isCreditTopUp) {
    const applied = applyPrepaidCreditTowardDue({
      dueSyp: dueForSettlement,
      dueUsd,
      prepaidCreditSyp: credit,
      usdSypRate: rateForCredit,
      isUsdBilling,
    })
    creditAppliedSyp = applied.creditAppliedSyp
    credit = applied.creditRemainingSyp
    dueAfterCreditSyp = applied.dueAfterCreditSyp
    dueAfterCreditUsd = applied.dueAfterCreditUsd
  }

  assertBillingCollectionAmountValid({ netReceivedSyp, dueForSettlement: dueAfterCreditSyp })
  if (isCreditTopUp && netReceivedSyp < dueAfterCreditSyp) {
    const err = new Error('شحن الرصيد الإضافي يتطلب تحصيل المبلغ كاملاً.')
    err.code = 'CREDIT_TOPUP_PARTIAL'
    throw err
  }

  let paymentChannel
  let bankName
  try {
    const requireBank = !isZeroCollectionAllowed(netReceivedSyp, dueAfterCreditSyp)
    ;({ paymentChannel, bankName } = await resolvePaymentChannelFromBody(reqBody, { requireBank }))
  } catch (chErr) {
    if (chErr?.code === 'BANK_REQUIRED') {
      const err = new Error(String(chErr.message))
      err.code = 'BANK_REQUIRED'
      throw err
    }
    throw chErr
  }

  const method = paymentChannel === 'bank' ? 'bank' : 'cash'
  const appliedAmountSyp = Math.min(netReceivedSyp, dueAfterCreditSyp)
  let absorbCashNetUsdQualifies = false
  if (payCurrency === 'USD' && usdSypRateUsed > 0) {
    if (patientRefundUsd > 0 && patientRefundSyp > 0) {
      absorbCashNetUsdQualifies = false
    } else if (patientRefundUsd > 0) {
      const netUsdCash = amountUsdRaw - patientRefundUsd
      absorbCashNetUsdQualifies =
        Number.isFinite(netUsdCash) &&
        netUsdCash > 0 &&
        Math.abs(netUsdCash - Math.round(netUsdCash)) < 1e-5
    } else if (patientRefundSyp > 0) {
      const implied = netReceivedSyp / usdSypRateUsed
      absorbCashNetUsdQualifies =
        Number.isFinite(implied) && implied > 0 && Math.abs(implied - Math.round(implied)) < 1e-5
    } else {
      absorbCashNetUsdQualifies =
        Number.isFinite(amountUsdRaw) &&
        amountUsdRaw > 0 &&
        Math.abs(amountUsdRaw - Math.round(amountUsdRaw)) < 1e-5
    }
  }

  const { settlementDeltaSyp, settlementDeltaUsd } = computeBillingSettlementDelta({
    payCurrency,
    netReceivedSyp,
    dueAfterCreditSyp,
    dueAfterCreditUsd,
    dueUsd,
    creditAppliedSyp,
    amountUsdRaw,
    usdSypRateUsed,
    rateForCredit,
    patientRefundUsd,
    absorbCashNetUsdQualifies,
    isUsdBilling,
  })

  const existingPay = await BillingPayment.findOne({ billingItemId: bi._id })
  if (existingPay) {
    const err = new Error(BILLING_PAYMENT_DUPLICATE_MSG)
    err.code = 'DUPLICATE'
    throw err
  }

  let payment
  try {
    payment = await BillingPayment.create({
      billingItemId: bi._id,
      amountSyp: appliedAmountSyp,
      receivedAmountSyp: receivedSyp,
      settlementDeltaSyp,
      settlementDeltaUsd: isUsdBilling ? settlementDeltaUsd : 0,
      creditAppliedSyp,
      ...paymentRecordReceivedFields(receipt),
      paymentChannel,
      bankName: paymentChannel === 'bank' ? bankName : '',
      method,
      receivedBy: receivedByUser._id,
      discountPercent: discountMeta.discountPercent,
      listAmountDueSyp: discountMeta.listAmountDueSyp,
      effectiveAmountDueSyp: discountMeta.effectiveAmountDueSyp,
    })
  } catch (createErr) {
    if (isMongoDuplicateKeyError(createErr)) {
      const err = new Error(BILLING_PAYMENT_DUPLICATE_MSG)
      err.code = 'DUPLICATE'
      throw err
    }
    throw createErr
  }

  bi.businessDate = todayBusinessDate()
  bi.status = 'paid'
  bi.paymentId = payment._id
  bi.paidAt = new Date()
  if (discountMeta.discountPercent > 0) {
    bi.discountPercent = discountMeta.discountPercent
    bi.listAmountDueSyp = discountMeta.listAmountDueSyp
    bi.effectiveAmountDueSyp = discountMeta.effectiveAmountDueSyp
    bi.amountDueSyp = discountMeta.effectiveAmountDueSyp
  }
  await bi.save()

  if (bi.department === 'laser') {
    await LaserSession.updateOne({ billingItemId: bi._id }, { $set: { status: 'completed' } })
  }

  let outstandingDebtSyp = debt
  let outstandingDebtUsd = debtUsd
  let prepaidCreditSyp = credit
  if (patient && !opts.skipPatientDebtUpdate) {
    // الرصيد الإضافي خُصم مسبقاً من المستحق؛ هنا فقط ذمة/فائض المبلغ النقدي
    if (isUsdBilling && Math.abs(settlementDeltaUsd) > 1e-9) {
      if (settlementDeltaUsd < 0) {
        debtUsd = round6(debtUsd + Math.abs(settlementDeltaUsd))
      } else if (settlementDeltaUsd > 0) {
        let extraUsd = round6(settlementDeltaUsd)
        const settleUsdDebt = Math.min(debtUsd, extraUsd)
        debtUsd = round6(debtUsd - settleUsdDebt)
        extraUsd = round6(extraUsd - settleUsdDebt)
        let extraSyp = usdSypRateUsed > 0 ? Math.round(extraUsd * usdSypRateUsed) : 0
        const settleSypDebt = Math.min(debt, extraSyp)
        debt -= settleSypDebt
        extraSyp -= settleSypDebt
        credit += Math.max(0, extraSyp)
      }
    } else if (settlementDeltaSyp < 0) {
      debt += Math.abs(settlementDeltaSyp)
    } else if (settlementDeltaSyp > 0) {
      let extra = settlementDeltaSyp
      const settleDebt = Math.min(debt, extra)
      debt -= settleDebt
      extra -= settleDebt
      if (extra > 0 && debtUsd > 0 && usdSypRateUsed > 0) {
        const extraAsUsd = round6(extra / usdSypRateUsed)
        const settleUsd = Math.min(debtUsd, extraAsUsd)
        debtUsd = round6(debtUsd - settleUsd)
        extra -= Math.round(settleUsd * usdSypRateUsed)
      }
      credit += Math.max(0, extra)
    }
    if (isCreditTopUp) {
      credit += Math.max(0, dueForSettlement)
    }
    await Patient.updateOne(
      { _id: bi.patientId },
      {
        $set: {
          outstandingDebtSyp: debt,
          outstandingDebtUsd: debtUsd,
          prepaidCreditSyp: credit,
        },
      },
    )
    outstandingDebtSyp = debt
    outstandingDebtUsd = debtUsd
    prepaidCreditSyp = credit
  } else if (patient) {
    outstandingDebtSyp = Math.round(Number(patient.outstandingDebtSyp) || 0)
    outstandingDebtUsd = round6(Number(patient.outstandingDebtUsd) || 0)
    prepaidCreditSyp = Math.round(Number(patient.prepaidCreditSyp) || 0)
  }

  let posting = { skipped: true, reason: 'unknown' }
  let postingError = null
  try {
    posting = await postBillingPayment(payment._id, receivedByUser._id)
  } catch (postErr) {
    postingError = postErr
    console.error('postBillingPayment:', postErr)
    try {
      await writeAudit({
        user: receivedByUser,
        action: 'دفع مؤكد — فشل الترحيل المحاسبي',
        entityType: 'BillingPayment',
        entityId: payment._id,
        details: {
          error: String(postErr?.message || postErr),
          receivedSyp,
          receivedUsd,
          payCurrency,
          appliedAmountSyp,
          settlementDeltaSyp,
          patientRefundSyp,
          patientRefundUsd,
          discountPercent: discountMeta.discountPercent,
        },
      })
    } catch (auditErr) {
      console.error('writeAudit (posting failure):', auditErr)
    }
  }

  if (!postingError) {
    try {
      await writeAudit({
        user: receivedByUser,
        action: 'تأكيد دفع بند فوترة',
        entityType: 'BillingItem',
        entityId: bi._id,
        details: {
          paymentId: String(payment._id),
          receivedSyp,
          receivedUsd,
          payCurrency,
          appliedAmountSyp,
          settlementDeltaSyp,
          creditAppliedSyp,
          paymentChannel,
          bankName: paymentChannel === 'bank' ? bankName : undefined,
          patientRefundSyp,
          patientRefundUsd,
          discountPercent: discountMeta.discountPercent,
          accountingSkipped: posting.skipped,
        },
      })
    } catch (auditErr) {
      console.error('writeAudit (payment success):', auditErr)
    }
  }

  if (bi.department === 'dental' && !isCreditTopUp) {
    try {
      const { applyDentalBillingPaymentToChart } = await import('./dentalChartBilling.js')
      await applyDentalBillingPaymentToChart(bi, payment)
    } catch (dentalSyncErr) {
      console.error('applyDentalBillingPaymentToChart:', dentalSyncErr)
    }
  }

  return {
    paymentId: String(payment._id),
    billingItemId: String(bi._id),
    posting,
    postingError: postingError ? String(postingError?.message || postingError) : null,
    patientSettlement: {
      outstandingDebtSyp,
      outstandingDebtUsd,
      prepaidCreditSyp,
      creditAppliedSyp,
      dueAfterCreditSyp,
    },
    payment: {
      amountSyp: payment.amountSyp,
      receivedAmountSyp: payment.receivedAmountSyp,
      settlementDeltaSyp: payment.settlementDeltaSyp,
      settlementDeltaUsd: payment.settlementDeltaUsd,
      creditAppliedSyp: payment.creditAppliedSyp,
      payCurrency: payment.payCurrency,
      receivedAmountUsd: payment.receivedAmountUsd,
      patientRefundSyp: payment.patientRefundSyp,
      patientRefundUsd: payment.patientRefundUsd,
      discountPercent: payment.discountPercent,
    },
  }
}
