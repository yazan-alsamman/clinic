import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** مطابقة لمسار financial-ledger + تبويب المريض المالي */
export function buildLedgerEntriesFromBilling(items, payments) {
  const byId = new Map(items.map((x) => [String(x._id), x]))
  return payments.map((pay) => {
    const key = String(pay.billingItemId)
    const bi = byId.get(key)
    const due = round2(Number(bi?.amountDueUsd) || 0)
    const applied = round2(Number(pay.amountUsd) || 0)
    const received = round2(Number(pay.receivedAmountUsd ?? pay.amountUsd) || 0)
    const delta = round2(Number(pay.settlementDeltaUsd ?? received - due) || 0)
    let settlementType = 'exact'
    if (delta < -0.0001) settlementType = 'debt'
    else if (delta > 0.0001) settlementType = 'credit'
    return {
      id: String(pay._id),
      billingItemId: key,
      clinicalSessionId: bi?.clinicalSessionId ? String(bi.clinicalSessionId) : '',
      department: bi?.department ?? null,
      businessDate: String(bi?.businessDate || '').trim(),
      procedureLabel: String(bi?.procedureLabel || '').trim(),
      amountDueUsd: due,
      appliedAmountUsd: applied,
      receivedAmountUsd: received,
      settlementDeltaUsd: delta,
      settlementType,
    }
  })
}

export function computeOpenFinancialLineBuckets(entries, outstandingDebtUsd, prepaidCreditUsd) {
  const financialNonMatchingEntries = entries.filter((x) => {
    if (x.settlementType === 'debt' || x.settlementType === 'credit') return true
    return Math.abs(Number(x.settlementDeltaUsd) || 0) > 0.0001
  })
  let remainingDebt = round2(outstandingDebtUsd)
  let remainingCredit = round2(prepaidCreditUsd)
  const openDebtLines = []
  const openCreditLines = []

  for (const entry of financialNonMatchingEntries) {
    const delta = Number(entry.settlementDeltaUsd) || 0
    if (delta < 0) {
      if (!(remainingDebt > 0.0001)) continue
      const unresolved = round2(Math.min(Math.abs(delta), remainingDebt))
      remainingDebt = round2(remainingDebt - unresolved)
      openDebtLines.push({
        paymentEntryId: entry.id,
        billingItemId: entry.billingItemId,
        clinicalSessionId: entry.clinicalSessionId,
        department: entry.department,
        businessDate: entry.businessDate,
        procedureLabel: entry.procedureLabel,
        amountUsd: unresolved,
      })
    } else if (delta > 0) {
      if (!(remainingCredit > 0.0001)) continue
      const unresolved = round2(Math.min(delta, remainingCredit))
      remainingCredit = round2(remainingCredit - unresolved)
      openCreditLines.push({
        paymentEntryId: entry.id,
        billingItemId: entry.billingItemId,
        clinicalSessionId: entry.clinicalSessionId,
        department: entry.department,
        businessDate: entry.businessDate,
        procedureLabel: entry.procedureLabel,
        amountUsd: unresolved,
      })
    }
  }

  return { openDebtLines, openCreditLines, remainingDebt, remainingCredit }
}

function sortPackagesChronological(packages) {
  return [...packages].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    if (ta !== tb) return ta - tb
    return String(a._id || '').localeCompare(String(b._id || ''))
  })
}

/** يوزّع المتبقي من الذمة بعد التحصيل على باكجات ذات settlementDelta سالب (من الأقدم للأحدث) */
export function allocatePackageDebtRemainderLines(remainingDebt, sessionPackages) {
  let r = round2(remainingDebt)
  const lines = []
  const pkgs = sortPackagesChronological(
    (sessionPackages || []).filter((p) => (Number(p.settlementDeltaUsd) || 0) < -0.0001),
  )
  for (const pkg of pkgs) {
    if (!(r > 0.0001)) break
    const cap = round2(Math.abs(Number(pkg.settlementDeltaUsd) || 0))
    const take = round2(Math.min(r, cap))
    if (take > 0.0001) {
      const title = String(pkg.title || '').trim() || 'باكج ليزر'
      const isPartial = take + 0.0001 < cap
      lines.push({
        paymentEntryId: '',
        billingItemId: '',
        clinicalSessionId: '',
        department: String(pkg.department || 'laser'),
        businessDate: pkg.createdAt ? new Date(pkg.createdAt).toISOString().slice(0, 10) : '',
        procedureLabel: isPartial ? `باكج (جزء): ${title}` : `باكج: ${title}`,
        amountUsd: take,
        synthetic: false,
        source: 'package',
        patientPackageId: String(pkg._id),
      })
      r = round2(r - take)
    }
  }
  return { packageDebtLines: lines, remainingDebtAfterPackages: r }
}

