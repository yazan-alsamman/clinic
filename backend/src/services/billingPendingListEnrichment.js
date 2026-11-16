import mongoose from 'mongoose'
import { LaserSession } from '../models/LaserSession.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { Patient } from '../models/Patient.js'
import { demoteAddonOnlyLinkedPackageSession } from './laserPackageBooking.js'
import { buildVisitDeductionPreviewFromData } from './laserAreaDeductions.js'
import { attachLaserVisitBreakdowns } from './laserVisitBillingBreakdown.js'

function laserAreaNamesFromSession(ls) {
  const fromLines = []
  for (const row of ls?.lineItems || []) {
    const label = String(row?.areaLabel || '').trim()
    if (!label) continue
    let name = row.isAddon === true ? `${label} (خارج الباكج)` : label
    if (row.chargeByPulseCount === true) {
      const shots = String(row.shotCount || '').trim()
      name += shots
        ? ` — محاسبة على عدد الضربات: ${shots}`
        : ' — محاسبة على عدد الضربات'
    }
    fromLines.push(name)
  }
  if (fromLines.length) return fromLines
  const manual = (ls?.manualAreaLabels || []).map((x) => String(x || '').trim()).filter(Boolean)
  if (ls?.chargeByPulseCount === true && manual.length) {
    const shots = String(ls.shotCount || '').trim()
    const suffix = shots ? ` — محاسبة على عدد الضربات: ${shots}` : ' — محاسبة على عدد الضربات'
    return manual.map((name) => `${name}${suffix}`)
  }
  return manual
}

function laserPulseChargeNotesFromSession(ls) {
  const notes = []
  for (const row of ls?.lineItems || []) {
    if (row?.chargeByPulseCount !== true) continue
    const label = String(row.areaLabel || '').trim() || 'منطقة'
    const shots = String(row.shotCount || '').trim()
    notes.push(shots ? `${label}: ${shots} ضربة` : label)
  }
  if (!notes.length && ls?.chargeByPulseCount === true) {
    const shots = String(ls.shotCount || '').trim()
    notes.push(shots ? `الجلسة: ${shots} ضربة` : 'الجلسة')
  }
  return notes
}

function isLaserPackageBillingRow(b) {
  return b?.isPackagePrepaid === true && String(b?.department || '') === 'laser' && Boolean(b?.patientPackageId)
}

/**
 * يُرفق لكل بند باكج ليزر معاينة إنقاص المناطق (بدون N+1):
 * المناطق ورصيدها، ما عولج في الزيارة (مُحدَّد مسبقاً)، وما أُنقص سابقاً لنفس الزيارة.
 * laserPackageMetricsReady=true فقط بعد بناء المعاينة — لا يظهر زر الإنقاص قبلها.
 */
