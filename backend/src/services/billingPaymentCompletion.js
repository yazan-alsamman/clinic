import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { postBillingPayment } from './postingService.js'
import { resolvePaymentChannelFromBody } from './paymentChannelSettings.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'
import { round6 } from '../utils/money.js'
import { BILLING_PAYMENT_DUPLICATE_MSG, isMongoDuplicateKeyError } from '../utils/mongoErrors.js'

function netReceivedSypAfterUsdCollection(amountUsd, patientRefundSyp, patientRefundUsd, rate) {
  const u = Number(amountUsd)
  const r = Number(rate)
  const rs = Math.round(Number(patientRefundSyp) || 0)
  const ru = Number(patientRefundUsd) || 0
  if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(r) || r <= 0) return 0
  if (ru > 0) {
    return Math.round((u - ru) * r) - rs
  }
  return Math.round(u * r) - rs
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

/** تحصيل 0 ل.س مسموح — يُسجَّل كامل المستحق كذمة على المريض */
export function parseSypReceivedFromBody(body) {
  const raw = Number(body?.amountSyp)
  if (!Number.isFinite(raw) || raw < 0) return { ok: false }
  return { ok: true, receivedSyp: Math.round(raw) }
}

export function isZeroSypCollectionAllowed(receivedSyp, netReceivedSyp, dueForSettlement) {
  return receivedSyp === 0 && netReceivedSyp === 0 && dueForSettlement > 0
}

export function assertBillingCollectionAmountValid({ receivedSyp, netReceivedSyp, payCurrency, dueForSettlement }) {
  const zeroAllowed = payCurrency === 'SYP' && isZeroSypCollectionAllowed(receivedSyp, netReceivedSyp, dueForSettlement)
  if (!zeroAllowed && receivedSyp <= 0) {
    const err = new Error('مبلغ الدفع غير صالح')
    err.code = 'INVALID_AMOUNT'
    throw err
  }
  if (!zeroAllowed && netReceivedSyp <= 0) {
    const err = new Error('صافي المبلغ بعد الترجيع غير صالح — يجب أن يبقى للعيادة مبلغ موجب يغطي التحصيل.')
    err.code = 'INVALID_NET'
    throw err
  }
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
  const payCurrencyRaw = String(reqBody.payCurrency || 'SYP').trim().toUpperCase()
  const payCurrency = payCurrencyRaw === 'USD' ? 'USD' : 'SYP'

  let receivedSyp = 0
  let receivedUsd = 0
  let patientRefundSyp = 0
  let patientRefundUsd = 0
  let usdSypRateUsed = 0
  let amountUsdRaw = 0

  if (payCurrency === 'USD') {
    const bd = await BusinessDay.findOne({ businessDate: bi.businessDate }).lean()
    const rate = Number(bd?.usdSypRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      const err = new Error(
        'لا يتوفر سعر صرف مسجّل لتاريخ هذا البند. يجب تفعيل يوم العمل ذلك اليوم مع إدخال سعر الدولار مقابل الليرة.',
      )
      err.code = 'NO_RATE'
      throw err
    }
    amountUsdRaw = Number(reqBody.amountUsd)
    if (!Number.isFinite(amountUsdRaw) || amountUsdRaw <= 0) {
      const err = new Error('مبلغ الدفع بالدولار غير صالح')
      err.code = 'INVALID_USD'
      throw err
    }
    usdSypRateUsed = rate
    receivedSyp = Math.round(amountUsdRaw * rate)
    receivedUsd = round6(amountUsdRaw)
    if (receivedSyp <= 0) {
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

    if (patientRefundSyp > 0 && patientRefundSyp > receivedSyp) {
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
    if (patientRefundSyp + refundSypEquivUsd > receivedSyp) {
      const err = new Error('إجمالي الترجيع (ليرة ومقابل دولار) يتجاوز المبلغ المستلم بالليرة')
      err.code = 'INVALID_REFUND'
      throw err
    }
  } else {
    const parsed = parseSypReceivedFromBody(reqBody)
    if (!parsed.ok) {
      const err = new Error('مبلغ الدفع غير صالح')
      err.code = 'INVALID_AMOUNT'
      throw err
    }
    receivedSyp = parsed.receivedSyp
  }

  const netReceivedSyp =
    payCurrency === 'USD'
      ? netReceivedSypAfterUsdCollection(amountUsdRaw, patientRefundSyp, patientRefundUsd, usdSypRateUsed)
      : receivedSyp
  assertBillingCollectionAmountValid({ receivedSyp, netReceivedSyp, payCurrency, dueForSettlement })

  let paymentChannel
  let bankName
  try {
    const requireBank = !isZeroSypCollectionAllowed(receivedSyp, netReceivedSyp, dueForSettlement)
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
      payCurrency,
      receivedAmountUsd: payCurrency === 'USD' ? receivedUsd : 0,
      patientRefundSyp: payCurrency === 'USD' ? patientRefundSyp : 0,
      patientRefundUsd: payCurrency === 'USD' ? patientRefundUsd : 0,
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
  let prepaidCreditSyp = 0
  const patient = await Patient.findById(bi.patientId).lean()
  if (patient && !opts.skipPatientDebtUpdate) {
    let debt = Math.round(Number(patient.outstandingDebtSyp) || 0)
    let credit = Math.round(Number(patient.prepaidCreditSyp) || 0)
    if (settlementDeltaSyp < 0) {
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
      credit += extra
    }
    await Patient.updateOne(
      { _id: bi.patientId },
      {
        $set: {
          outstandingDebtSyp: debt,
          prepaidCreditSyp: credit,
        },
      },
    )
    outstandingDebtSyp = debt
    prepaidCreditSyp = credit
  } else if (patient) {
    outstandingDebtSyp = Math.round(Number(patient.outstandingDebtSyp) || 0)
    prepaidCreditSyp = Math.round(Number(patient.prepaidCreditSyp) || 0)
  }

  let posting = { skipped: true, reason: 'unknown' }
  try {
    posting = await postBillingPayment(payment._id, receivedByUser._id)
  } catch (postErr) {
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
    throw postErr
  }

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

  return {
    paymentId: String(payment._id),
    billingItemId: String(bi._id),
    posting,
    patientSettlement: { outstandingDebtSyp, prepaidCreditSyp },
    payment: {
      amountSyp: payment.amountSyp,
      receivedAmountSyp: payment.receivedAmountSyp,
      settlementDeltaSyp: payment.settlementDeltaSyp,
      payCurrency: payment.payCurrency,
      receivedAmountUsd: payment.receivedAmountUsd,
      patientRefundSyp: payment.patientRefundSyp,
      patientRefundUsd: payment.patientRefundUsd,
      discountPercent: payment.discountPercent,
    },
  }
}
