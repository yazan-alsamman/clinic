import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { Patient } from '../models/Patient.js'
import { round6 } from '../utils/money.js'

function nearlyEqualUsd(a, b) {
  return Math.abs(round6(a) - round6(b)) < 0.02
}

/**
 * إصلاح دفعات بنود مسعّرة بالدولار حُسبت بالكامل كرصيد إضافي بالليرة
 * رغم أن المبلغ المستلم بالدولار يطابق المستحق (مثل 400$ → +5,200,000 ل.س).
 */
export async function repairUsdExactPaymentFalseCredit() {
  const items = await BillingItem.find({ status: 'paid', currency: 'USD' })
    .select('_id patientId amountDueUsd effectiveAmountDueUsd listAmountDueUsd')
    .lean()

  let scanned = 0
  let repaired = 0
  let creditReducedSyp = 0

  for (const bi of items) {
    const dueUsd = round6(Number(bi.effectiveAmountDueUsd || bi.amountDueUsd || bi.listAmountDueUsd) || 0)
    if (!(dueUsd > 0)) continue
    const pay = await BillingPayment.findOne({ billingItemId: bi._id })
    if (!pay) continue
    scanned += 1

    const receivedUsd = round6(Number(pay.receivedAmountUsd) || 0)
    const deltaUsd = round6(Number(pay.settlementDeltaUsd) || 0)
    const deltaSyp = Math.round(Number(pay.settlementDeltaSyp) || 0)
    if (!(deltaSyp > 0) || !(receivedUsd > 0)) continue
    if (!nearlyEqualUsd(receivedUsd, dueUsd)) continue
    if (!nearlyEqualUsd(deltaUsd, receivedUsd) && !nearlyEqualUsd(deltaUsd, dueUsd)) continue

    if (pay.patientRefundSyp > 0 || pay.patientRefundUsd > 0) continue

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

  return { scanned, repaired, creditReducedSyp }
}
