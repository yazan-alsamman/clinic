import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { User } from '../models/User.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

export function providerNameMatchesLora(name) {
  const raw = String(name || '').trim()
  const s = raw.toLowerCase()
  return /لورا|laura|lora/.test(raw) || s.includes('lora') || s.includes('laura')
}

export function providerNameMatchesSamer(name) {
  return /سامر|samer/.test(String(name || '').trim())
}

export function createEmptyDermatologyShareTotals() {
  return {
    loraRevenueSyp: 0,
    loraMaterialSyp: 0,
    samerRevenueSyp: 0,
    samerMaterialSyp: 0,
    otherRevenueSyp: 0,
    otherMaterialSyp: 0,
    totalMaterialSyp: 0,
  }
}

/** مواد الجلسة الأصلية تُخصم عند تسديد الذمة فقط إذا لم يُحصَّل أي مبلغ سابقاً على نفس البند */
export function dermatologyDebtSettlementMaterialSyp(allocAmountSyp, bi, cs, priorPaidSyp) {
  const matTotal = roundMoney(cs?.materialCostSypTotal)
  const allocAmt = roundMoney(allocAmountSyp)
  if (!(matTotal > 0) || !(allocAmt > 0)) return 0
  const totalDue = roundMoney(bi?.effectiveAmountDueSyp ?? bi?.amountDueSyp)
  if (!(totalDue > 0)) return 0
  if (roundMoney(priorPaidSyp) > 0) return 0
  return roundMoney((matTotal * allocAmt) / totalDue)
}

export function priorPaidSypForBillingItem(payments) {
  return roundMoney((payments || []).reduce((s, p) => s + roundMoney(p.amountSyp), 0))
}

export function addDermatologyRevenueToTotals(totals, collectedSyp, matSyp, providerName) {
  const collected = roundMoney(collectedSyp)
  const mat = roundMoney(matSyp)
  if (!(collected > 0)) return
  const name = String(providerName || '').trim()
  if (providerNameMatchesLora(name)) {
    totals.loraRevenueSyp += collected
    totals.loraMaterialSyp += mat
  } else if (providerNameMatchesSamer(name)) {
    totals.samerRevenueSyp += collected
    totals.samerMaterialSyp += mat
  } else {
    totals.otherRevenueSyp += collected
    totals.otherMaterialSyp += mat
  }
  totals.totalMaterialSyp += mat
}

export function finalizeDermatologyShares(totals, sharePercent = 50) {
  const poolLora = Math.max(0, totals.loraRevenueSyp - totals.loraMaterialSyp)
  const poolSamer = Math.max(0, totals.samerRevenueSyp - totals.samerMaterialSyp)
  const loraPayableSyp = roundMoney(poolLora * (sharePercent / 100))
  const samerPayableSyp = roundMoney(poolSamer * (sharePercent / 100))
  const loraClinicHalfSyp = roundMoney(poolLora - loraPayableSyp)
  const samerClinicHalfSyp = roundMoney(poolSamer - samerPayableSyp)
  const otherNetSyp = Math.max(0, totals.otherRevenueSyp - totals.otherMaterialSyp)
  const clinicNetSyp = roundMoney(loraClinicHalfSyp + samerClinicHalfSyp + otherNetSyp)

  return {
    sharePercent,
    loraPayableSyp,
    samerPayableSyp,
    loraSessionRevenueSyp: roundMoney(totals.loraRevenueSyp),
    loraMaterialSyp: roundMoney(totals.loraMaterialSyp),
    samerSessionRevenueSyp: roundMoney(totals.samerRevenueSyp),
    samerMaterialSyp: roundMoney(totals.samerMaterialSyp),
    totalMaterialSyp: roundMoney(totals.totalMaterialSyp),
    clinicNetSyp,
    otherSessionRevenueSyp: roundMoney(totals.otherRevenueSyp),
    otherMaterialSyp: roundMoney(totals.otherMaterialSyp),
    poolLora: roundMoney(poolLora),
    poolSamer: roundMoney(poolSamer),
    otherNetSyp: roundMoney(otherNetSyp),
    loraClinicHalfSyp,
    samerClinicHalfSyp,
  }
}

