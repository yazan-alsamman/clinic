import mongoose from 'mongoose'
import { Patient } from '../models/Patient.js'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { orthoDentalTreatmentId } from './dentalChartBilling.js'
import { deleteClinicalSessionFully, purgeCollectedBillingResidue } from './deleteClinicalSession.js'
import { removeAutoLabPaymentsForBillingItemIds } from './dentalLabCollectionSettlement.js'

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function findCase(patient, caseId) {
  const cases = patient?.dentalChart?.orthodonticCases || []
  const idx = cases.findIndex((c) => String(c._id) === String(caseId))
  if (idx < 0) return null
  return { cases, idx, orthoCase: cases[idx] }
}

async function collectInstallmentFinanceIds(patientId, inst) {
  const sessionIds = new Set()
  const itemIds = new Set()
  if (inst?.clinicalSessionId && mongoose.isValidObjectId(String(inst.clinicalSessionId))) {
    sessionIds.add(String(inst.clinicalSessionId))
  }
  if (inst?.billingItemId && mongoose.isValidObjectId(String(inst.billingItemId))) {
    itemIds.add(String(inst.billingItemId))
  }
  if (inst?._id) {
    const sessions = await ClinicalSession.find({
      patientId,
      dentalTreatmentId: orthoDentalTreatmentId(inst._id),
    })
      .select('_id billingItemId')
      .lean()
    for (const cs of sessions) {
      sessionIds.add(String(cs._id))
      if (cs.billingItemId) itemIds.add(String(cs.billingItemId))
    }
  }
  if (itemIds.size) {
    const bills = await BillingItem.find({ _id: { $in: [...itemIds] } })
      .select('_id clinicalSessionId')
      .lean()
    for (const bi of bills) {
      if (bi.clinicalSessionId) sessionIds.add(String(bi.clinicalSessionId))
    }
  }
  return { sessionIds: [...sessionIds], itemIds: [...itemIds] }
}

async function purgeInstallmentsFinance(patientId, installments) {
  const sessionIds = new Set()
  const itemIds = new Set()
  for (const inst of installments || []) {
    const found = await collectInstallmentFinanceIds(patientId, inst)
    for (const sid of found.sessionIds) sessionIds.add(sid)
    for (const iid of found.itemIds) itemIds.add(iid)
  }
  for (const sid of sessionIds) {
    try {
      await deleteClinicalSessionFully(sid)
    } catch (e) {
      if (e?.status !== 404) throw e
    }
  }
  const finance = await purgeCollectedBillingResidue(patientId, [...itemIds], [...sessionIds])
  const labs = await removeAutoLabPaymentsForBillingItemIds([...itemIds])
  return {
    sessionIds: [...sessionIds],
    itemIds: [...itemIds],
    finance,
    labsRemoved: labs.removed || 0,
  }
}

function touchChart(patient, actorUserId) {
  if (!patient.dentalChart) return
  patient.dentalChart.updatedAt = new Date()
  if (actorUserId && mongoose.isValidObjectId(String(actorUserId))) {
    patient.dentalChart.updatedBy = actorUserId
  }
  patient.markModified('dentalChart')
}

/**
 * حذف قسط تقويم مع جلسته وبند التحصيل والدفعات والمستند المالي وأثر الرصيد.
 */
export async function deleteOrthodonticInstallmentFully({ patientId, caseId, installmentId, actorUserId }) {
  if (!mongoose.isValidObjectId(String(patientId || ''))) throw httpError(400, 'معرّف المريض غير صالح')
  if (!mongoose.isValidObjectId(String(caseId || ''))) throw httpError(400, 'معرّف حالة التقويم غير صالح')
  if (!mongoose.isValidObjectId(String(installmentId || ''))) throw httpError(400, 'معرّف الدفعة غير صالح')

  const patient = await Patient.findById(patientId)
  if (!patient) throw httpError(404, 'المريض غير موجود')
  const found = findCase(patient, caseId)
  if (!found) throw httpError(404, 'حالة التقويم غير موجودة')
  const inst = (found.orthoCase.installments || []).find((x) => String(x._id) === String(installmentId))
  if (!inst) throw httpError(404, 'دفعة التقويم غير موجودة')

  const snapshot = {
    caseId: String(caseId),
    installmentId: String(installmentId),
    title: String(found.orthoCase.title || 'تقويم'),
    note: String(inst.note || ''),
    amountSyp: Math.round(Number(inst.amountSyp) || 0),
    amountUsd: Math.max(0, Number(inst.amountUsd) || 0),
    billingItemId: inst.billingItemId ? String(inst.billingItemId) : null,
    clinicalSessionId: inst.clinicalSessionId ? String(inst.clinicalSessionId) : null,
  }

  const finance = await purgeInstallmentsFinance(patient._id, [inst])

  const fresh = await Patient.findById(patientId)
  if (!fresh?.dentalChart) throw httpError(404, 'المريض غير موجود')
  const again = findCase(fresh, caseId)
  if (!again) throw httpError(404, 'حالة التقويم غير موجودة')
  const before = again.orthoCase.installments?.length || 0
  again.orthoCase.installments = (again.orthoCase.installments || []).filter(
    (x) => String(x._id) !== String(installmentId),
  )
  if (again.orthoCase.installments.length === before) throw httpError(404, 'دفعة التقويم غير موجودة')
  touchChart(fresh, actorUserId)
  await fresh.save()

  return { ok: true, mode: 'ortho_installment', patientId: String(patientId), snapshot, finance }
}

/**
 * حذف حالة تقويم كاملة: كل الأقساط مع سجلها المالي، والمستلزمات تختفي مع الحالة.
 */
export async function deleteOrthodonticCaseFully({ patientId, caseId, actorUserId }) {
  if (!mongoose.isValidObjectId(String(patientId || ''))) throw httpError(400, 'معرّف المريض غير صالح')
  if (!mongoose.isValidObjectId(String(caseId || ''))) throw httpError(400, 'معرّف حالة التقويم غير صالح')

  const patient = await Patient.findById(patientId)
  if (!patient) throw httpError(404, 'المريض غير موجود')
  const found = findCase(patient, caseId)
  if (!found) throw httpError(404, 'حالة التقويم غير موجودة')

  const snapshot = {
    caseId: String(caseId),
    title: String(found.orthoCase.title || 'تقويم'),
    doctorName: String(found.orthoCase.doctorName || ''),
    installmentCount: (found.orthoCase.installments || []).length,
    supplyCount: (found.orthoCase.supplies || []).length,
  }

  const finance = await purgeInstallmentsFinance(patient._id, found.orthoCase.installments || [])

  const fresh = await Patient.findById(patientId)
  if (!fresh?.dentalChart) throw httpError(404, 'المريض غير موجود')
  const again = findCase(fresh, caseId)
  if (!again) throw httpError(404, 'حالة التقويم غير موجودة')
  again.cases.splice(again.idx, 1)
  touchChart(fresh, actorUserId)
  await fresh.save()

  return { ok: true, mode: 'ortho_case', patientId: String(patientId), snapshot, finance }
}
