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

function bumpDeptBucket(rollup, deptKey, channel, amountSyp) {
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
  if (channel === 'cash') {
    rollup.byDept[deptKey].cashSyp += amountSyp
  } else {
    rollup.byDept[deptKey].bankSyp += amountSyp
  }
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

    const channel = ds.paymentChannel === 'bank' ? 'bank' : 'cash'
    const bankLabel = String(ds.bankName || '').trim() || 'بنك'

    if (channel === 'cash') {
      rollup.cash.totalSyp += enteredSyp
    } else {
      if (!rollup.bankMap) rollup.bankMap = new Map()
      const cur = rollup.bankMap.get(bankLabel) || { bankName: bankLabel, totalSyp: 0, totalUsd: 0 }
      cur.totalSyp += enteredSyp
      rollup.bankMap.set(bankLabel, cur)
    }

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
        bumpDeptBucket(rollup, deptKey, channel, allocSyp)

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
          payCurrency: 'SYP',
          receivedAmountSyp: allocSyp,
          receivedAmountUsd: 0,
          amountDueSyp: allocSyp,
          settlementDeltaSyp: 0,
          patientRefundSyp: 0,
          patientRefundUsd: 0,
        })
      }
      if (extraToCreditSyp > 0) {
        bumpDeptBucket(rollup, DEBT_SETTLEMENT_DEPT_KEY, channel, extraToCreditSyp)
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
          payCurrency: 'SYP',
          receivedAmountSyp: extraToCreditSyp,
          receivedAmountUsd: 0,
          amountDueSyp: 0,
          settlementDeltaSyp: extraToCreditSyp,
          patientRefundSyp: 0,
          patientRefundUsd: 0,
        })
      }
      continue
    }

    const deptKey = DEBT_SETTLEMENT_DEPT_KEY
    bumpDeptBucket(rollup, deptKey, channel, enteredSyp)

    const procedureParts = [`تسديد ذمة — ${enteredSyp.toLocaleString('ar-SY')} ل.س`]
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
      payCurrency: 'SYP',
      receivedAmountSyp: enteredSyp,
      receivedAmountUsd: 0,
      amountDueSyp: debtBefore,
      settlementDeltaSyp: extraToCreditSyp,
      patientRefundSyp: 0,
      patientRefundUsd: 0,
    })
  }

  rollup.transactions.sort((a, b) => {
    const ta = a.paidAt ? new Date(a.paidAt).getTime() : 0
    const tb = b.paidAt ? new Date(b.paidAt).getTime() : 0
    return ta - tb
  })

  return rollup
}
