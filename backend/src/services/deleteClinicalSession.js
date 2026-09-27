import mongoose from 'mongoose'
import { Patient } from '../models/Patient.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { FinancialDocument } from '../models/FinancialDocument.js'
import { LaserSession } from '../models/LaserSession.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { InventoryItem } from '../models/InventoryItem.js'
import { PatientDebtSettlement } from '../models/PatientDebtSettlement.js'
import { deleteDentalTreatmentFully, purgeFinancialDocsForPayment, reversePatientWalletFromPayment } from './deleteDentalTreatment.js'

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

async function restoreMaterials(snapshot) {
  for (const m of snapshot || []) {
    if (!m?.inventoryItemId || !m?.quantity) continue
    await InventoryItem.findByIdAndUpdate(m.inventoryItemId, { $inc: { quantity: m.quantity } })
  }
}

async function collectLinks(cs) {
  const itemIds = new Set()
  const laserIds = new Set()
  if (cs.billingItemId) itemIds.add(String(cs.billingItemId))
  if (cs.laserSessionId) laserIds.add(String(cs.laserSessionId))

  const extraItems = await BillingItem.find({ clinicalSessionId: cs._id }).select('_id isCreditTopUp').lean()
  for (const row of extraItems) {
    if (row.isCreditTopUp === true) continue
    itemIds.add(String(row._id))
  }

  const lasers = await LaserSession.find({
    $or: [{ _id: { $in: [...laserIds] } }, { clinicalSessionId: cs._id }],
  })
    .select('_id billingItemId')
    .lean()
  for (const ls of lasers) {
    laserIds.add(String(ls._id))
    if (ls.billingItemId) itemIds.add(String(ls.billingItemId))
  }

  return { itemIds: [...itemIds], laserIds: [...laserIds] }
}

async function purgeBillingItems(itemIds) {
  let paymentsDeleted = 0
  let itemsDeleted = 0
  let wallet = null
  for (const iid of itemIds) {
    if (!mongoose.isValidObjectId(iid)) continue
    const bi = await BillingItem.findById(iid)
    if (!bi || bi.isCreditTopUp === true) continue
    const pays = await BillingPayment.find({ billingItemId: bi._id })
    for (const pay of pays) {
      wallet = (await reversePatientWalletFromPayment(bi.patientId, pay, bi)) || wallet
      await purgeFinancialDocsForPayment(pay)
      await pay.deleteOne()
      paymentsDeleted += 1
    }
    await BillingItem.deleteOne({ _id: bi._id })
    itemsDeleted += 1
  }
  return { paymentsDeleted, itemsDeleted, wallet }
}

async function sweepFinancialDocs(cs, laserIds, itemIds) {
  const or = [
    { 'parameterSnapshot.clinicalSessionId': String(cs._id) },
    { sourceId: cs._id },
  ]
  for (const lid of laserIds) {
    if (mongoose.isValidObjectId(lid)) or.push({ sourceType: 'laser_session', sourceId: lid })
  }
  for (const iid of itemIds) {
    if (mongoose.isValidObjectId(iid)) or.push({ 'parameterSnapshot.billingItemId': String(iid) })
  }
  if (!or.length) return
  await FinancialDocument.deleteMany({ $or: or })
}