export async function enrichLaserPackageAreaMetrics(billingItems, dtos) {
  const targets = []
  for (let i = 0; i < billingItems.length; i++) {
    const b = billingItems[i]
    const dto = dtos[i]
    if (!dto || !isLaserPackageBillingRow(b)) continue
    const pidRaw = b.patientId?._id || b.patientId
    const pid = pidRaw ? String(pidRaw) : ''
    if (!pid || !mongoose.isValidObjectId(pid)) {
      dto.laserPackageMetricsReady = false
      continue
    }
    targets.push({ i, b, dto, pid })
  }
  if (!targets.length) return

  const billIds = targets.map((t) => t.b._id)
  const patientIds = [...new Set(targets.map((t) => t.pid))]
  const [sessions, patients] = await Promise.all([
    LaserSession.find({ billingItemId: { $in: billIds } })
      .select('_id billingItemId lineItems patientId patientPackageId')
      .lean(),
    Patient.find({ _id: { $in: patientIds } })
      .select('sessionPackages')
      .lean(),
  ])
  const sessionByBill = new Map(sessions.map((s) => [String(s.billingItemId), s]))
  const patientById = new Map(patients.map((p) => [String(p._id), p]))

  const optionIdSet = new Set()
  for (const p of patients) {
    for (const pkg of p.sessionPackages || []) for (const id of pkg?.procedureOptionIds || []) if (id) optionIdSet.add(String(id))
  }
  for (const ls of sessions) for (const li of ls.lineItems || []) if (li?.procedureOptionId) optionIdSet.add(String(li.procedureOptionId))
  const validIds = [...optionIdSet].filter((id) => mongoose.isValidObjectId(id))
  const optionRows = validIds.length
    ? await LaserProcedureOption.find({ _id: { $in: validIds } }).select('name kind').lean()
    : []
  const optionMetaById = new Map(
    optionRows.map((r) => [String(r._id), { name: String(r.name || '').trim(), kind: String(r.kind || 'area').trim() }]),
  )

  for (const { b, dto, pid } of targets) {
    const ls = sessionByBill.get(String(b._id))
    const nonAddonLines = (Array.isArray(ls?.lineItems) ? ls.lineItems : []).filter((r) => !r.isAddon)
    if (nonAddonLines.length === 0) {
      /** بند قديم مربوط بباكج لكن بلا أي منطقة باكج — يُحوَّل لجلسة عادية (السلوك السابق) */
      if (b.patientPackageSessionId) {
        await demoteAddonOnlyLinkedPackageSession({
          patientId: pid,
          packageId: b.patientPackageId,
          packageSessionId: b.patientPackageSessionId,
          laserSessionId: ls?._id,
          billingItemId: b._id,
        })
        dto.isPackagePrepaid = false
        dto.patientPackageId = undefined
        dto.patientPackageSessionId = undefined
      }
      dto.laserPackageMetricsReady = false
      continue
    }
    const patient = patientById.get(pid)
    if (!ls || !patient) {
      dto.laserPackageMetricsReady = false
      continue
    }
    dto.laserSessionId = String(ls._id)
    dto.laserPackageDeduction = buildVisitDeductionPreviewFromData({ patient, laserSession: ls, optionMetaById })
    dto.laserPackageMetricsReady = true
  }
}

export async function attachLaserAreaLabels(billingItems, dtos) {
  const laserIdx = []
  for (let i = 0; i < billingItems.length; i++) {
    if (String(billingItems[i]?.department || '') === 'laser') laserIdx.push(i)
  }
  if (!laserIdx.length) return

  const billIds = laserIdx.map((i) => billingItems[i]._id)
  const clinicalIds = laserIdx
    .map((i) => billingItems[i].clinicalSessionId)
    .filter((id) => id && mongoose.isValidObjectId(id))

  const sessions = await LaserSession.find({
    $or: [
      { billingItemId: { $in: billIds } },
      ...(clinicalIds.length ? [{ clinicalSessionId: { $in: clinicalIds } }] : []),
    ],
  })
    .select('billingItemId clinicalSessionId lineItems manualAreaLabels chargeByPulseCount shotCount')
    .lean()

  const byBill = new Map()
  const byCs = new Map()
  for (const s of sessions) {
    if (s.billingItemId) byBill.set(String(s.billingItemId), s)
    if (s.clinicalSessionId) byCs.set(String(s.clinicalSessionId), s)
  }

  for (const i of laserIdx) {
    const b = billingItems[i]
    const ls =
      byBill.get(String(b._id)) ||
      (b.clinicalSessionId ? byCs.get(String(b.clinicalSessionId)) : null)
    const names = laserAreaNamesFromSession(ls)
    const pulseNotes = laserPulseChargeNotesFromSession(ls)
    if (names.length) dtos[i].laserAreaLabels = names
    if (pulseNotes.length) dtos[i].laserPulseChargeNotes = pulseNotes
  }
}

/**
 * المسار الوحيد المسموح لإنهاء DTO قائمة التحصيل — لا تُرجع بنوداً معلّقة بدونه.
 */
export async function finalizePendingBillingDtos(billingItems, dtos) {
  if (!Array.isArray(billingItems) || !Array.isArray(dtos) || billingItems.length !== dtos.length) {
    throw new Error('finalizePendingBillingDtos: items/dtos length mismatch')
  }
  await enrichLaserPackageAreaMetrics(billingItems, dtos)
  await attachLaserVisitBreakdowns(billingItems, dtos)
  await attachLaserAreaLabels(billingItems, dtos)
  return dtos
}
