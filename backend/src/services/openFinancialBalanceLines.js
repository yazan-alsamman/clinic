import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { round6 } from '../utils/money.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

function isUsdCurrency(raw) {
  return String(raw || 'SYP').trim().toUpperCase() === 'USD'
}

/** المستحق المعروض في دفتر المريض — يفضّل لقطة الدفع (بعد خصم الاستقبال) */
export function ledgerDueSypForPayment(bi, pay) {
  const payEff = Number(pay?.effectiveAmountDueSyp)
  if (Number.isFinite(payEff) && payEff > 0) return roundMoney(payEff)
  return roundMoney(Number(bi?.effectiveAmountDueSyp ?? bi?.amountDueSyp) || 0)
}

/** مطابقة لمسار financial-ledger + تبويب المريض المالي */
export function buildLedgerEntriesFromBilling(items, payments) {
  const byId = new Map(items.map((x) => [String(x._id), x]))
  return payments.map((pay) => {
    const key = String(pay.billingItemId)
    const bi = byId.get(key)
    const currency = isUsdCurrency(bi?.currency) ? 'USD' : 'SYP'
    const due = ledgerDueSypForPayment(bi, pay)
    const applied = roundMoney(Number(pay.amountSyp) || 0)
    const received = roundMoney(Number(pay.receivedAmountSyp ?? pay.amountSyp) || 0)
    let delta = roundMoney(Number(pay.settlementDeltaSyp ?? received - due) || 0)
    let deltaUsd = round6(Number(pay.settlementDeltaUsd) || 0)
    // بيانات قديمة: بند USD بلا settlementDeltaUsd — قدّر الذمة بالدولار من نسبة المستحق
    if (currency === 'USD' && Math.abs(deltaUsd) < 1e-9 && delta < 0) {
      const dueUsd = round6(Number(bi?.effectiveAmountDueUsd || bi?.amountDueUsd || bi?.listAmountDueUsd) || 0)
      const dueSyp = roundMoney(Number(bi?.effectiveAmountDueSyp || bi?.amountDueSyp) || 0)
      if (dueUsd > 0 && dueSyp > 0) {
        deltaUsd = round6((-Math.abs(delta) * dueUsd) / dueSyp)
      }
    }
    let settlementType = 'exact'
    if (currency === 'USD') {
      if (deltaUsd < -1e-9 || delta < 0) settlementType = 'debt'
      else if (deltaUsd > 1e-9 || delta > 0) settlementType = 'credit'
    } else if (delta < 0) settlementType = 'debt'
    else if (delta > 0) settlementType = 'credit'
    return {
      id: String(pay._id),
      billingItemId: key,
      clinicalSessionId: bi?.clinicalSessionId ? String(bi.clinicalSessionId) : '',
      department: bi?.department ?? null,
      businessDate: String(bi?.businessDate || '').trim(),
      procedureLabel: String(bi?.procedureLabel || '').trim(),
      amountDueSyp: due,
      appliedAmountSyp: applied,
      receivedAmountSyp: received,
      settlementDeltaSyp: delta,
      settlementDeltaUsd: deltaUsd,
      currency,
      settlementType,
    }
  })
}

