import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { addCalendarDaysYmd, isValidYmd } from '../utils/date.js'

function money(n) {
  return Math.max(0, Math.round(Number(n) || 0))
}

/**
 * جلسات عليها رسم أو باكج بلا بند تحصيل معلّق لا تظهر في شاشة التحصيل
 * بينما الملف يعرض المستحق كمعلّق. نُنشئ البند الناقص ونملأ المبلغ إن كان صفراً.
 */
export async function repairUnbilledSessions(businessDate) {
  const end = isValidYmd(businessDate) ? businessDate : null
  if (!end) return { created: 0, updated: 0 }
  const start = addCalendarDaysYmd(end, -45)
  const sessions = await ClinicalSession.find({
    businessDate: { $gte: start, $lte: end },
    isCreditTopUp: { $ne: true },
    $or: [{ sessionFeeSyp: { $gt: 0 } }, { sessionFeeUsd: { $gt: 0 } }, { isPackageSession: true }],
  })
    .sort({ createdAt: -1 })
    .limit(300)
    .lean()

  let created = 0
  let updated = 0
  for (const cs of sessions) {
    const fee = money(cs.sessionFeeSyp)
    const feeUsd = Math.max(0, Number(cs.sessionFeeUsd) || 0)
    const packageSession = cs.isPackageSession === true
    const onSelectedDay = String(cs.businessDate || '') === end
    if (!(fee > 0) && !(feeUsd > 0) && !(packageSession && onSelectedDay)) continue

    let bi = null
    if (cs.billingItemId) bi = await BillingItem.findById(cs.billingItemId)
    if (!bi) bi = await BillingItem.findOne({ clinicalSessionId: cs._id })
    if (bi && (bi.status === 'paid' || bi.status === 'cancelled')) {
      if (cs.billingItemId && String(cs.billingItemId) !== String(bi._id)) {
        await ClinicalSession.updateOne({ _id: cs._id }, { $set: { billingItemId: bi._id } })
      }
      continue
    }

    const label = String(cs.procedureDescription || '').trim().slice(0, 500) || 'جلسة'
    const currency = String(cs.feeCurrency || '').toUpperCase() === 'USD' ? 'USD' : 'SYP'
    if (!bi) {
      try {
        bi = await BillingItem.create({
          clinicalSessionId: cs._id,
          patientId: cs.patientId,
          providerUserId: cs.providerUserId,
          department: cs.department,
          procedureLabel: label,
          listAmountDueSyp: fee,
          discountPercent: 0,
          effectiveAmountDueSyp: fee,
          amountDueSyp: fee,
          listAmountDueUsd: currency === 'USD' ? feeUsd : 0,
          effectiveAmountDueUsd: currency === 'USD' ? feeUsd : 0,
          amountDueUsd: currency === 'USD' ? feeUsd : 0,
          currency,
          businessDate: String(cs.businessDate || end),
          status: 'pending_payment',
          isPackagePrepaid: packageSession,
          patientPackageId: String(cs.patientPackageId || ''),
          patientPackageSessionId: String(cs.patientPackageSessionId || ''),
        })
        created += 1
      } catch (e) {
        if (e?.code !== 11000) throw e
        bi = await BillingItem.findOne({ clinicalSessionId: cs._id })
      }
      if (bi) {
        await ClinicalSession.updateOne({ _id: cs._id }, { $set: { billingItemId: bi._id } })
      }
      continue
    }

    if (bi.status !== 'pending_payment') continue
    let changed = false
    const amount = money(bi.amountDueSyp)
    const list = money(bi.listAmountDueSyp)
    const effective = money(bi.effectiveAmountDueSyp)
    if (amount > 0 && (list === 0 || effective === 0)) {
      if (list === 0) bi.listAmountDueSyp = amount
      if (effective === 0) bi.effectiveAmountDueSyp = amount
      changed = true
    } else if (!bi.isPackagePrepaid && amount === 0 && list === 0 && effective === 0 && fee > 0) {
      bi.amountDueSyp = fee
      bi.listAmountDueSyp = fee
      bi.effectiveAmountDueSyp = fee
      changed = true
    }
    if (!bi.businessDate && cs.businessDate) {
      bi.businessDate = String(cs.businessDate)
      changed = true
    }
    if (changed) {
      await bi.save()
      updated += 1
    }
    if (!cs.billingItemId || String(cs.billingItemId) !== String(bi._id)) {
      await ClinicalSession.updateOne({ _id: cs._id }, { $set: { billingItemId: bi._id } })
    }
  }
  return { created, updated }
}
