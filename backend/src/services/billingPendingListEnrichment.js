import mongoose from 'mongoose'
import { LaserSession } from '../models/LaserSession.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { Patient } from '../models/Patient.js'
import { demoteAddonOnlyLinkedPackageSession } from './laserPackageBooking.js'
import { buildPackageAreaBreakdown } from './laserPackageAreaBreakdown.js'

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
  return (
    b?.isPackagePrepaid === true &&
    String(b?.department || '') === 'laser' &&
    Boolean(b?.patientPackageSessionId) &&
    Boolean(b?.patientPackageId)
  )
}

/**
 * يُرفق مقاييس باكج الليزر دفعة واحدة (بدون N+1) — إلزامي قبل إرسال أي قائمة تحصيل.
 * يضبط دائماً: packageExpectedAreaCount / laserRecordedPackageAreaCount /
 * packagePartialAreasAcknowledgedByReception / laserPackageMetricsReady
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
      .select('_id billingItemId lineItems')
      .lean(),
    Patient.find({ _id: { $in: patientIds } })
      .select('sessionPackages')
      .lean(),
  ])

  const sessionByBill = new Map(sessions.map((s) => [String(s.billingItemId), s]))
  const patientById = new Map(patients.map((p) => [String(p._id), p]))

  const optionIdSet = new Set()
  for (const t of targets) {
    const ls = sessionByBill.get(String(t.b._id))
    const p = patientById.get(t.pid)
    const pkg = (Array.isArray(p?.sessionPackages) ? p.sessionPackages : []).find(
      (x) => String(x._id) === String(t.b.patientPackageId),
    )
    for (const id of pkg?.procedureOptionIds || []) {
      if (id) optionIdSet.add(String(id))
    }
    for (const li of ls?.lineItems || []) {
      if (li?.procedureOptionId) optionIdSet.add(String(li.procedureOptionId))
    }
  }

  const optionRows =
    optionIdSet.size > 0
      ? await LaserProcedureOption.find({ _id: { $in: [...optionIdSet] } })
          .select('name kind')
          .lean()
      : []
  const optionMetaById = new Map(
    optionRows.map((r) => [
      String(r._id),
      { name: String(r.name || '').trim(), kind: String(r.kind || 'area').trim() },
    ]),
  )

  for (const t of targets) {
    const { b, dto, pid } = t
    const ls = sessionByBill.get(String(b._id))
    const nonAddonLines = (Array.isArray(ls?.lineItems) ? ls.lineItems : []).filter((r) => !r.isAddon)

    if (nonAddonLines.length === 0) {
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
      dto.laserPackageMetricsReady = false
      delete dto.packageExpectedAreaCount
      delete dto.laserRecordedPackageAreaCount
      delete dto.packagePartialAreasAcknowledgedByReception
      delete dto.laserPackageRemainingAreaLabels
      continue
    }

    const p = patientById.get(pid)
    const pkg = (Array.isArray(p?.sessionPackages) ? p.sessionPackages : []).find(
      (x) => String(x._id) === String(b.patientPackageId),
    )
    const pkgIds = Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds : []
    const fallbackExpected = Math.max(1, Math.trunc(Number(pkg?.areaCount) || 0), pkgIds.length, nonAddonLines.length)
    const breakdown = pkg ? buildPackageAreaBreakdown(ls, pkg, optionMetaById) : null

    let recorded
    let expected
    let remaining = []
    if (breakdown) {
      recorded = Math.max(0, Math.trunc(Number(breakdown.matchedPackageAreaCount) || 0))
      expected = Math.max(1, Math.trunc(Number(breakdown.expectedAreaCount) || 0), fallbackExpected)
      remaining = Array.isArray(breakdown.remainingAreas) ? breakdown.remainingAreas : []
      /**
       * إن وُجدت مناطق متبقية في تفكيك العرض/الباكج فلا يُسمح باعتبار العدد «مكتملاً»
       * حتى لو تطابق العدّاد الرقمي بالخطأ.
       */
      if (remaining.length > 0 && recorded >= expected) {
        expected = recorded + remaining.length
      }
    } else {
      recorded = nonAddonLines.length
      expected = Math.max(fallbackExpected, recorded + 1)
      remaining = []
    }

    const pkgSessions = Array.isArray(pkg?.sessions) ? pkg.sessions : []
    const pSess = pkgSessions.find((s) => String(s._id) === String(b.patientPackageSessionId))
    const ack = Math.max(0, Math.trunc(Number(pSess?.packagePartialAreasAcknowledgedByReception) || 0))

    dto.packageExpectedAreaCount = expected
    dto.laserRecordedPackageAreaCount = recorded
    dto.packagePartialAreasAcknowledgedByReception = Math.min(ack, recorded)
    dto.laserPackageMetricsReady = true
    if (remaining.length) {
      dto.laserPackageRemainingAreaLabels = remaining
    } else {
      delete dto.laserPackageRemainingAreaLabels
    }
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
  await attachLaserAreaLabels(billingItems, dtos)
  return dtos
}
