import { LaserSession } from '../models/LaserSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'

function packageExpectedAreaCount(pkg) {
  const ids = Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds : []
  return Math.max(1, Math.trunc(Number(pkg?.areaCount) || 0), ids.length)
}

function buildAreaBreakdownFromSessionRow(sessionRow, pkg, nameByOptionId) {
  const packageIds = (Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds : [])
    .map(String)
    .filter(Boolean)
  if (!packageIds.length) return null

  const doneItems = (Array.isArray(sessionRow?.lineItems) ? sessionRow.lineItems : []).filter((r) => !r.isAddon)
  const doneAreas = []
  const remainingProcedureOptionIds = [...packageIds]
  for (const li of doneItems) {
    const oid = String(li.procedureOptionId || '')
    const label =
      String(li.areaLabel || '').trim() || (oid ? nameByOptionId.get(oid) : '') || ''
    if (label) doneAreas.push(label)
    if (oid) {
      const idx = remainingProcedureOptionIds.indexOf(oid)
      if (idx >= 0) remainingProcedureOptionIds.splice(idx, 1)
    }
  }
  const remainingAreas = remainingProcedureOptionIds
    .map((id) => nameByOptionId.get(id) || id)
    .filter(Boolean)
  const expected = packageExpectedAreaCount(pkg)
  const isPartial = doneAreas.length > 0 && doneAreas.length < expected
  return {
    doneAreas,
    remainingAreas,
    remainingProcedureOptionIds,
    isPartial,
    expectedAreaCount: expected,
  }
}

/** أول جلسة باكج بلا ربط ليزر ولم تُثبَّت من الاستقبال */
export function findFreshLaserPackageSession(patientLike) {
  const packages = Array.isArray(patientLike?.sessionPackages) ? patientLike.sessionPackages : []
  for (const pkg of packages) {
    if (String(pkg?.department || '') !== 'laser') continue
    if (pkg.suspended === true) continue
    const sessions = Array.isArray(pkg?.sessions) ? pkg.sessions : []
    const available = sessions.find((s) => !s?.linkedLaserSessionId && s?.completedByReception !== true)
    if (available) {
      return {
        pkg,
        session: available,
        mode: 'fresh',
        expectedAreas: packageExpectedAreaCount(pkg),
      }
    }
  }
  return null
}

/** جلسة باكج مربوطة بليزر وما زالت مناطقها ناقصة وبند التحصيل معلّق */
export async function findContinueLaserPackageSession(patientLike) {
  const packages = Array.isArray(patientLike?.sessionPackages) ? patientLike.sessionPackages : []
  for (const pkg of packages) {
    if (String(pkg?.department || '') !== 'laser') continue
    if (pkg.suspended === true) continue
    const sessions = Array.isArray(pkg?.sessions) ? pkg.sessions : []
    const expectedAreas = packageExpectedAreaCount(pkg)
    for (const session of sessions) {
      if (session?.completedByReception === true) continue
      if (!session?.linkedLaserSessionId) continue
      const ls = await LaserSession.findById(session.linkedLaserSessionId).lean()
      const bi = session.linkedBillingItemId
        ? await BillingItem.findById(String(session.linkedBillingItemId)).lean()
        : null
      const recorded = (Array.isArray(ls?.lineItems) ? ls.lineItems : []).filter((r) => !r.isAddon).length
      if (ls && bi?.status === 'pending_payment' && recorded < expectedAreas) {
        return {
          pkg,
          session,
          mode: 'continue',
          expectedAreas,
          existingLaserSession: ls,
          billingItem: bi,
        }
      }
    }
  }
  return null
}


export function normalizeLaserSlotPackageModeForResolve(mode) {
  const m = String(mode || '').trim()
  if (m === 'continue_package_with_addon') return 'continue_package'
  if (m === 'use_package_with_addon') return 'use_package'
  return m
}

export async function resolveLaserPackageSessionForBooking(patientLike, slotPackageMode) {
  const mode = normalizeLaserSlotPackageModeForResolve(slotPackageMode)
  if (mode === 'outside_package') return null
  if (mode === 'continue_package') return findContinueLaserPackageSession(patientLike)
  if (mode === 'use_package') return findFreshLaserPackageSession(patientLike)
  const cont = await findContinueLaserPackageSession(patientLike)
  if (cont) return cont
  return findFreshLaserPackageSession(patientLike)
}

export async function getLaserBookingContextForPatient(patientDoc) {
  const packages = Array.isArray(patientDoc?.sessionPackages) ? patientDoc.sessionPackages : []
  const laserPkgs = packages.filter(
    (p) => String(p?.department || '') === 'laser' && p.suspended !== true,
  )
  if (!laserPkgs.length) {
    return { hasOpenPackage: false, partialVisit: null, hasFreshPackageSession: false }
  }

  const optionIds = new Set()
  for (const pkg of laserPkgs) {
    for (const id of pkg.procedureOptionIds || []) optionIds.add(String(id))
  }
  const continueMatch = await findContinueLaserPackageSession(patientDoc)
  if (continueMatch?.existingLaserSession?.lineItems) {
    for (const li of continueMatch.existingLaserSession.lineItems) {
      if (li?.procedureOptionId) optionIds.add(String(li.procedureOptionId))
    }
  }
  const nameRows =
    optionIds.size > 0
      ? await LaserProcedureOption.find({ _id: { $in: [...optionIds] } })
          .select('name')
          .lean()
      : []
  const nameByOptionId = new Map(nameRows.map((r) => [String(r._id), String(r.name || '').trim()]))

  const fresh = findFreshLaserPackageSession(patientDoc)
  const hasFreshPackageSession = Boolean(fresh)

  let partialVisit = null
  if (continueMatch?.existingLaserSession && continueMatch.pkg) {
    const breakdown = buildAreaBreakdownFromSessionRow(
      continueMatch.existingLaserSession,
      continueMatch.pkg,
      nameByOptionId,
    )
    if (breakdown?.isPartial) {
      partialVisit = {
        packageId: String(continueMatch.pkg._id),
        packageSessionId: String(continueMatch.session._id),
        packageTitle: String(continueMatch.pkg.title || 'باكج ليزر'),
        packageSessionLabel: String(continueMatch.session.label || ''),
        doneAreas: breakdown.doneAreas,
        remainingAreas: breakdown.remainingAreas,
        remainingProcedureOptionIds: breakdown.remainingProcedureOptionIds,
        linkedLaserSessionId: String(continueMatch.existingLaserSession._id),
      }
    }
  }

  const hasOpenPackage =
    hasFreshPackageSession ||
    partialVisit != null ||
    laserPkgs.some((pkg) =>
      (pkg.sessions || []).some((s) => !s?.completedByReception && !s?.linkedLaserSessionId),
    )

  return { hasOpenPackage, partialVisit, hasFreshPackageSession }
}
