import { PatientDebtSettlement } from '../models/PatientDebtSettlement.js'

export const DEBT_SETTLEMENT_DEPT_KEY = 'debt_settlement'
export const DEBT_SETTLEMENT_DEPT_LABEL = 'تسديد ذمم'

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

    rollup.cash.totalSyp += enteredSyp

    const deptKey = DEBT_SETTLEMENT_DEPT_KEY
    if (!rollup.byDept[deptKey]) {
      rollup.byDept[deptKey] = {
        key: deptKey,
        label: DEBT_SETTLEMENT_DEPT_LABEL,
        transactionCount: 0,
        cashSyp: 0,
        cashUsd: 0,
        bankSyp: 0,
        bankUsd: 0,
      }
    }
    rollup.byDept[deptKey].transactionCount += 1
    rollup.byDept[deptKey].cashSyp += enteredSyp

    const patientName =
      ds.patientId && typeof ds.patientId === 'object' && 'name' in ds.patientId
        ? String(ds.patientId.name || '').trim()
        : ''
    const receivedByName =
      ds.receivedBy && typeof ds.receivedBy === 'object' && 'name' in ds.receivedBy
        ? String(ds.receivedBy.name || '').trim()
        : ''

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
      paymentChannel: 'cash',
      bankName: '',
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