export function computeOpenFinancialLineBuckets(
  entries,
  outstandingDebtSyp,
  prepaidCreditSyp,
  outstandingDebtUsd = 0,
) {
  const financialNonMatchingEntries = entries.filter((x) => {
    if (x.settlementType === 'debt' || x.settlementType === 'credit') return true
    return Math.abs(Number(x.settlementDeltaSyp) || 0) > 0 || Math.abs(Number(x.settlementDeltaUsd) || 0) > 1e-9
  })
  let remainingDebt = roundMoney(outstandingDebtSyp)
  let remainingDebtUsd = round6(outstandingDebtUsd)
  let remainingCredit = roundMoney(prepaidCreditSyp)
  const openDebtLines = []
  const openCreditLines = []

  for (const entry of financialNonMatchingEntries) {
    const currency = entry.currency === 'USD' ? 'USD' : 'SYP'
    const delta = Number(entry.settlementDeltaSyp) || 0
    const deltaUsd = Number(entry.settlementDeltaUsd) || 0

    if (currency === 'USD' && deltaUsd < -1e-9) {
      if (!(remainingDebtUsd > 1e-9)) continue
      const unresolvedUsd = round6(Math.min(Math.abs(deltaUsd), remainingDebtUsd))
      remainingDebtUsd = round6(remainingDebtUsd - unresolvedUsd)
      openDebtLines.push({
        paymentEntryId: entry.id,
        billingItemId: entry.billingItemId,
        clinicalSessionId: entry.clinicalSessionId,
        department: entry.department,
        businessDate: entry.businessDate,
        procedureLabel: entry.procedureLabel,
        amountSyp: 0,
        amountUsd: unresolvedUsd,
        currency: 'USD',
      })
      continue
    }

    if (delta < 0) {
      if (!(remainingDebt > 0)) continue
      const unresolved = roundMoney(Math.min(Math.abs(delta), remainingDebt))
      remainingDebt = roundMoney(remainingDebt - unresolved)
      openDebtLines.push({
        paymentEntryId: entry.id,
        billingItemId: entry.billingItemId,
        clinicalSessionId: entry.clinicalSessionId,
        department: entry.department,
        businessDate: entry.businessDate,
        procedureLabel: entry.procedureLabel,
        amountSyp: unresolved,
        amountUsd: 0,
        currency: 'SYP',
      })
    } else if (delta > 0 || deltaUsd > 1e-9) {
      if (!(remainingCredit > 0)) continue
      const creditDelta = delta > 0 ? delta : 0
      if (!(creditDelta > 0)) continue
      const unresolved = roundMoney(Math.min(creditDelta, remainingCredit))
      remainingCredit = roundMoney(remainingCredit - unresolved)
      openCreditLines.push({
        paymentEntryId: entry.id,
        billingItemId: entry.billingItemId,
        clinicalSessionId: entry.clinicalSessionId,
        department: entry.department,
        businessDate: entry.businessDate,
        procedureLabel: entry.procedureLabel,
        amountSyp: unresolved,
        amountUsd: 0,
        currency: 'SYP',
      })
    }
  }

  return {
    openDebtLines,
    openCreditLines,
    remainingDebt,
    remainingDebtUsd,
    remainingCredit,
  }
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
  let r = roundMoney(remainingDebt)
  const lines = []
  const pkgs = sortPackagesChronological(
    (sessionPackages || []).filter((p) => (Number(p.settlementDeltaSyp) || 0) < 0),
  )
  for (const pkg of pkgs) {
    if (!(r > 0)) break
    const cap = roundMoney(Math.abs(Number(pkg.settlementDeltaSyp) || 0))
    const take = roundMoney(Math.min(r, cap))
    if (take > 0) {
      const title = String(pkg.title || '').trim() || 'باكج ليزر'
      const isPartial = take < cap
      lines.push({
        paymentEntryId: '',
        billingItemId: '',
        clinicalSessionId: '',
        department: String(pkg.department || 'laser'),
        businessDate: pkg.createdAt ? new Date(pkg.createdAt).toISOString().slice(0, 10) : '',
        procedureLabel: isPartial ? `باكج (جزء): ${title}` : `باكج: ${title}`,
        amountSyp: take,
        amountUsd: 0,
        currency: 'SYP',
        synthetic: false,
        source: 'package',
        patientPackageId: String(pkg._id),
      })
      r = roundMoney(r - take)
    }
  }
  return { packageDebtLines: lines, remainingDebtAfterPackages: r }
}

/** يوزّع المتبقي من الرصيد الإضافي على باكجات ذات settlementDelta موجب */
export function allocatePackageCreditRemainderLines(remainingCredit, sessionPackages) {
  let r = roundMoney(remainingCredit)
  const lines = []
  const pkgs = sortPackagesChronological(
    (sessionPackages || []).filter((p) => (Number(p.settlementDeltaSyp) || 0) > 0),
  )
  for (const pkg of pkgs) {
    if (!(r > 0)) break
    const cap = roundMoney(Number(pkg.settlementDeltaSyp) || 0)
    const take = roundMoney(Math.min(r, cap))
    if (take > 0) {
      const title = String(pkg.title || '').trim() || 'باكج ليزر'
      const isPartial = take < cap
      lines.push({
        paymentEntryId: '',
        billingItemId: '',
        clinicalSessionId: '',
        department: String(pkg.department || 'laser'),
        businessDate: pkg.createdAt ? new Date(pkg.createdAt).toISOString().slice(0, 10) : '',
        procedureLabel: isPartial ? `باكج (جزء): ${title}` : `باكج: ${title}`,
        amountSyp: take,
        amountUsd: 0,
        currency: 'SYP',
        synthetic: false,
        source: 'package',
        patientPackageId: String(pkg._id),
      })
      r = roundMoney(r - take)
    }
  }
  return { packageCreditLines: lines, remainingCreditAfterPackages: r }
}