export async function loadDermatologyDebtSettlementLookup(debtSettlements) {
  const billingItemIds = new Set()
  const providerUserIds = new Set()
  for (const ds of debtSettlements || []) {
    for (const alloc of ds.departmentAllocations || []) {
      if (alloc.department !== 'dermatology') continue
      if (alloc.billingItemId) billingItemIds.add(String(alloc.billingItemId))
      if (alloc.providerUserId) providerUserIds.add(String(alloc.providerUserId))
    }
  }

  const biIds = [...billingItemIds]
  const [billingItems, providers] = await Promise.all([
    biIds.length
      ? BillingItem.find({ _id: { $in: biIds } })
          .select('_id clinicalSessionId providerUserId effectiveAmountDueSyp amountDueSyp')
          .lean()
      : [],
    providerUserIds.size
      ? User.find({ _id: { $in: [...providerUserIds] } })
          .select('name')
          .lean()
      : [],
  ])

  for (const bi of billingItems) {
    if (bi.providerUserId) providerUserIds.add(String(bi.providerUserId))
  }

  const extraProviders =
    providerUserIds.size > providers.length
      ? await User.find({ _id: { $in: [...providerUserIds] } })
          .select('name')
          .lean()
      : []
  const allProviders = [...providers, ...extraProviders]
  const providerNameById = new Map(allProviders.map((u) => [String(u._id), String(u.name || '').trim()]))

  const sessionIds = [...new Set(billingItems.map((b) => b.clinicalSessionId).filter(Boolean).map(String))]
  const sessions =
    sessionIds.length > 0
      ? await ClinicalSession.find({ _id: { $in: sessionIds } })
          .select('materialCostSypTotal materials')
          .lean()
      : []

  const payments =
    biIds.length > 0
      ? await BillingPayment.find({ billingItemId: { $in: biIds } })
          .select('billingItemId amountSyp')
          .lean()
      : []

  const biById = new Map(billingItems.map((b) => [String(b._id), b]))
  const sessionById = new Map(sessions.map((s) => [String(s._id), s]))
  const paymentsByBiId = new Map()
  for (const p of payments) {
    const k = String(p.billingItemId)
    if (!paymentsByBiId.has(k)) paymentsByBiId.set(k, [])
    paymentsByBiId.get(k).push(p)
  }

  return { biById, sessionById, paymentsByBiId, providerNameById }
}

function resolveProviderNameForAlloc(alloc, bi, providerNameById) {
  if (alloc.providerUserId) {
    const fromAlloc = providerNameById.get(String(alloc.providerUserId))
    if (fromAlloc) return fromAlloc
  }
  if (bi?.providerUserId) {
    const fromBi = providerNameById.get(String(bi.providerUserId))
    if (fromBi) return fromBi
  }
  return '—'
}

/**
 * يُضاف إيراد تسديد ذمم الجلدية إلى مجاميع الحصص (مع مواد الجلسة الأصلية عند اللزوم).
 * يُرجع صفوفاً اختيارية لعرض جدول مالية الجلدية.
 */
export function applyDermatologyDebtSettlements(totals, debtSettlements, lookup, opts = {}) {
  const rows = []
  const { biById, sessionById, paymentsByBiId, providerNameById } = lookup

  for (const ds of debtSettlements || []) {
    const patientName =
      ds.patientId && typeof ds.patientId === 'object' && 'name' in ds.patientId
        ? String(ds.patientId.name || '—').trim()
        : '—'

    for (const alloc of ds.departmentAllocations || []) {
      if (alloc.department !== 'dermatology') continue
      const collected = roundMoney(alloc.amountSyp)
      if (!(collected > 0)) continue

      const bi = alloc.billingItemId ? biById.get(String(alloc.billingItemId)) : null
      const cs = bi?.clinicalSessionId ? sessionById.get(String(bi.clinicalSessionId)) : null
      const priorPaid = bi ? priorPaidSypForBillingItem(paymentsByBiId.get(String(bi._id))) : 0
      const matSyp = dermatologyDebtSettlementMaterialSyp(collected, bi, cs, priorPaid)
      const providerName = resolveProviderNameForAlloc(alloc, bi, providerNameById)

      addDermatologyRevenueToTotals(totals, collected, matSyp, providerName)

      if (opts.buildRows) {
        rows.push({
          id: `debt-${String(ds._id)}-${rows.length}`,
          businessDate: String(ds.businessDate || '').trim(),
          patientName,
          providerName: providerName === '—' ? 'تسديد ذمة' : providerName,
          collectedSyp: collected,
          materialCostSypPriced: 0,
          materialCostUsdPriced: 0,
          materialCostSypTotal: matSyp,
          isDebtSettlement: true,
          procedureLabel: String(alloc.procedureLabel || '').trim() || 'تسديد ذمة',
        })
      }
    }
  }

  return rows
}
