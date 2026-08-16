import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { Patient } from '../models/Patient.js'
import { round6 } from '../utils/money.js'

function nearlyEqualUsd(a, b) {
  return Math.abs(round6(a) - round6(b)) < 0.02
}

function nearlyEqualSyp(a, b) {
  return Math.abs(Math.round(Number(a) || 0) - Math.round(Number(b) || 0)) <= 1
}

/**
 * إصلاح دفعات حُسبت بالكامل كرصيد إضافي رغم أن المستلم يطابق المستحق
 * (مثل $400 → +5,200,000 ل.س، سواء سُجّل التحصيل دولار أو ليرة).
 */
export async function repairUsdExactPaymentFalseCredit() {
  const pays = await BillingPayment.find({
    $or: [{ settlementDeltaSyp: { $gt: 0 } }, { settlementDeltaUsd: { $gt: 0 } }],
  })

  let scanned = 0
  let repaired = 0
  let creditReducedSyp = 0
  let recodedUsd = 0

  for (const pay of pays) {
    const bi = await BillingItem.findById(pay.billingItemId).select(
      '_id patientId currency status amountDueSyp effectiveAmountDueSyp listAmountDueSyp amountDueUsd effectiveAmountDueUsd listAmountDueUsd',
    )
    if (!bi || bi.status !== 'paid') continue
    scanned += 1

    const creditApplied = Math.round(Number(pay.creditAppliedSyp) || 0)
    if (creditApplied > 0) continue
    if ((Number(pay.patientRefundSyp) || 0) > 0 || (Number(pay.patientRefundUsd) || 0) > 0) continue

    const receivedSyp = Math.round(Number(pay.receivedAmountSyp) || 0)
    const receivedUsd = round6(Number(pay.receivedAmountUsd) || 0)
    const deltaSyp = Math.round(Number(pay.settlementDeltaSyp) || 0)
    const deltaUsd = round6(Number(pay.settlementDeltaUsd) || 0)
    const dueSyp = Math.round(
      Number(pay.effectiveAmountDueSyp || bi.effectiveAmountDueSyp || bi.amountDueSyp || bi.listAmountDueSyp) || 0,
    )
    const dueUsd = round6(Number(bi.effectiveAmountDueUsd || bi.amountDueUsd || bi.listAmountDueUsd) || 0)
    const itemIsUsd = String(bi.currency || 'SYP').toUpperCase() === 'USD' && dueUsd > 0

    const extraIsEntireSypReceipt = receivedSyp > 0 && nearlyEqualSyp(deltaSyp, receivedSyp)
    const extraIsEntireUsdReceipt =
      receivedUsd > 0 && (nearlyEqualUsd(deltaUsd, receivedUsd) || nearlyEqualUsd(deltaUsd, dueUsd))
    const paidExactSypDue = dueSyp > 0 && receivedSyp > 0 && nearlyEqualSyp(receivedSyp, dueSyp)
    const paidExactUsdDue = dueUsd > 0 && receivedUsd > 0 && nearlyEqualUsd(receivedUsd, dueUsd)

    const falseFxExtra =
      extraIsEntireSypReceipt &&
      (paidExactSypDue || (itemIsUsd && extraIsEntireUsdReceipt) || paidExactUsdDue)

    if (!falseFxExtra) continue

    const p = await Patient.findById(bi.patientId)
    if (p) {
      const credit = Math.max(0, Math.round(Number(p.prepaidCreditSyp) || 0))
      const nextCredit = Math.max(0, credit - deltaSyp)
      const reduced = credit - nextCredit
      if (reduced > 0) {
        p.prepaidCreditSyp = nextCredit
        await p.save()
        creditReducedSyp += reduced
      }
    }

    pay.settlementDeltaSyp = 0
    pay.settlementDeltaUsd = 0
    await pay.save()
    repaired += 1
  }

  return { scanned, repaired, creditReducedSyp, recodedUsd }
}
