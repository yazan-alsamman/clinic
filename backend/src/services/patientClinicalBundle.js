import { LaserSession } from '../models/LaserSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { DentalMasterPlan } from '../models/DentalMasterPlan.js'
import { Patient } from '../models/Patient.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { normalizeHm, hmToMinutes } from '../utils/scheduleTime.js'
import { buildPackageAreaBreakdown } from './laserPackageAreaBreakdown.js'

function buildLaserPackageAreaBreakdown(sessionRow, packagesById, optionMetaById) {
  if (sessionRow?.isPackageSession !== true) return null
  const pkg = packagesById.get(String(sessionRow.patientPackageId || ''))
  if (!pkg) return null
  const breakdown = buildPackageAreaBreakdown(sessionRow, pkg, optionMetaById)
  if (!breakdown) return null
  return {
    doneAreas: breakdown.doneAreas,
    remainingAreas: breakdown.remainingAreas,
    isPartial: breakdown.isPartial,
  }
}

function slotEndDisplay(doc) {
  const startNorm = normalizeHm(doc.time)
  if (!startNorm) return ''
  const sm = hmToMinutes(startNorm)
  if (sm == null) return ''
  const rawEnd = doc.endTime && String(doc.endTime).trim()
  let em = rawEnd ? hmToMinutes(normalizeHm(rawEnd)) : null
  if (em == null || em <= sm) em = sm + 30
  const h = Math.floor(em / 60)
  const m = em % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Full clinical bundle for one patient (no staff role filtering).
 * @param {import('mongoose').Types.ObjectId} pid
 */
export async function getClinicalBundleForPatientId(pid) {
  const [laserRows, dermRows, apptRows, planDoc, patientDoc, clinicalLaserNotesRows] = await Promise.all([
    LaserSession.find({ patientId: pid })
      .sort({ createdAt: -1 })
      .populate('operatorUserId', 'name')
      .limit(150)
      .lean(),
    DermatologyVisit.find({ patientId: pid })
      .sort({ createdAt: -1 })
      .populate('providerUserId', 'name')
      .limit(150)
      .lean(),
    ScheduleSlot.find({ patientId: pid }).sort({ businessDate: -1, time: -1 }).limit(150).lean(),
    DentalMasterPlan.findOne({ patientId: pid }).lean(),
    Patient.findById(pid).select('sessionPackages').lean(),
    ClinicalSession.find({ patientId: pid, laserSessionId: { $ne: null } })
      .select('laserSessionId notes')
      .lean(),
  ])

  const clinicalNotesByLaserId = new Map(
    (clinicalLaserNotesRows || []).map((r) => [String(r.laserSessionId), String(r.notes || '').trim()]),
  )

  const packagesById = new Map(
    (Array.isArray(patientDoc?.sessionPackages) ? patientDoc.sessionPackages : []).map((p) => [
      String(p._id),
      p,
    ]),
  )
  const optionIds = new Set()
  for (const s of laserRows) {
    if (s.isPackageSession !== true) continue
    const pkg = packagesById.get(String(s.patientPackageId || ''))
    if (pkg) {
      for (const id of pkg.procedureOptionIds || []) optionIds.add(String(id))
    }
    for (const li of s.lineItems || []) {
      if (li?.procedureOptionId) optionIds.add(String(li.procedureOptionId))
    }
  }
  const optionRows =
    optionIds.size > 0
      ? await LaserProcedureOption.find({ _id: { $in: [...optionIds] } })
          .select('name kind')
          .lean()
      : []
  const optionMetaById = new Map(
    optionRows.map((r) => [
      String(r._id),
      { name: String(r.name || '').trim(), kind: String(r.kind || 'area').trim() },
    ]),
  )

  const billingIds = laserRows.map((s) => s.billingItemId).filter(Boolean)
  const billingItems = billingIds.length
    ? await BillingItem.find({ _id: { $in: billingIds } }).lean()
    : []
  const paymentIds = billingItems.map((b) => b.paymentId).filter(Boolean)
  const billingPayments = paymentIds.length
    ? await BillingPayment.find({ _id: { $in: paymentIds } }).lean()
    : []
  const payById = new Map(billingPayments.map((p) => [String(p._id), p]))
  const itemById = new Map(billingItems.map((b) => [String(b._id), b]))

  let dentalPlan = null
  if (planDoc) {
    dentalPlan = {
      status: planDoc.status,
      items: Array.isArray(planDoc.items) ? planDoc.items : [],
      approvedAt: planDoc.approvedAt,
    }
  }

  const laserSessions = laserRows.map((s) => {
    const bi = s.billingItemId ? itemById.get(String(s.billingItemId)) : null
    const pay = bi?.paymentId && bi.status === 'paid' ? payById.get(String(bi.paymentId)) : null
    const collectedAmountSyp = pay && Number.isFinite(pay.amountSyp) ? pay.amountSyp : null
    let effectiveStatus = s.status
    if (bi?.status === 'paid') {
      effectiveStatus = 'completed'
    } else if (s.status === 'completed' && bi?.status === 'pending_payment') {
      effectiveStatus = 'completed_pending_collection'
    }
    const lineItemsRaw = Array.isArray(s.lineItems) ? s.lineItems : []
    const packageNonAddonLineCount = lineItemsRaw.filter((r) => !r.isAddon).length
    const laserNotes = String(s.notes || '').trim()
    const clinicalNotes = clinicalNotesByLaserId.get(String(s._id)) || ''
    const notesMerged = [laserNotes, clinicalNotes].filter(Boolean)
    const notes = [...new Set(notesMerged)].join(' — ')
    return {
      id: String(s._id),
      treatmentNumber: s.treatmentNumber,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      laserType: s.laserType,
      room: s.room,
      status: effectiveStatus,
      operatorName: s.operatorUserId?.name || '—',
      areaIds: Array.isArray(s.areaIds) ? s.areaIds : [],
      notes,
      pw: s.pw || '',
      pulse: s.pulse || '',
      shotCount: s.shotCount || '',
      chargeByPulseCount: s.chargeByPulseCount === true,
      costSyp: s.costSyp ?? 0,
      discountPercent: s.discountPercent ?? 0,
      sessionTypeLabel: s.sessionTypeLabel || '',
      billingItemId: s.billingItemId ? String(s.billingItemId) : null,
      billingItemStatus: bi?.status ?? null,
      collectedAmountSyp,
      manualAreaLabels: Array.isArray(s.manualAreaLabels) ? s.manualAreaLabels : [],
      isPackageSession: s.isPackageSession === true,
      patientPackageId: String(s.patientPackageId || ''),
      patientPackageSessionId: String(s.patientPackageSessionId || ''),
      laserCoverApplied: s.laserCoverApplied === true,
      laserCoverSyp: Math.max(0, Math.round(Number(s.laserCoverSyp) || 0)),
      packageNonAddonLineCount,
      lineItems: lineItemsRaw.map((row) => ({
        procedureOptionId: String(row.procedureOptionId || ''),
        areaLabel: String(row.areaLabel || ''),
        pw: String(row.pw || ''),
        pulse: String(row.pulse || ''),
        shotCount: String(row.shotCount || ''),
        chargeByPulseCount: row.chargeByPulseCount === true,
        isAddon: row.isAddon === true,
      })),
      packageAreaBreakdown: buildLaserPackageAreaBreakdown(s, packagesById, optionMetaById),
    }
  })

  const dermatologyVisits = dermRows.map((v) => ({
    id: String(v._id),
    businessDate: v.businessDate,
    areaTreatment: v.areaTreatment || '',
    sessionType: v.sessionType || '',
    costSyp: v.costSyp ?? 0,
    discountPercent: v.discountPercent ?? 0,
    providerName: v.providerUserId?.name || '—',
    notes: v.notes || '',
    createdAt: v.createdAt,
  }))

  const appointments = apptRows.map((o) => ({
    id: String(o._id),
    businessDate: o.businessDate,
    time: o.time,
    endTime: slotEndDisplay(o),
    providerName: o.providerName,
    procedureType: String(o.procedureType || '').trim(),
  }))

  return { laserSessions, dermatologyVisits, appointments, dentalPlan }
}
