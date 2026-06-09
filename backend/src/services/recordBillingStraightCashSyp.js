import mongoose from 'mongoose'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { Patient } from '../models/Patient.js'
import { postBillingPayment } from './postingService.js'
import { resolvePaymentChannelFromBody } from './paymentChannelSettings.js'
import { writeAudit } from '../utils/audit.js'
import { round6 } from '../utils/money.js'
import { todayBusinessDate } from '../utils/date.js'
import { BILLING_PAYMENT_DUPLICATE_MSG, isMongoDuplicateKeyError } from '../utils/mongoErrors.js'

/** صافي ل.س بعد دفع USD بلا ترجيع — يطابق billing / frontend usdExactDue */
function netReceivedSypFromUsd(amountUsd, rate) {
  const u = Number(amountUsd)
  const r = Number(rate)
  if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(r) || r <= 0) return 0
  return Math.round(u * r)
}

function settlementDeltaAfterUsdCashNetAbsorb({ netReceivedSyp, amountDueSyp, rate, amountUsd }) {
  const rawDelta = netReceivedSyp - amountDueSyp
  if (!(rate > 0) || rawDelta <= 0 || rawDelta > rate) return rawDelta
  const u = Number(amountUsd)
  if (!Number.isFinite(u) || u <= 0) return rawDelta
  if (Math.abs(u - Math.round(u)) > 1e-5) return rawDelta
  return 0
}

/**
 * @param {Record<string, unknown>} body
 * @param {{ dueSyp: number, businessDate: string }} ctx
 */
export async function resolvePackageCollectionFromBody(body, ctx) {
  const dueSyp = Math.max(0, Math.round(Number(ctx.dueSyp) || 0))
  if (!(dueSyp > 0)) {
    const err = new Error('لا يوجد مبلغ للتحصيل')
    throw err
  }
  const payCurrencyRaw = String(body?.payCurrency || 'SYP').trim().toUpperCase()
  const payCurrency = payCurrencyRaw === 'USD' ? 'USD' : 'SYP'
  const { paymentChannel, bankName } = await resolvePaymentChannelFromBody(body)

  if (payCurrency === 'USD') {
    const amountUsd = Number(body?.amountUsd)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      const err = new Error('مبلغ الدفع بالدولار غير صالح')
      throw err
    }
    const businessDate = String(ctx.businessDate || '').trim() || todayBusinessDate()
    const bd = await BusinessDay.findOne({ businessDate }).lean()
    const rate = Number(bd?.usdSypRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      const err = new Error(
        'لا يتوفر سعر صرف مسجّل لتاريخ العمل. يجب تفعيل يوم العمل مع إدخال سعر الدولار مقابل الليرة.',
      )
      throw err
    }
    const receivedSyp = netReceivedSypFromUsd(amountUsd, rate)
    if (receivedSyp < dueSyp) {
      const err = new Error('المبلغ بالدولار لا يغطي المبلغ المدفوع بالليرة')
      throw err
    }
    return {
      payCurrency: 'USD',
      paymentChannel,
      bankName,
      amountUsd: round6(amountUsd),
      amountSyp: receivedSyp,
      usdSypRate: rate,
    }
  }

  const amountSypRaw = Number(body?.amountSyp)
  const amountSyp =
    Number.isFinite(amountSypRaw) && amountSypRaw > 0 ? Math.round(amountSypRaw) : dueSyp
  if (amountSyp < dueSyp) {
    const err = new Error('مبلغ التحصيل بالليرة أقل من المبلغ المدفوع')
    throw err
  }
  return {
    payCurrency: 'SYP',
    paymentChannel,
    bankName,
    amountUsd: 0,
    amountSyp,
    usdSypRate: 0,
  }
}

/**
 * تأكيد تحصيل كامل لبند معلّق (ليرة و/أو دولار، كاش أو بنك).
 *
 * @param {{
 *   billingItemId: string | import('mongoose').Types.ObjectId
 *   receivedByUser: import('mongoose').Document
 *   paymentChannel?: 'cash' | 'bank'
 *   bankName?: string
 *   payCurrency?: 'SYP' | 'USD'
 *   amountSyp?: number
 *   amountUsd?: number
 *   skipPatientDebtUpdate?: boolean
 * }} opts
 */
