import mongoose from 'mongoose'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { buildVisitDeductionPreviewFromData, loadLaserOptionMeta } from './laserAreaDeductions.js'

/**
 * ملخص زيارة ليزر في شاشة التحصيل — يُعرض قبل تأكيد الدفع:
 *  1) «علاجات مغطاة بالباكج»: المنطقة، الباكج، الإنقاص (جلسة واحدة)، رسوم إضافية = 0
 *  2) «خدمات إضافية خارج الباكجات»: الخدمة، السعر الأصلي، المطلوب دفعه، والمجموع الفرعي
 * عرض فقط — لا يغيّر أي رصيد أو مبلغ.
 */

function billDue(bi) {
  return Math.max(0, Math.round(Number(bi?.effectiveAmountDueSyp ?? bi?.amountDueSyp) || 0))
}

/**
 * دالة صرفة.
 * @param {{ preview: object, laserSession: object, addonBills?: object[] }} input
 */
export function buildLaserVisitBillingBreakdown({ preview, laserSession, addonBills = [] }) {
  const packageCovered = []
  for (const pkg of preview?.packages || []) {
    for (const a of pkg.areas || []) {
      if (!a.treatedInVisit && !a.alreadyDeductedForVisit) continue
      const deducted = a.alreadyDeductedForVisit === true
      packageCovered.push({
        key: a.key,
        label: a.label,
        packageId: pkg.packageId,
        packageTitle: pkg.title,
        deductionStatus: deducted ? 'deducted' : a.remainingSessions > 0 ? 'pending' : 'no_balance',
        sessionsTotal: a.sessionsTotal,
        remainingAfter: deducted ? a.remainingSessions : Math.max(0, a.remainingSessions - 1),
        additionalChargeSyp: 0,
      })
    }
  }
  const noBalanceLabels = (preview?.uncoveredAreaLabels || []).filter(Boolean)

  const addonServices = (Array.isArray(laserSession?.lineItems) ? laserSession.lineItems : [])
    .filter((r) => r?.isAddon === true)
    .map((r) => ({
      label: String(r.areaLabel || '').trim() || 'منطقة',
      originalPriceSyp: Math.max(0, Math.round(Number(r.lineCostSyp) || 0)),
    }))
  const liveBills = (addonBills || []).filter((b) => b && b.status !== 'cancelled')
  const bills = liveBills.map((b) => ({
    billingItemId: String(b._id),
    status: String(b.status || ''),
    amountDueSyp: billDue(b),
  }))
  const addonSubtotalSyp = addonServices.reduce((n, s) => n + s.originalPriceSyp, 0)
  const addonAmountDueSyp = bills.reduce((n, b) => n + b.amountDueSyp, 0)
  const addonPendingSyp = bills.filter((b) => b.status === 'pending_payment').reduce((n, b) => n + b.amountDueSyp, 0)
  const addonPaidSyp = bills.filter((b) => b.status === 'paid').reduce((n, b) => n + b.amountDueSyp, 0)

  return {
    laserSessionId: String(laserSession?._id || preview?.laserSessionId || ''),
    packageCovered,
    noBalanceLabels,
    addonServices,
    addonBills: bills,
    addonSubtotalSyp,
    /** المطلوب فعلاً بعد أي خصم/كفر على بند الإضافات */
    addonAmountDueSyp,
    addonPendingSyp,
    addonPaidSyp,
    /** الباكج مدفوع مسبقاً: لا يضاف أي مبلغ بسبب المناطق المغطاة */
    packageChargeSyp: 0,
  }
}

function isPackageBill(b) {
  return b?.isPackagePrepaid === true && String(b?.department || '') === 'laser'
}

/**
 * يُرفق laserVisitBreakdown لبند باكج الليزر ولبند «إضافات خارج الباكج» التابع لنفس الزيارة.
 * يُستدعى بعد enrichLaserPackageAreaMetrics.
 */
export async function attachLaserVisitBreakdowns(billingItems, dtos) {
  const targets = []
  const addonCsIds = []
  for (let i = 0; i < billingItems.length; i++) {
    const b = billingItems[i]
    if (String(b?.department || '') !== 'laser') continue
    if (isPackageBill(b)) {
      if (dtos[i]?.laserSessionId) targets.push({ i, kind: 'package', lsId: dtos[i].laserSessionId })
    } else if (b?.clinicalSessionId && mongoose.isValidObjectId(String(b.clinicalSessionId))) {
      addonCsIds.push({ i, csId: String(b.clinicalSessionId) })
    }
  }
  if (addonCsIds.length) {
    const rows = await ClinicalSession.find({
      _id: { $in: addonCsIds.map((x) => x.csId) },
      packageAddonForLaserSessionId: { $ne: null },
    })
      .select('_id packageAddonForLaserSessionId')
      .lean()
    const lsByCs = new Map(rows.map((r) => [String(r._id), String(r.packageAddonForLaserSessionId || '')]))
    for (const { i, csId } of addonCsIds) {
      const lsId = lsByCs.get(csId)
      if (lsId) targets.push({ i, kind: 'addon', lsId })
    }
  }
  if (!targets.length) return

  const lsIds = [...new Set(targets.map((t) => t.lsId))].filter((id) => mongoose.isValidObjectId(id))
  const sessions = await LaserSession.find({ _id: { $in: lsIds } })
    .select('_id patientId patientPackageId lineItems')
    .lean()
  const lsById = new Map(sessions.map((s) => [String(s._id), s]))
  const patientIds = [...new Set(sessions.map((s) => String(s.patientId || '')).filter(Boolean))]
  const [patients, addonCs] = await Promise.all([
    Patient.find({ _id: { $in: patientIds } }).select('sessionPackages').lean(),
    ClinicalSession.find({ packageAddonForLaserSessionId: { $in: lsIds } })
      .select('_id billingItemId packageAddonForLaserSessionId')
      .lean(),
  ])
  const patientById = new Map(patients.map((p) => [String(p._id), p]))
  const billIds = addonCs.map((c) => c.billingItemId).filter(Boolean)
  const addonBillRows = billIds.length
    ? await BillingItem.find({ _id: { $in: billIds } }).select('_id status amountDueSyp effectiveAmountDueSyp').lean()
    : []
  const billById = new Map(addonBillRows.map((b) => [String(b._id), b]))
  const billsByLs = new Map()
  for (const c of addonCs) {
    const k = String(c.packageAddonForLaserSessionId)
    const b = c.billingItemId ? billById.get(String(c.billingItemId)) : null
    if (!b) continue
    billsByLs.set(k, [...(billsByLs.get(k) || []), b])
  }
  const allPkgs = patients.flatMap((p) => p.sessionPackages || [])
  const optionMetaById = await loadLaserOptionMeta(
    allPkgs.filter((p) => String(p?.department || 'laser') === 'laser'),
    sessions.flatMap((s) => s.lineItems || []),
  )

  const cache = new Map()
  for (const { i, lsId } of targets) {
    const ls = lsById.get(lsId)
    const patient = ls ? patientById.get(String(ls.patientId)) : null
    if (!ls || !patient) continue
    if (!cache.has(lsId)) {
      const preview =
        dtos[i]?.laserPackageDeduction && dtos[i].laserSessionId === lsId
          ? dtos[i].laserPackageDeduction
          : buildVisitDeductionPreviewFromData({ patient, laserSession: ls, optionMetaById })
      cache.set(lsId, buildLaserVisitBillingBreakdown({ preview, laserSession: ls, addonBills: billsByLs.get(lsId) || [] }))
    }
    dtos[i].laserVisitBreakdown = cache.get(lsId)
  }
}
