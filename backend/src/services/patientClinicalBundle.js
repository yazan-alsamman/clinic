import { LaserSession } from '../models/LaserSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { DentalMasterPlan } from '../models/DentalMasterPlan.js'
import { normalizeHm, hmToMinutes } from '../utils/scheduleTime.js'

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
  const [laserRows, dermRows, apptRows, planDoc] = await Promise.all([
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
  ])

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
    const collectedAmountUsd = pay && Number.isFinite(pay.amountUsd) ? pay.amountUsd : null
    let effectiveStatus = s.status
    if (bi?.status === 'paid') {
      effectiveStatus = 'completed'
    } else if (s.status === 'completed' && bi?.status === 'pending_payment') {
      effectiveStatus = 'completed_pending_collection'
    }
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
      notes: s.notes || '',
      pw: s.pw || '',
      pulse: s.pulse || '',
      shotCount: s.shotCount || '',
      costUsd: s.costUsd ?? 0,
      discountPercent: s.discountPercent ?? 0,
      sessionTypeLabel: s.sessionTypeLabel || '',
      billingItemId: s.billingItemId ? String(s.billingItemId) : null,
      billingItemStatus: bi?.status ?? null,
      collectedAmountUsd,
      manualAreaLabels: Array.isArray(s.manualAreaLabels) ? s.manualAreaLabels : [],
    }
  })

  const dermatologyVisits = dermRows.map((v) => ({
    id: String(v._id),
    businessDate: v.businessDate,
    areaTreatment: v.areaTreatment || '',
    sessionType: v.sessionType || '',
    costUsd: v.costUsd ?? 0,
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
