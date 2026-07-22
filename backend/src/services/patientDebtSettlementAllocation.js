import { Patient } from '../models/Patient.js'
import { PatientDebtSettlement } from '../models/PatientDebtSettlement.js'
import {
  buildPatientOpenDebtLinesFromData,
  loadBillingItemsAndPaymentsForPatients,
} from './openFinancialBalanceLines.js'
import { round6 } from '../utils/money.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

const KNOWN_DEPT = new Set(['laser', 'dermatology', 'dental', 'solarium', 'skin'])

export function normalizeDebtDepartment(dept) {
  const d = String(dept || '').trim().toLowerCase()
  return KNOWN_DEPT.has(d) ? d : 'general'
}

/**
 * يوزّع مبلغ التحصيل (بالليرة بعد التحويل) على سطور الذمة المفتوحة FIFO.
 * سطور USD تُغطى بتحويل المبلغ بسعر يوم التسديد مع الحفاظ على خصم الذمة بالدولار.
 */
export function allocateAppliedDebtAcrossLines(openLines, appliedToDebtSyp, itemById = new Map(), usdSypRate = 0) {
  let remaining = roundMoney(appliedToDebtSyp)
  const rate = Number(usdSypRate) || 0
  const allocations = []
  let appliedSypDebt = 0
  let appliedUsdDebt = 0

  for (const line of openLines || []) {
    if (!(remaining > 0)) break
    const currency = String(line.currency || 'SYP').toUpperCase() === 'USD' ? 'USD' : 'SYP'
    const bi = line.billingItemId ? itemById.get(String(line.billingItemId)) : null

    if (currency === 'USD') {
      const capUsd = round6(Number(line.amountUsd) || 0)
      if (!(capUsd > 1e-9) || !(rate > 0)) continue
      const maxUsdFromPay = remaining / rate
      const takeUsd = round6(Math.min(capUsd, maxUsdFromPay))
      if (!(takeUsd > 1e-9)) continue
      const takeSyp = Math.round(takeUsd * rate)
      if (!(takeSyp > 0)) continue
      remaining = roundMoney(remaining - takeSyp)
      appliedUsdDebt = round6(appliedUsdDebt + takeUsd)
      allocations.push({
        department: normalizeDebtDepartment(line.department),
        amountSyp: takeSyp,
        amountUsd: takeUsd,
        currency: 'USD',
        procedureLabel: String(line.procedureLabel || '').trim(),
        billingItemId: bi?._id || line.billingItemId || null,
        clinicalSessionId: bi?.clinicalSessionId || line.clinicalSessionId || null,
        providerUserId: bi?.providerUserId || null,
      })
      continue
    }

    const cap = roundMoney(Number(line.amountSyp) || 0)
    if (!(cap > 0)) continue
    const take = roundMoney(Math.min(remaining, cap))
    if (!(take > 0)) continue
    remaining = roundMoney(remaining - take)
    appliedSypDebt = roundMoney(appliedSypDebt + take)
    allocations.push({
      department: normalizeDebtDepartment(line.department),
      amountSyp: take,
      amountUsd: 0,
      currency: 'SYP',
      procedureLabel: String(line.procedureLabel || '').trim(),
      billingItemId: bi?._id || line.billingItemId || null,
      clinicalSessionId: bi?.clinicalSessionId || line.clinicalSessionId || null,
      providerUserId: bi?.providerUserId || null,
    })
  }

  return { allocations, appliedSypDebt, appliedUsdDebt, remainingPaySyp: remaining }
}

/** يُحسب توزيع تسديد الذمة على الأقسام قبل خصم المبلغ من ملف المريض */
export async function buildDepartmentAllocationsForSettlement(patientId, appliedToDebtSyp, usdSypRate = 0) {
  const applied = roundMoney(appliedToDebtSyp)
  if (!(applied > 0)) return { allocations: [], appliedSypDebt: 0, appliedUsdDebt: 0 }
  const patient = await Patient.findById(patientId)
    .select('outstandingDebtSyp outstandingDebtUsd prepaidCreditSyp sessionPackages')
    .lean()
  if (!patient) return { allocations: [], appliedSypDebt: 0, appliedUsdDebt: 0 }
  const { items, payments } = await loadBillingItemsAndPaymentsForPatients([patientId])
  const openLines = buildPatientOpenDebtLinesFromData(patient, items, payments)
  const itemById = new Map(items.map((i) => [String(i._id), i]))
  return allocateAppliedDebtAcrossLines(openLines, applied, itemById, usdSypRate)
}

export async function findDebtSettlementsForBusinessDateFilter(businessDateFilter) {
  return PatientDebtSettlement.find({ businessDate: businessDateFilter }).lean()
}

/** يُضاف إيراد تسديد ذمم الليزر إلى صفوف الأخصائيين (حسب مقدّم الجلسة الأصلية) */
export function applyLaserDebtAllocationsToSpecialistRows(rows, settlements, specialistIdSet) {
  const totals = new Map(rows.map((r) => [r.userId, { ...r }]))
  let debtSettlementUnassignedSyp = 0

  for (const ds of settlements || []) {
    for (const alloc of ds.departmentAllocations || []) {
      if (alloc.department !== 'laser') continue
      const amt = roundMoney(alloc.amountSyp)
      if (!(amt > 0)) continue
      const uid = alloc.providerUserId ? String(alloc.providerUserId) : ''
      if (uid && specialistIdSet.has(uid)) {
        const row = totals.get(uid)
        if (row) row.totalAmountSyp = roundMoney(row.totalAmountSyp + amt)
      } else {
        debtSettlementUnassignedSyp = roundMoney(debtSettlementUnassignedSyp + amt)
      }
    }
  }

  return {
    rows: [...totals.values()],
    debtSettlementUnassignedSyp,
  }
}

/** يُضاف جزء تسديد الذمة (ليزر) إلى تفصيل كاش/بنك */
export function mergeLaserDebtSettlementsIntoPaymentBreakdown(breakdown, settlements) {
  if (!breakdown || !settlements?.length) return breakdown
  let cashSyp = breakdown.cash?.totalSyp || 0
  let cashUsd = breakdown.cash?.totalUsd || 0
  const bankMap = new Map((breakdown.banks || []).map((b) => [String(b.bankName), { ...b }]))

  for (const ds of settlements) {
    const laserSyp = roundMoney(
      (ds.departmentAllocations || [])
        .filter((a) => a.department === 'laser')
        .reduce((s, a) => s + roundMoney(a.amountSyp), 0),
    )
    if (!(laserSyp > 0)) continue
    const channel = ds.paymentChannel === 'bank' ? 'bank' : 'cash'
    if (channel === 'cash') {
      cashSyp += laserSyp
    } else {
      const label = String(ds.bankName || '').trim() || 'بنك'
      const cur = bankMap.get(label) || { bankName: label, totalSyp: 0, totalUsd: 0 }
      cur.totalSyp += laserSyp
      bankMap.set(label, cur)
    }
  }

  const banks = [...bankMap.values()].sort((a, b) => String(a.bankName).localeCompare(String(b.bankName), 'ar'))
  const totalsSyp = cashSyp + banks.reduce((s, b) => s + roundMoney(b.totalSyp), 0)
  const totalsUsd = breakdown.totals?.totalUsd || 0
  return {
    cash: { totalSyp: cashSyp, totalUsd: cashUsd },
    banks,
    totals: { totalSyp: totalsSyp, totalUsd: totalsUsd },
  }
}