async function detachDebtSettlements(patientId, itemIds, clinicalSessionId) {
  const rows = await PatientDebtSettlement.find({ patientId })
  const billSet = new Set(itemIds.map(String))
  const sid = String(clinicalSessionId)
  for (const row of rows) {
    const allocs = Array.isArray(row.departmentAllocations) ? row.departmentAllocations : []
    const keep = []
    let removedSyp = 0
    let removedUsd = 0
    let hit = false
    for (const a of allocs) {
      const matches =
        (a?.billingItemId && billSet.has(String(a.billingItemId))) ||
        (a?.clinicalSessionId && String(a.clinicalSessionId) === sid)
      if (matches) {
        hit = true
        removedSyp += Math.round(Number(a.amountSyp) || 0)
        removedUsd += Math.max(0, Number(a.amountUsd) || 0)
      } else {
        keep.push(a)
      }
    }
    if (!hit) continue
    if (keep.length === 0) {
      await row.deleteOne()
      continue
    }
    row.departmentAllocations = keep
    row.appliedToDebtSyp = Math.max(0, Math.round(Number(row.appliedToDebtSyp) || 0) - removedSyp)
    row.enteredSyp = Math.max(0, Math.round(Number(row.enteredSyp) || 0) - removedSyp)
    row.appliedToDebtUsd = Math.max(0, (Number(row.appliedToDebtUsd) || 0) - removedUsd)
    row.markModified('departmentAllocations')
    await row.save()
  }
}

async function releasePackageSessions(patientId, cs, laserIds, itemIds) {
  const patient = await Patient.findById(patientId)
  if (!patient?.packages?.length) return
  const laserSet = new Set(laserIds.map(String))
  const billSet = new Set(itemIds.map(String))
  const pkgId = String(cs.patientPackageId || '')
  const pkgSessId = String(cs.patientPackageSessionId || '')
  let changed = false
  for (const pkg of patient.packages) {
    for (const sess of pkg.sessions || []) {
      const linkedLaser = sess.linkedLaserSessionId ? String(sess.linkedLaserSessionId) : ''
      const linkedBill = sess.linkedBillingItemId ? String(sess.linkedBillingItemId) : ''
      const idMatch = pkgId && pkgSessId && String(pkg._id) === pkgId && String(sess._id) === pkgSessId
      if ((linkedLaser && laserSet.has(linkedLaser)) || (linkedBill && billSet.has(linkedBill)) || idMatch) {
        sess.completedByReception = false
        sess.completedAt = null
        sess.completedByUserId = null
        sess.linkedLaserSessionId = null
        sess.linkedBillingItemId = null
        changed = true
      }
    }
  }
  if (changed) {
    patient.markModified('packages')
    await patient.save()
  }
}

async function clearOrthoInstallment(cs, itemIds) {
  const raw = String(cs.dentalTreatmentId || '')
  const instFromTag = raw.startsWith('ortho:') ? raw.slice('ortho:'.length) : ''
  const patient = await Patient.findById(cs.patientId)
  const cases = patient?.dentalChart?.orthodonticCases || []
  if (!cases.length) return
  const billSet = new Set(itemIds.map(String))
  const sid = String(cs._id)
  let changed = false
  for (const oc of cases) {
    for (const inst of oc.installments || []) {
      const instId = String(inst._id)
      const linkedBill = inst.billingItemId ? String(inst.billingItemId) : ''
      const linkedCs = inst.clinicalSessionId ? String(inst.clinicalSessionId) : ''
      if (instId !== instFromTag && linkedCs !== sid && !(linkedBill && billSet.has(linkedBill))) continue
      inst.payments = []
      inst.billingItemId = null
      inst.clinicalSessionId = null
      changed = true
    }
  }
  if (changed) {
    patient.markModified('dentalChart')
    await patient.save()
  }
}

async function deleteLaserSessions(laserIds) {
  for (const lid of laserIds) {
    if (!mongoose.isValidObjectId(lid)) continue
    await FinancialDocument.deleteMany({ sourceType: 'laser_session', sourceId: lid })
    await ScheduleSlot.updateMany({ laserSessionId: lid }, { $unset: { laserSessionId: 1 } })
    await LaserSession.deleteOne({ _id: lid })
  }
}

async function deleteDermatologyVisitFully(visitId) {
  const visit = await DermatologyVisit.findById(visitId)
  if (!visit) return null
  await FinancialDocument.deleteMany({ sourceType: 'dermatology_visit', sourceId: visit._id })
  const snapshot = {
    patientId: String(visit.patientId),
    businessDate: visit.businessDate,
    sessionType: visit.sessionType,
    areaTreatment: visit.areaTreatment,
    costSyp: visit.costSyp,
  }
  await visit.deleteOne()
  return { ok: true, mode: 'dermatology_visit', snapshot }
}

