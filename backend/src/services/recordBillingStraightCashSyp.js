import mongoose from 'mongoose'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { Patient } from '../models/Patient.js'
import { postBillingPayment } from './postingService.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'

/**
 * تأكيد تحصيل بالليرة بالكامل لبند معلّق (بدون خصم، بدون دولار).
 * يُستخدم لتدفّق السولاريوم والباكجات وغيرها عند الحاجة.
 *
 * @param {{
 *   billingItemId: string | import('mongoose').Types.ObjectId
 *   receivedByUser: import('mongoose').Document
 *   paymentChannel?: 'cash' | 'bank'
 *   bankName?: string
 * }} opts
 */
export async function recordBillingStraightCashSyp({
  billingItemId,
  receivedByUser,
  paymentChannel = 'cash',
  bankName = '',
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

  const receivedSyp = dueForSettlement
  const settlementDeltaSyp = 0
  const appliedAmountSyp = dueForSettlement

  const existingPay = await BillingPayment.findOne({ billingItemId: bi._id })
  if (existingPay) throw new Error('تم تسجيل دفعة لهذا البند مسبقاً')

  const payment = await BillingPayment.create({
    billingItemId: bi._id,
    amountSyp: appliedAmountSyp,
    receivedAmountSyp: receivedSyp,
    settlementDeltaSyp,
    payCurrency: 'SYP',
    receivedAmountUsd: 0,
    patientRefundSyp: 0,
    patientRefundUsd: 0,
    paymentChannel: paymentChannel === 'bank' ? 'bank' : 'cash',
    bankName: paymentChannel === 'bank' ? String(bankName || '').trim() : '',
    method: paymentChannel === 'bank' ? 'bank' : 'cash',
    receivedBy: receivedByUser._id,
    discountPercent: 0,
    listAmountDueSyp: savedListDueSyp,
    effectiveAmountDueSyp: savedEffectiveDueSyp,
  })

  bi.businessDate = todayBusinessDate()
  bi.status = 'paid'
  bi.paymentId = payment._id
  bi.paidAt = new Date()
  await bi.save()

  let outstandingDebtSyp = 0
  let prepaidCreditSyp = 0
  const patient = await Patient.findById(bi.patientId).lean()
  if (patient) {
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
        payCurrency: 'SYP',
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