export async function loadBillingItemsAndPaymentsForPatients(patientIds) {
  if (!patientIds.length) return { items: [], payments: [] }
  const items = await BillingItem.find({ patientId: { $in: patientIds } })
    .select(
      '_id patientId department clinicalSessionId providerUserId amountDueSyp effectiveAmountDueSyp listAmountDueSyp amountDueUsd effectiveAmountDueUsd listAmountDueUsd currency businessDate procedureLabel',
    )
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

function syntheticUsdDebtLine(remainingDebtUsd) {
  const usd = round6(remainingDebtUsd)
  if (!(usd > 1e-9)) return []
  return [
    {
      paymentEntryId: '',
      billingItemId: '',
      clinicalSessionId: '',
      department: null,
      businessDate: '',
      procedureLabel: 'ذمة بالدولار غير مربوطة بجلسة في السجل',
      amountSyp: 0,
      amountUsd: usd,
      currency: 'USD',
      synthetic: true,
      source: 'synthetic',
    },
  ]
}

/** سطور الذمة المفتوحة على ملف مريض (جلسات ثم باكجات ثم غير مربوطة) — لتوزيع تسديد الذمة */
export function buildPatientOpenDebtLinesFromData(patient, items, payments) {
  const entries = buildLedgerEntriesFromBilling(items, payments)
  const { openDebtLines, remainingDebt, remainingDebtUsd } = computeOpenFinancialLineBuckets(
    entries,
    Number(patient.outstandingDebtSyp) || 0,
    Number(patient.prepaidCreditSyp) || 0,
    Number(patient.outstandingDebtUsd) || 0,
  )
  const billingPart = openDebtLines.map((line) => ({ ...line, source: 'billing' }))
  const { packageDebtLines, remainingDebtAfterPackages } = allocatePackageDebtRemainderLines(
    remainingDebt,
    Array.isArray(patient.sessionPackages) ? patient.sessionPackages : [],
  )
  const syntheticSyp =
    remainingDebtAfterPackages > 0
      ? [
          {
            paymentEntryId: '',
            billingItemId: '',
            clinicalSessionId: '',
            department: null,
            businessDate: '',
            procedureLabel: 'ذمة غير مربوطة بجلسة أو باكج في السجل',
            amountSyp: roundMoney(remainingDebtAfterPackages),
            amountUsd: 0,
            currency: 'SYP',
            synthetic: true,
            source: 'synthetic',
          },
        ]
      : []
  const syntheticUsd = syntheticUsdDebtLine(remainingDebtUsd)
  return [...billingPart, ...packageDebtLines, ...syntheticSyp, ...syntheticUsd]
}

/** patientDocs: lean documents with _id, fileNumber, name, outstandingDebtSyp, outstandingDebtUsd, prepaidCreditSyp, sessionPackages */
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
    const { openDebtLines, openCreditLines, remainingDebt, remainingDebtUsd, remainingCredit } =
      computeOpenFinancialLineBuckets(
        entries,
        Number(p.outstandingDebtSyp) || 0,
        Number(p.prepaidCreditSyp) || 0,
        Number(p.outstandingDebtUsd) || 0,
      )
    const sessionPackages = Array.isArray(p.sessionPackages) ? p.sessionPackages : []

    let merged = []
    if (mode === 'debt') {
      const billingPart = openDebtLines.map((line) => ({ ...line, source: 'billing' }))
      const { packageDebtLines, remainingDebtAfterPackages } = allocatePackageDebtRemainderLines(
        remainingDebt,
        sessionPackages,
      )
      const syntheticSyp =
        remainingDebtAfterPackages > 0
          ? [
              {
                paymentEntryId: '',
                billingItemId: '',
                clinicalSessionId: '',
                department: null,
                businessDate: '',
                procedureLabel: 'ذمة غير مربوطة بجلسة أو باكج في السجل',
                amountSyp: roundMoney(remainingDebtAfterPackages),
                amountUsd: 0,
                currency: 'SYP',
                synthetic: true,
                source: 'synthetic',
              },
            ]
          : []
      const syntheticUsd = syntheticUsdDebtLine(remainingDebtUsd)
      merged = [...billingPart, ...packageDebtLines, ...syntheticSyp, ...syntheticUsd]
    } else {
      const billingPart = openCreditLines.map((line) => ({ ...line, source: 'billing' }))
      const { packageCreditLines, remainingCreditAfterPackages } = allocatePackageCreditRemainderLines(
        remainingCredit,
        sessionPackages,
      )
      const synthetic =
        remainingCreditAfterPackages > 0
          ? [
              {
                paymentEntryId: '',
                billingItemId: '',
                clinicalSessionId: '',
                department: null,
                businessDate: '',
                procedureLabel: 'رصيد إضافي غير مربوط بجلسة أو باكج في السجل',
                amountSyp: roundMoney(remainingCreditAfterPackages),
                amountUsd: 0,
                currency: 'SYP',
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
