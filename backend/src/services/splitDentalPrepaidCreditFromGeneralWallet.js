import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { Patient } from '../models/Patient.js'

function roundMoney(n) {
  return Math.max(0, Math.round(Number(n) || 0))
}

/**
 * ينقل ما تبقّى من شحن رصيد الأسنان من المحفظة العامة إلى prepaidCreditDentalSyp.
 * آمن لإعادة التشغيل: يتخطى من لديهم رصيد أسنان مخزّن مسبقاً.
 */
export async function splitDentalPrepaidCreditFromGeneralWallet() {
  const items = await BillingItem.find({
    department: 'dental',
    status: 'paid',
  })
    .select('_id patientId isCreditTopUp paymentId effectiveAmountDueSyp amountDueSyp')
    .lean()

  const payIds = [...new Set(items.map((i) => i.paymentId).filter(Boolean))]
  const pays = payIds.length
    ? await BillingPayment.find({ _id: { $in: payIds } })
        .select('billingItemId creditAppliedSyp settlementDeltaSyp effectiveAmountDueSyp')
        .lean()
    : []
  const payByItem = new Map(pays.map((p) => [String(p.billingItemId), p]))

  /** @type {Map<string, { topUp: number, applied: number, extra: number }>} */
  const byPatient = new Map()
  for (const bi of items) {
    const pid = String(bi.patientId)
    const acc = byPatient.get(pid) || { topUp: 0, applied: 0, extra: 0 }
    const pay = payByItem.get(String(bi._id))
    if (bi.isCreditTopUp === true) {
      acc.topUp += roundMoney(pay?.effectiveAmountDueSyp || bi.effectiveAmountDueSyp || bi.amountDueSyp)
    } else if (pay) {
      acc.applied += roundMoney(pay.creditAppliedSyp)
      const extra = Math.round(Number(pay.settlementDeltaSyp) || 0)
      if (extra > 0) acc.extra += extra
    }
    byPatient.set(pid, acc)
  }

  let patientsMoved = 0
  let amountMovedSyp = 0
  for (const [pid, acc] of byPatient) {
    const p = await Patient.findById(pid)
    if (!p) continue
    if (roundMoney(p.prepaidCreditDentalSyp) > 0) continue
    const should = Math.max(0, acc.topUp + acc.extra - acc.applied)
    const general = roundMoney(p.prepaidCreditSyp)
    const move = Math.min(should, general)
    if (!(move > 0)) continue
    p.prepaidCreditSyp = general - move
    p.prepaidCreditDentalSyp = move
    await p.save()
    patientsMoved += 1
    amountMovedSyp += move
  }

  return { patientsMoved, amountMovedSyp }
}
