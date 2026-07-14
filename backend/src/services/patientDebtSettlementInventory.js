import { PatientDebtSettlement } from '../models/PatientDebtSettlement.js'
import { normalizeDebtDepartment } from './patientDebtSettlementAllocation.js'

export const DEBT_SETTLEMENT_DEPT_KEY = 'debt_settlement'
export const DEBT_SETTLEMENT_DEPT_LABEL = 'تسديد ذمم'

const DEPT_LABEL_AR = {
  laser: 'ليزر',
  dermatology: 'جلدية',
  dental: 'أسنان',
  solarium: 'سولاريوم',
  skin: 'بشرة',
  general: 'عام',
  debt_settlement: DEBT_SETTLEMENT_DEPT_LABEL,
}

function deptLabel(key) {
  return DEPT_LABEL_AR[key] ?? key
}

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

function round2(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 100) / 100
}

function debtSettlementCashParts(ds) {
  const payCur = String(ds.payCurrency || 'SYP').toUpperCase()
  const enteredSyp = roundMoney(ds.enteredSyp)
  const usdPart = round2(Number(ds.receivedAmountUsd) || 0)
  const refSyp = roundMoney(ds.patientRefundSyp)
  const refUsd = round2(Number(ds.patientRefundUsd) || 0)
  const sypCash = roundMoney(ds.receivedAmountSypCash)

  if (payCur === 'USD') {
    return {
      payCurrency: 'USD',
      cashSyp: -refSyp,
      cashUsd: round2(usdPart - refUsd),
      displaySyp: enteredSyp,
      displayUsd: usdPart,
    }
  }
  if (payCur === 'MIXED') {
    return {
      payCurrency: 'MIXED',
      cashSyp: sypCash > 0 ? sypCash : Math.max(0, enteredSyp - Math.round(usdPart * (Number(ds.usdSypRateUsed) || 0))),
      cashUsd: usdPart,
      displaySyp: sypCash > 0 ? sypCash : enteredSyp,
      displayUsd: usdPart,
    }
  }
  return {
    payCurrency: 'SYP',
    cashSyp: enteredSyp,
    cashUsd: 0,
    displaySyp: enteredSyp,
    displayUsd: 0,
  }
}

function bumpDeptBucket(rollup, deptKey, channel, amountSyp, amountUsd = 0) {
  if (!rollup.byDept[deptKey]) {
    rollup.byDept[deptKey] = {
      key: deptKey,
      label: deptLabel(deptKey),
      transactionCount: 0,
      cashSyp: 0,
      cashUsd: 0,
      bankSyp: 0,
      bankUsd: 0,
    }
  }
  rollup.byDept[deptKey].transactionCount += 1
  const syp = roundMoney(amountSyp)
  const usd = round2(amountUsd)
  if (channel === 'cash') {
    rollup.byDept[deptKey].cashSyp += syp
    rollup.byDept[deptKey].cashUsd = round2(rollup.byDept[deptKey].cashUsd + usd)
  } else {
    rollup.byDept[deptKey].bankSyp += syp
    rollup.byDept[deptKey].bankUsd = round2(rollup.byDept[deptKey].bankUsd + usd)
  }
}

function addCashbook(rollup, channel, bankLabel, cashSyp, cashUsd) {
  if (channel === 'cash') {
    rollup.cash.totalSyp += roundMoney(cashSyp)
    rollup.cash.totalUsd = round2((rollup.cash.totalUsd || 0) + cashUsd)
    return
  }
  if (!rollup.bankMap) rollup.bankMap = new Map()
  const cur = rollup.bankMap.get(bankLabel) || { bankName: bankLabel, totalSyp: 0, totalUsd: 0 }
  cur.totalSyp += roundMoney(cashSyp)
  cur.totalUsd = round2(cur.totalUsd + cashUsd)
  rollup.bankMap.set(bankLabel, cur)
}

export async function fetchPatientDebtSettlementsForDate(businessDate) {
  return PatientDebtSettlement.find({ businessDate })
    .sort({ receivedAt: 1, createdAt: 1 })
    .populate('patientId', 'name')
    .populate('receivedBy', 'name')
    .lean()
}