export async function recordBillingStraightPayment({
  billingItemId,
  receivedByUser,
  paymentChannel = 'cash',
  bankName = '',
  payCurrency = 'SYP',
  amountSyp,
  amountUsd = 0,
  skipPatientDebtUpdate = false,
}) {
  const id = billingItemId
  if (!mongoose.isValidObjectId(id)) {
    throw new Error('معرّف بند الفوترة غير صالح')
  }
  const bi = await BillingItem.findById(id)
  if (!bi) throw new Error('البند غير موجود')
  if (bi.status !== 'pending_payment') throw new Error('البند ليس في انتظار الدفع')

  const savedListDueSyp = Math.round(Number(bi.listAmountDueSyp || bi.amountDueSyp) || 0)
  const savedDiscountPercent = Number(bi.discountPercent) || 0
  const savedEffectiveDueSyp = Math.round(Number(bi.effectiveAmountDueSyp || bi.amountDueSyp) || 0)
  const dueForSettlement = savedDiscountPercent > 0 ? savedEffectiveDueSyp : savedListDueSyp
  if (!(dueForSettlement > 0)) throw new Error('لا يوجد مبلغ مستحق على هذا البند')

  const payCur = payCurrency === 'USD' ? 'USD' : 'SYP'
  let receivedSyp = 0
  let receivedUsd = 0
  let usdSypRateUsed = 0

  if (payCur === 'USD') {
    const bd = await BusinessDay.findOne({ businessDate: bi.businessDate }).lean()
    const rate = Number(bd?.usdSypRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(
        'لا يتوفر سعر صرف مسجّل لتاريخ هذا البند. يجب تفعيل يوم العمل ذلك اليوم مع إدخال سعر الدولار.',
      )
    }
    const amountUsdRaw = Number(amountUsd)
    if (!Number.isFinite(amountUsdRaw) || amountUsdRaw <= 0) {
      throw new Error('مبلغ الدفع بالدولار غير صالح')
    }
    usdSypRateUsed = rate
    receivedSyp = netReceivedSypFromUsd(amountUsdRaw, rate)
    receivedUsd = round6(amountUsdRaw)
    if (receivedSyp < dueForSettlement) {
      throw new Error('المبلغ بالدولار لا يغطي المستحق على البند')
    }
  } else {
    const amountSypRaw = Number(amountSyp)
    receivedSyp =
      Number.isFinite(amountSypRaw) && amountSypRaw > 0 ? Math.round(amountSypRaw) : dueForSettlement
    if (receivedSyp < dueForSettlement) {
      throw new Error('مبلغ التحصيل بالليرة أقل من المستحق')
    }
  }

  const appliedAmountSyp = dueForSettlement
  let settlementDeltaSyp = receivedSyp - dueForSettlement
  if (payCur === 'USD' && usdSypRateUsed > 0) {
    settlementDeltaSyp = settlementDeltaAfterUsdCashNetAbsorb({
      netReceivedSyp: receivedSyp,
      amountDueSyp: dueForSettlement,
      rate: usdSypRateUsed,
      amountUsd: Number(amountUsd),
    })
  }

  const existingPay = await BillingPayment.findOne({ billingItemId: bi._id })
  if (existingPay) throw new Error(BILLING_PAYMENT_DUPLICATE_MSG)

  let payment
  try {
    payment = await BillingPayment.create({
      billingItemId: bi._id,
      amountSyp: appliedAmountSyp,
      receivedAmountSyp: receivedSyp,
      settlementDeltaSyp,
      payCurrency: payCur,
      receivedAmountUsd: payCur === 'USD' ? receivedUsd : 0,
      patientRefundSyp: 0,
      patientRefundUsd: 0,
      paymentChannel: paymentChannel === 'bank' ? 'bank' : 'cash',
      bankName: paymentChannel === 'bank' ? String(bankName || '').trim() : '',
      method: paymentChannel === 'bank' ? 'bank' : 'cash',
      receivedBy: receivedByUser._id,
      discountPercent: savedDiscountPercent,
      listAmountDueSyp: savedListDueSyp,
      effectiveAmountDueSyp: savedEffectiveDueSyp,
    })
  } catch (createErr) {
    if (isMongoDuplicateKeyError(createErr)) {
      throw new Error(BILLING_PAYMENT_DUPLICATE_MSG)
    }
    throw createErr
  }

  bi.businessDate = todayBusinessDate()
  bi.status = 'paid'
  bi.paymentId = payment._id
  bi.paidAt = new Date()
  await bi.save()

  let outstandingDebtSyp = 0
  let prepaidCreditSyp = 0
  const patient = await Patient.findById(bi.patientId).lean()
  if (patient && !skipPatientDebtUpdate) {
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
          appliedAmountSyp,
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
        payCurrency: payCur,
        receivedAmountUsd: payCur === 'USD' ? receivedUsd : undefined,
        appliedAmountSyp,
        settlementDeltaSyp,
        paymentChannel: paymentChannel === 'bank' ? 'bank' : 'cash',
        bankName: paymentChannel === 'bank' ? String(bankName || '').trim() : undefined,
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
  }
}

/** @deprecated استخدم recordBillingStraightPayment — تحصيل ليرة كاش/بنك بالكامل */
export async function recordBillingStraightCashSyp(opts) {
  return recordBillingStraightPayment({
    ...opts,
    payCurrency: 'SYP',
  })
}