/** يوزّع المتبقي من الرصيد الإضافي على باكجات ذات settlementDelta موجب */
export function allocatePackageCreditRemainderLines(remainingCredit, sessionPackages) {
  let r = round2(remainingCredit)
  const lines = []
  const pkgs = sortPackagesChronological(
    (sessionPackages || []).filter((p) => (Number(p.settlementDeltaUsd) || 0) > 0.0001),
  )
  for (const pkg of pkgs) {
    if (!(r > 0.0001)) break
    const cap = round2(Number(pkg.settlementDeltaUsd) || 0)
    const take = round2(Math.min(r, cap))
    if (take > 0.0001) {
      const title = String(pkg.title || '').trim() || 'باكج ليزر'
      const isPartial = take + 0.0001 < cap
      lines.push({
        paymentEntryId: '',
        billingItemId: '',
        clinicalSessionId: '',
        department: String(pkg.department || 'laser'),
        businessDate: pkg.createdAt ? new Date(pkg.createdAt).toISOString().slice(0, 10) : '',
        procedureLabel: isPartial ? `باكج (جزء): ${title}` : `باكج: ${title}`,
        amountUsd: take,
        synthetic: false,
        source: 'package',
        patientPackageId: String(pkg._id),
      })
      r = round2(r - take)
    }
  }
  return { packageCreditLines: lines, remainingCreditAfterPackages: r }
}

export async function loadBillingItemsAndPaymentsForPatients(patientIds) {
  if (!patientIds.length) return { items: [], payments: [] }
  const items = await BillingItem.find({ patientId: { $in: patientIds } })
    .select('_id patientId department clinicalSessionId amountDueUsd businessDate procedureLabel')
    .lean()
  const itemIds = items.map((i) => i._id)
  const payments =
    itemIds.length === 0
      ? []
      : await BillingPayment.find({ billingItemId: { $in: itemIds } })
          .sort({ receivedAt: -1, createdAt: -1 })
          .lean()
  return { items, payments }
}

/** patientDocs: lean documents with _id, fileNumber, name, outstandingDebtUsd, prepaidCreditUsd, sessionPackages */
export async function buildAdminOpenFinancialLines(patientDocs, mode) {
  if (!patientDocs.length) return []
  const patientIds = patientDocs.map((p) => p._id)
  const { items, payments } = await loadBillingItemsAndPaymentsForPatients(patientIds)

  const itemsByPid = new Map()
  for (const it of items) {
    const k = String(it.patientId)
    if (!itemsByPid.has(k)) itemsByPid.set(k, [])
    itemsByPid.get(k).push(it)
  }

  const out = []
  for (const p of patientDocs) {
    const pid = String(p._id)
    const pitems = itemsByPid.get(pid) || []
    const idSet = new Set(pitems.map((it) => String(it._id)))
    const pPayments = payments.filter((pay) => idSet.has(String(pay.billingItemId)))
    const entries = buildLedgerEntriesFromBilling(pitems, pPayments)
    const { openDebtLines, openCreditLines, remainingDebt, remainingCredit } = computeOpenFinancialLineBuckets(
      entries,
      Number(p.outstandingDebtUsd) || 0,
      Number(p.prepaidCreditUsd) || 0,
    )
    const sessionPackages = Array.isArray(p.sessionPackages) ? p.sessionPackages : []

    let merged = []
    if (mode === 'debt') {
      const billingPart = openDebtLines.map((line) => ({ ...line, source: 'billing' }))
      const { packageDebtLines, remainingDebtAfterPackages } = allocatePackageDebtRemainderLines(
        remainingDebt,
        sessionPackages,
      )
      const synthetic =
        remainingDebtAfterPackages > 0.0001
          ? [
              {
                paymentEntryId: '',
                billingItemId: '',
                clinicalSessionId: '',
                department: null,
                businessDate: '',
                procedureLabel: 'ذمة غير مربوطة بجلسة أو باكج في السجل',
                amountUsd: round2(remainingDebtAfterPackages),
                synthetic: true,
                source: 'synthetic',
              },
            ]
          : []
      merged = [...billingPart, ...packageDebtLines, ...synthetic]
    } else {
      const billingPart = openCreditLines.map((line) => ({ ...line, source: 'billing' }))
      const { packageCreditLines, remainingCreditAfterPackages } = allocatePackageCreditRemainderLines(
        remainingCredit,
        sessionPackages,
      )
      const synthetic =
        remainingCreditAfterPackages > 0.0001
          ? [
              {
                paymentEntryId: '',
                billingItemId: '',
                clinicalSessionId: '',
                department: null,
                businessDate: '',
                procedureLabel: 'رصيد إضافي غير مربوط بجلسة أو باكج في السجل',
                amountUsd: round2(remainingCreditAfterPackages),
                synthetic: true,
                source: 'synthetic',
              },
            ]
          : []
      merged = [...billingPart, ...packageCreditLines, ...synthetic]
    }

    for (const line of merged) {
      out.push({
        patientId: pid,
        fileNumber: String(p.fileNumber || ''),
        name: String(p.name || ''),
        ...line,
      })
    }
  }
  return out
}