/** يدمج تسديدات الذمة في تجميع الجرد (كاش + سجل العمليات) */
export function mergeDebtSettlementsIntoRollup(rollup, settlements) {
  if (!settlements?.length) return rollup

  for (const ds of settlements) {
    const enteredSyp = Math.round(Number(ds.enteredSyp) || 0)
    if (!(enteredSyp > 0)) continue

    const appliedToDebtSyp = Math.round(Number(ds.appliedToDebtSyp) || 0)
    const extraToCreditSyp = Math.round(Number(ds.extraToCreditSyp) || 0)
    const debtBefore = Math.round(Number(ds.debtBefore) || 0)
    const parts = debtSettlementCashParts(ds)

    const channel = ds.paymentChannel === 'bank' ? 'bank' : 'cash'
    const bankLabel = String(ds.bankName || '').trim() || 'بنك'

    addCashbook(rollup, channel, bankLabel, parts.cashSyp, parts.cashUsd)

    const allocations = Array.isArray(ds.departmentAllocations)
      ? ds.departmentAllocations.filter((a) => roundMoney(a.amountSyp) > 0)
      : []

    const patientName =
      ds.patientId && typeof ds.patientId === 'object' && 'name' in ds.patientId
        ? String(ds.patientId.name || '').trim()
        : ''
    const receivedByName =
      ds.receivedBy && typeof ds.receivedBy === 'object' && 'name' in ds.receivedBy
        ? String(ds.receivedBy.name || '').trim()
        : ''

    if (allocations.length > 0) {
      for (const alloc of allocations) {
        const allocSyp = roundMoney(alloc.amountSyp)
        const deptKey = normalizeDebtDepartment(alloc.department)
        bumpDeptBucket(rollup, deptKey, channel, allocSyp, 0)

        const labelPart = String(alloc.procedureLabel || '').trim()
        const procedureLabel = labelPart
          ? `تسديد ذمة (${deptLabel(deptKey)}): ${labelPart}`
          : `تسديد ذمة — ${deptLabel(deptKey)}`

        rollup.transactions.push({
          billingItemId: alloc.billingItemId ? String(alloc.billingItemId) : '',
          paymentId: `debt-settlement-${String(ds._id)}-${deptKey}`,
          transactionKind: 'debt_settlement',
          paidAt: ds.receivedAt
            ? new Date(ds.receivedAt).toISOString()
            : ds.createdAt
              ? new Date(ds.createdAt).toISOString()
              : null,
          patientName: patientName || '—',
          providerName: '—',
          receivedByName: receivedByName || '—',
          department: deptKey,
          departmentLabel: deptLabel(deptKey),
          procedureLabel,
          paymentChannel: channel,
          bankName: channel === 'bank' ? bankLabel : '',
          payCurrency: parts.payCurrency,
          receivedAmountSyp: allocSyp,
          receivedAmountUsd: 0,
          amountDueSyp: allocSyp,
          settlementDeltaSyp: 0,
          patientRefundSyp: 0,
          patientRefundUsd: 0,
        })
      }
      if (extraToCreditSyp > 0) {
        bumpDeptBucket(rollup, DEBT_SETTLEMENT_DEPT_KEY, channel, extraToCreditSyp, 0)
        rollup.transactions.push({
          billingItemId: '',
          paymentId: `debt-settlement-${String(ds._id)}-credit`,
          transactionKind: 'debt_settlement',
          paidAt: ds.receivedAt
            ? new Date(ds.receivedAt).toISOString()
            : ds.createdAt
              ? new Date(ds.createdAt).toISOString()
              : null,
          patientName: patientName || '—',
          providerName: '—',
          receivedByName: receivedByName || '—',
          department: DEBT_SETTLEMENT_DEPT_KEY,
          departmentLabel: DEBT_SETTLEMENT_DEPT_LABEL,
          procedureLabel: `فائض تسديد ذمة للرصيد الإضافي: ${extraToCreditSyp.toLocaleString('ar-SY')} ل.س`,
          paymentChannel: channel,
          bankName: channel === 'bank' ? bankLabel : '',
          payCurrency: parts.payCurrency,
          receivedAmountSyp: extraToCreditSyp,
          receivedAmountUsd: 0,
          amountDueSyp: 0,
          settlementDeltaSyp: extraToCreditSyp,
          patientRefundSyp: 0,
          patientRefundUsd: 0,
        })
      }
      // صف واحد يلخّص نقدية الدولار إن وُجد — ليظهر في الجرد
      if (parts.payCurrency === 'USD' || parts.payCurrency === 'MIXED') {
        rollup.transactions.push({
          billingItemId: '',
          paymentId: `debt-settlement-${String(ds._id)}-cash`,
          transactionKind: 'debt_settlement',
          paidAt: ds.receivedAt
            ? new Date(ds.receivedAt).toISOString()
            : ds.createdAt
              ? new Date(ds.createdAt).toISOString()
              : null,
          patientName: patientName || '—',
          providerName: '—',
          receivedByName: receivedByName || '—',
          department: DEBT_SETTLEMENT_DEPT_KEY,
          departmentLabel: DEBT_SETTLEMENT_DEPT_LABEL,
          procedureLabel:
            parts.payCurrency === 'MIXED'
              ? `تحصيل تسديد ذمة مختلط — ${parts.displaySyp.toLocaleString('ar-SY')} ل.س + ${parts.displayUsd} USD`
              : `تحصيل تسديد ذمة بالدولار — ${parts.displayUsd} USD (≈ ${enteredSyp.toLocaleString('ar-SY')} ل.س)`,
          paymentChannel: channel,
          bankName: channel === 'bank' ? bankLabel : '',
          payCurrency: parts.payCurrency,
          receivedAmountSyp: parts.payCurrency === 'MIXED' ? parts.displaySyp : 0,
          receivedAmountUsd: parts.displayUsd,
          amountDueSyp: debtBefore,
          settlementDeltaSyp: extraToCreditSyp,
          patientRefundSyp: roundMoney(ds.patientRefundSyp),
          patientRefundUsd: round2(ds.patientRefundUsd),
        })
      }
      continue
    }

    const deptKey = DEBT_SETTLEMENT_DEPT_KEY
    bumpDeptBucket(rollup, deptKey, channel, parts.cashSyp, parts.cashUsd)

    const procedureParts = [`تسديد ذمة — ${enteredSyp.toLocaleString('ar-SY')} ل.س`]
    if (parts.payCurrency === 'USD') {
      procedureParts.unshift(`تحصيل ${parts.displayUsd} USD`)
    } else if (parts.payCurrency === 'MIXED') {
      procedureParts.unshift(`مختلط: ${parts.displaySyp.toLocaleString('ar-SY')} ل.س + ${parts.displayUsd} USD`)
    }
    if (appliedToDebtSyp > 0) {
      procedureParts.push(`مخصوم من الذمة: ${appliedToDebtSyp.toLocaleString('ar-SY')} ل.س`)
    }
    if (extraToCreditSyp > 0) {
      procedureParts.push(`فائض للرصيد: ${extraToCreditSyp.toLocaleString('ar-SY')} ل.س`)
    }

    rollup.transactions.push({
      billingItemId: '',
      paymentId: `debt-settlement-${String(ds._id)}`,
      transactionKind: 'debt_settlement',
      paidAt: ds.receivedAt
        ? new Date(ds.receivedAt).toISOString()
        : ds.createdAt
          ? new Date(ds.createdAt).toISOString()
          : null,
      patientName: patientName || '—',
      providerName: '—',
      receivedByName: receivedByName || '—',
      department: deptKey,
      departmentLabel: DEBT_SETTLEMENT_DEPT_LABEL,
      procedureLabel: procedureParts.join(' · '),
      paymentChannel: channel,
      bankName: channel === 'bank' ? bankLabel : '',
      payCurrency: parts.payCurrency,
      receivedAmountSyp: parts.payCurrency === 'USD' ? 0 : parts.displaySyp,
      receivedAmountUsd: parts.displayUsd,
      amountDueSyp: debtBefore,
      settlementDeltaSyp: extraToCreditSyp,
      patientRefundSyp: roundMoney(ds.patientRefundSyp),
      patientRefundUsd: round2(ds.patientRefundUsd),
    })
  }

  rollup.transactions.sort((a, b) => {
    const ta = a.paidAt ? new Date(a.paidAt).getTime() : 0
    const tb = b.paidAt ? new Date(b.paidAt).getTime() : 0
    return ta - tb
  })

  return rollup
}