/**
 * حذف جلسة من أي قسم مع بند التحصيل والدفعات والمستند المالي وأثر الرصيد.
 * جلسة الأسنان المرتبطة بإجراء مخطط تُحذف مع الإجراء. جلسة الباكج تُفك عن الباكج دون حذف عقد الباكج.
 */
export async function deleteClinicalSessionFully(sessionId) {
  const id = String(sessionId || '').trim()
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'معرّف الجلسة غير صالح')

  let cs = await ClinicalSession.findById(id)
  if (!cs) {
    const ls = await LaserSession.findById(id)
    if (ls?.clinicalSessionId) cs = await ClinicalSession.findById(ls.clinicalSessionId)
    if (!cs && ls) {
      await deleteLaserSessions([String(ls._id)])
      if (ls.billingItemId) {
        const finance = await purgeBillingItems([String(ls.billingItemId)])
        await detachDebtSettlements(ls.patientId, [String(ls.billingItemId)], ls.clinicalSessionId || id)
        await releasePackageSessions(ls.patientId, { patientPackageId: ls.patientPackageId, patientPackageSessionId: ls.patientPackageSessionId, _id: ls.clinicalSessionId || id }, [String(ls._id)], [String(ls.billingItemId)])
        return { ok: true, mode: 'laser_session', finance }
      }
      await releasePackageSessions(ls.patientId, { patientPackageId: ls.patientPackageId, patientPackageSessionId: ls.patientPackageSessionId, _id: id }, [String(ls._id)], [])
      return { ok: true, mode: 'laser_session' }
    }
    if (!cs) {
      const derm = await deleteDermatologyVisitFully(id)
      if (derm) return derm
      throw httpError(404, 'الجلسة غير موجودة')
    }
  }

  if (cs.isCreditTopUp === true) {
    throw httpError(400, 'شحن الرصيد ليس جلسة علاجية ولا يُحذف من هنا')
  }

  const materials = Array.isArray(cs.materials) ? cs.materials.map((m) => ({ ...m })) : []
  const { itemIds, laserIds } = await collectLinks(cs)
  const dentalTid = String(cs.dentalTreatmentId || '').trim()

  if (dentalTid && mongoose.isValidObjectId(dentalTid)) {
    try {
      const dental = await deleteDentalTreatmentFully({
        patientId: cs.patientId,
        treatmentId: dentalTid,
      })
      const settlementItemIds = [...itemIds]
      if (dental.snapshot?.billingItemId) settlementItemIds.push(String(dental.snapshot.billingItemId))
      await detachDebtSettlements(cs.patientId, settlementItemIds, cs._id)
      await releasePackageSessions(cs.patientId, cs, laserIds, itemIds)
      await deleteLaserSessions(laserIds)
      await sweepFinancialDocs(cs, laserIds, itemIds)
      await restoreMaterials(materials)
      return {
        ok: true,
        mode: 'dental_treatment',
        sessionId: String(cs._id),
        department: cs.department,
        patientId: String(cs.patientId),
        dental,
      }
    } catch (e) {
      if (e?.status !== 404) throw e
    }
  }

  const finance = await purgeBillingItems(itemIds)
  await detachDebtSettlements(cs.patientId, itemIds, cs._id)
  await clearOrthoInstallment(cs, itemIds)
  await releasePackageSessions(cs.patientId, cs, laserIds, itemIds)
  await deleteLaserSessions(laserIds)
  await sweepFinancialDocs(cs, laserIds, itemIds)
  await ClinicalSession.deleteOne({ _id: cs._id })
  await restoreMaterials(materials)

  return {
    ok: true,
    mode: 'clinical_session',
    sessionId: String(cs._id),
    department: cs.department,
    patientId: String(cs.patientId),
    finance,
  }
}
