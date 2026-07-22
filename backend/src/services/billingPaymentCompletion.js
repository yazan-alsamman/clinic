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
  assertBillingCollectionAmountValid({ netReceivedSyp, dueForSettlement })

  let paymentChannel
  let bankName
  try {
    const requireBank = !isZeroCollectionAllowed(netReceivedSyp, dueForSettlement)
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
  const appliedAmountSyp = Math.min(netReceivedSyp, dueForSettlement)
  let settlementDeltaSyp = netReceivedSyp - dueForSettlement
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
  if (
    payCurrency === 'USD' &&
    usdSypRateUsed > 0 &&
    settlementDeltaSyp > 0 &&
    settlementDeltaSyp <= usdSypRateUsed &&
    absorbCashNetUsdQualifies
  ) {
    settlementDeltaSyp = 0
  }

  /** بند مسعّر بالدولار: الذمة/الفائض يُحفظان بالدولار */
  const isUsdBilling = String(bi.currency || 'SYP').toUpperCase() === 'USD'
  const dueUsd = isUsdBilling
    ? round6(Number(bi.effectiveAmountDueUsd || bi.amountDueUsd || bi.listAmountDueUsd) || 0)
    : 0
  let settlementDeltaUsd = 0
  if (isUsdBilling && dueUsd > 0 && usdSypRateUsed > 0) {
    const netUsd = round6(netReceivedSyp / usdSypRateUsed)
    settlementDeltaUsd = round6(netUsd - dueUsd)
    if (
      payCurrency === 'USD' &&
      settlementDeltaUsd > 0 &&
      settlementDeltaUsd * usdSypRateUsed <= usdSypRateUsed &&
      absorbCashNetUsdQualifies
    ) {
      settlementDeltaUsd = 0
    }
    settlementDeltaSyp = Math.round(settlementDeltaUsd * usdSypRateUsed)
  }

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

  let outstandingDebtSyp = 0
  let outstandingDebtUsd = 0
  let prepaidCreditSyp = 0
  const patient = await Patient.findById(bi.patientId).lean()
  if (patient && !opts.skipPatientDebtUpdate) {
    let debt = Math.round(Number(patient.outstandingDebtSyp) || 0)
    let debtUsd = round6(Number(patient.outstandingDebtUsd) || 0)
    let credit = Math.round(Number(patient.prepaidCreditSyp) || 0)

    if (isUsdBilling && Math.abs(settlementDeltaUsd) > 1e-9) {
      if (settlementDeltaUsd < 0) {
        let needUsd = round6(Math.abs(settlementDeltaUsd))
        if (credit > 0 && usdSypRateUsed > 0) {
          const creditAsUsd = round6(credit / usdSypRateUsed)
          const useCreditUsd = Math.min(creditAsUsd, needUsd)
          const useCreditSyp = Math.round(useCreditUsd * usdSypRateUsed)
          credit = Math.max(0, credit - useCreditSyp)
          needUsd = round6(needUsd - useCreditUsd)
        }
        debtUsd = round6(debtUsd + needUsd)
      } else if (settlementDeltaUsd > 0) {
        let extraUsd = round6(settlementDeltaUsd)
        const settleUsdDebt = Math.min(debtUsd, extraUsd)
        debtUsd = round6(debtUsd - settleUsdDebt)
        extraUsd = round6(extraUsd - settleUsdDebt)
        let extraSyp = usdSypRateUsed > 0 ? Math.round(extraUsd * usdSypRateUsed) : 0
        const settleSypDebt = Math.min(debt, extraSyp)
        debt -= settleSypDebt
        extraSyp -= settleSypDebt
        credit += extraSyp
      }
    } else if (settlementDeltaSyp < 0) {
      let need = Math.abs(settlementDeltaSyp)
      const useCredit = Math.min(credit, need)
      credit -= useCredit
      need -= useCredit
      debt += need
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

  return {
    paymentId: String(payment._id),
    billingItemId: String(bi._id),
    posting,
    postingError: postingError ? String(postingError?.message || postingError) : null,
    patientSettlement: { outstandingDebtSyp, outstandingDebtUsd, prepaidCreditSyp },
    payment: {
      amountSyp: payment.amountSyp,
      receivedAmountSyp: payment.receivedAmountSyp,
      settlementDeltaSyp: payment.settlementDeltaSyp,
      settlementDeltaUsd: payment.settlementDeltaUsd,
      payCurrency: payment.payCurrency,
      receivedAmountUsd: payment.receivedAmountUsd,
      patientRefundSyp: payment.patientRefundSyp,
      patientRefundUsd: payment.patientRefundUsd,
      discountPercent: payment.discountPercent,
    },
  }
}
