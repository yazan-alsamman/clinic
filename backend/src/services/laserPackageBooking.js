import { LaserSession } from '../models/LaserSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { Patient } from '../models/Patient.js'
import { buildPackageAreaBreakdown } from './laserPackageAreaBreakdown.js'

function packageExpectedAreaCount(pkg) {
  const ids = Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds : []
  return Math.max(1, Math.trunc(Number(pkg?.areaCount) || 0), ids.length)
}

export function countLaserPackageNonAddonAreas(sessionRow) {
  return (Array.isArray(sessionRow?.lineItems) ? sessionRow.lineItems : []).filter((r) => !r.isAddon).length
}

/**
 * جلسة حُجزت كباكج+خارج ثم بقيت مناطق خارج الباكج فقط:
 * لا يجب ربط/استهلاك جلسة الباكج — نفك الربط ونحوّل البند لجلسة عادية مدفوعة.
 * @returns {Promise<boolean>} true إذا تم فك الربط
 */
export async function demoteAddonOnlyLinkedPackageSession({
  patientId,
  packageId,
  packageSessionId,
  laserSessionId,
  billingItemId,
}) {
  const pid = String(patientId || '').trim()
  const pkgId = String(packageId || '').trim()
  const sessId = String(packageSessionId || '').trim()
  const lsId = String(laserSessionId || '').trim()
  const biId = String(billingItemId || '').trim()
  if (!pid || !pkgId || !sessId) return false

  let ls = null
  if (lsId) {
    ls = await LaserSession.findById(lsId).select('lineItems isPackageSession').lean()
  }
  if (!ls && biId) {
    ls = await LaserSession.findOne({ billingItemId: biId }).select('_id lineItems isPackageSession').lean()
  }
  if (!ls) return false

  const patient = await Patient.findById(pid).select('sessionPackages').lean()
  const pkg = (Array.isArray(patient?.sessionPackages) ? patient.sessionPackages : []).find(
    (p) => String(p?._id) === pkgId,
  )
  let matchedPackageAreaCount = 0
  if (pkg) {
    const optionIds = new Set((pkg.procedureOptionIds || []).map((id) => String(id)))
    for (const li of ls.lineItems || []) {
      if (li?.procedureOptionId) optionIds.add(String(li.procedureOptionId))
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
    const breakdown = buildPackageAreaBreakdown(ls, pkg, optionMetaById)
    matchedPackageAreaCount = Number(breakdown?.matchedPackageAreaCount || 0)
  } else if (countLaserPackageNonAddonAreas(ls) > 0) {
    return false
  }
  /** لا تُفك الجلسة إذا استُهلكت منطقة حقيقية من الباكج */
  if (matchedPackageAreaCount > 0) return false

  await Patient.updateOne(
    { _id: pid },
    {
      $set: {
        'sessionPackages.$[pkg].sessions.$[sess].linkedLaserSessionId': null,
        'sessionPackages.$[pkg].sessions.$[sess].linkedBillingItemId': null,
        'sessionPackages.$[pkg].sessions.$[sess].packagePartialAreasAcknowledgedByReception': 0,
        'sessionPackages.$[pkg].sessions.$[sess].areasAdjustedOnly': false,
        'sessionPackages.$[pkg].sessions.$[sess].completedByReception': false,
        'sessionPackages.$[pkg].sessions.$[sess].completedAt': null,
        'sessionPackages.$[pkg].sessions.$[sess].completedByUserId': null,
      },
    },
    {
      arrayFilters: [{ 'pkg._id': pkgId }, { 'sess._id': sessId }],
    },
  )

  const resolvedLsId = lsId || String(ls._id || '')
  if (resolvedLsId) {
    await LaserSession.updateOne(
      { _id: resolvedLsId },
      {
        $set: {
          isPackageSession: false,
          patientPackageId: '',
          patientPackageSessionId: '',
        },
      },
    )
    await ClinicalSession.updateMany(
      { laserSessionId: resolvedLsId },
      {
        $set: {
          isPackageSession: false,
          patientPackageId: '',
          patientPackageSessionId: '',
        },
      },
    )
  }

  if (biId) {
    await BillingItem.updateOne(
      { _id: biId },
      {
        $set: {
          isPackagePrepaid: false,
          patientPackageId: '',
          patientPackageSessionId: '',
        },
      },
    )
  }

  return true
}

function packageIdMatches(pkg, packageId) {
  const wanted = String(packageId || '').trim()
  if (!wanted) return true
  return String(pkg?._id || '') === wanted
}

/** أول جلسة باكج بلا ربط ليزر ولم تُثبَّت من الاستقبال */
export function findFreshLaserPackageSession(patientLike, packageId) {
  const packages = Array.isArray(patientLike?.sessionPackages) ? patientLike.sessionPackages : []
  for (const pkg of packages) {
    if (String(pkg?.department || '') !== 'laser') continue
    if (pkg.suspended === true) continue
    if (!packageIdMatches(pkg, packageId)) continue
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
export async function findContinueLaserPackageSession(patientLike, packageId) {
  const packages = Array.isArray(patientLike?.sessionPackages) ? patientLike.sessionPackages : []
  for (const pkg of packages) {
    if (String(pkg?.department || '') !== 'laser') continue
    if (pkg.suspended === true) continue
    if (!packageIdMatches(pkg, packageId)) continue
    const sessions = Array.isArray(pkg?.sessions) ? pkg.sessions : []
    const expectedAreas = packageExpectedAreaCount(pkg)
    for (const session of sessions) {
      if (session?.completedByReception === true) continue
      if (!session?.linkedLaserSessionId) continue
      const ls = await LaserSession.findById(session.linkedLaserSessionId).lean()
      const bi = session.linkedBillingItemId
        ? await BillingItem.findById(String(session.linkedBillingItemId)).lean()
        : null
      const recorded = countLaserPackageNonAddonAreas(ls)
      // مناطق خارج الباكج فقط أو مناطق لا تطابق الباكج — فك الربط الخاطئ
      if (ls && recorded === 0) {
        await demoteAddonOnlyLinkedPackageSession({
          patientId: patientLike?._id || patientLike?.id,
          packageId: pkg._id,
          packageSessionId: session._id,
          laserSessionId: session.linkedLaserSessionId,
          billingItemId: session.linkedBillingItemId || ls.billingItemId,
        })
        continue
      }
      if (ls) {
        const optionIds = new Set((pkg.procedureOptionIds || []).map((id) => String(id)))
        for (const li of ls.lineItems || []) {
          if (li?.procedureOptionId) optionIds.add(String(li.procedureOptionId))
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
        const breakdown = buildPackageAreaBreakdown(ls, pkg, optionMetaById)
        if (breakdown && Number(breakdown.matchedPackageAreaCount || 0) === 0) {
          await demoteAddonOnlyLinkedPackageSession({
            patientId: patientLike?._id || patientLike?.id,
            packageId: pkg._id,
            packageSessionId: session._id,
            laserSessionId: session.linkedLaserSessionId,
            billingItemId: session.linkedBillingItemId || ls.billingItemId,
          })
          continue
        }
        const leftover = Array.isArray(breakdown?.remainingAreas) ? breakdown.remainingAreas.length : 0
        if (leftover > 0 && Number(breakdown?.matchedPackageAreaCount || 0) > 0) {
          return {
            pkg,
            session,
            mode: 'continue',
            expectedAreas: Math.max(expectedAreas, Number(breakdown?.expectedAreaCount || 0)),
            existingLaserSession: ls,
            billingItem: bi,
          }
        }
      }
      if (ls && bi?.status === 'pending_payment' && recorded > 0 && recorded < expectedAreas) {
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

export async function resolveLaserPackageSessionForBooking(patientLike, slotPackageMode, packageId) {
  const mode = normalizeLaserSlotPackageModeForResolve(slotPackageMode)
  if (mode === 'outside_package') return null
  if (mode === 'continue_package') return findContinueLaserPackageSession(patientLike, packageId)
  if (mode === 'use_package') return findFreshLaserPackageSession(patientLike, packageId)
  const cont = await findContinueLaserPackageSession(patientLike, packageId)
  if (cont) return cont
  return findFreshLaserPackageSession(patientLike, packageId)
}

async function uncompleteLaserPackageSession({ patientId, packageId, packageSessionId }) {
  const pid = String(patientId || '').trim()
  const pkgId = String(packageId || '').trim()
  const sessId = String(packageSessionId || '').trim()
  if (!pid || !pkgId || !sessId) return false
  const r = await Patient.updateOne(
    { _id: pid },
    {
      $set: {
        'sessionPackages.$[pkg].sessions.$[sess].completedByReception': false,
        'sessionPackages.$[pkg].sessions.$[sess].completedAt': null,
        'sessionPackages.$[pkg].sessions.$[sess].completedByUserId': null,
      },
    },
    { arrayFilters: [{ 'pkg._id': pkgId }, { 'sess._id': sessId }] },
  )
  return (r?.modifiedCount || 0) > 0
}

/**
 * يعيد فتح جلسات الباكج ذات المناطق غير المُنجَزة، ويفك الربط إن لم تُستهلك أي منطقة من الباكج.
 */
export async function repairLaserPackageLeftoverSessions(patientLike) {
  const pid = patientLike?._id || patientLike?.id
  if (!pid) return { repaired: false }
  const packages = Array.isArray(patientLike?.sessionPackages) ? patientLike.sessionPackages : []
  let repaired = false
  for (const pkg of packages) {
    if (String(pkg?.department || '') !== 'laser') continue
    if (pkg.suspended === true) continue
    for (const session of pkg.sessions || []) {
      if (!session?.linkedLaserSessionId) continue
      const ls = await LaserSession.findById(session.linkedLaserSessionId).lean()
      if (!ls) continue
      const demoted = await demoteAddonOnlyLinkedPackageSession({
        patientId: pid,
        packageId: pkg._id,
        packageSessionId: session._id,
        laserSessionId: session.linkedLaserSessionId,
        billingItemId: session.linkedBillingItemId || ls.billingItemId,
      })
      if (demoted) {
        repaired = true
        continue
      }
      if (session?.completedByReception === true) {
        const optionIds = new Set((pkg.procedureOptionIds || []).map((id) => String(id)))
        for (const li of ls.lineItems || []) {
          if (li?.procedureOptionId) optionIds.add(String(li.procedureOptionId))
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
        const breakdown = buildPackageAreaBreakdown(ls, pkg, optionMetaById)
        if (breakdown?.hasUnusedPackageAreas) {
          const ok = await uncompleteLaserPackageSession({
            patientId: pid,
            packageId: pkg._id,
            packageSessionId: session._id,
          })
          if (ok) repaired = true
        }
      }
    }
  }
  return { repaired }
}

export async function getLaserBookingContextForPatient(patientDoc) {
  let working = patientDoc
  const repair = await repairLaserPackageLeftoverSessions(working)
  if (repair.repaired && (working?._id || working?.id)) {
    const freshDoc = await Patient.findById(working._id || working.id).lean()
    if (freshDoc) working = freshDoc
  }

  const packages = Array.isArray(working?.sessionPackages) ? working.sessionPackages : []
  const laserPkgs = packages.filter(
    (p) => String(p?.department || '') === 'laser' && p.suspended !== true,
  )
  if (!laserPkgs.length) {
    return {
      hasOpenPackage: false,
      partialVisit: null,
      hasFreshPackageSession: false,
      openPackages: [],
    }
  }

  const optionIds = new Set()
  for (const pkg of laserPkgs) {
    for (const id of pkg.procedureOptionIds || []) optionIds.add(String(id))
    for (const session of pkg.sessions || []) {
      if (!session?.linkedLaserSessionId) continue
      const ls = await LaserSession.findById(session.linkedLaserSessionId).select('lineItems').lean()
      for (const li of ls?.lineItems || []) {
        if (li?.procedureOptionId) optionIds.add(String(li.procedureOptionId))
      }
    }
  }
  const continueMatch = await findContinueLaserPackageSession(working)
  if (continueMatch?.existingLaserSession?.lineItems) {
    for (const li of continueMatch.existingLaserSession.lineItems) {
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

  const fresh = findFreshLaserPackageSession(working)
  const hasFreshPackageSession = Boolean(fresh)

  let partialVisit = null
  if (continueMatch?.existingLaserSession && continueMatch.pkg) {
    const breakdown = buildPackageAreaBreakdown(
      continueMatch.existingLaserSession,
      continueMatch.pkg,
      optionMetaById,
    )
    if (breakdown?.hasUnusedPackageAreas) {
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

  const leftoverByPkgId = new Map()
  for (const pkg of laserPkgs) {
    const leftoverLabels = []
    for (const session of pkg.sessions || []) {
      if (!session?.linkedLaserSessionId) continue
      const ls = await LaserSession.findById(session.linkedLaserSessionId).lean()
      if (!ls) continue
      const breakdown = buildPackageAreaBreakdown(ls, pkg, optionMetaById)
      if (breakdown?.remainingAreas?.length) leftoverLabels.push(...breakdown.remainingAreas)
    }
    leftoverByPkgId.set(String(pkg._id), [...new Set(leftoverLabels)])
  }

  const openPackages = []
  for (const pkg of laserPkgs) {
    const sessions = Array.isArray(pkg.sessions) ? pkg.sessions : []
    const sessionsCompleted = sessions.filter((s) => s?.completedByReception === true).length
    const sessionsLinkedOpen = sessions.filter(
      (s) => s?.linkedLaserSessionId && s?.completedByReception !== true,
    ).length
    const sessionsAvailable = sessions.filter(
      (s) => !s?.linkedLaserSessionId && s?.completedByReception !== true,
    ).length
    const leftoverAreas = leftoverByPkgId.get(String(pkg._id)) || []
    const isOpen =
      sessionsAvailable > 0 ||
      sessionsLinkedOpen > 0 ||
      leftoverAreas.length > 0 ||
      (partialVisit != null && String(partialVisit.packageId) === String(pkg._id))
    if (!isOpen) continue

    const ids = Array.isArray(pkg.procedureOptionIds) ? pkg.procedureOptionIds.map(String) : []
    const areaLabels = ids
      .map((id) => optionMetaById.get(id)?.name || '')
      .map((n) => String(n || '').trim())
      .filter(Boolean)
    const areaCount = packageExpectedAreaCount(pkg)
    const sessionsCount = Math.max(1, Math.trunc(Number(pkg.sessionsCount) || sessions.length || 1))
    openPackages.push({
      id: String(pkg._id),
      title: String(pkg.title || '').trim() || 'باكج ليزر',
      notes: String(pkg.notes || '').trim(),
      sessionsCount,
      sessionsCompleted,
      sessionsAvailable,
      sessionsLinkedOpen,
      sessionsRemaining: Math.max(0, sessionsCount - sessionsCompleted),
      areaCount,
      areaLabels,
      remainingAreas: leftoverAreas,
      procedureOptionIds: ids,
      packageTotalSyp: Math.round(Number(pkg.packageTotalSyp) || 0),
      paidAmountSyp: Math.round(Number(pkg.paidAmountSyp) || 0),
      isPartial: Boolean(partialVisit) && String(partialVisit.packageId) === String(pkg._id),
      isFreshTarget: Boolean(fresh?.pkg) && String(fresh.pkg._id) === String(pkg._id),
      hasContinue: leftoverAreas.length > 0 || (Boolean(partialVisit) && String(partialVisit.packageId) === String(pkg._id)),
    })
  }

  const hasOpenPackage =
    hasFreshPackageSession ||
    partialVisit != null ||
    openPackages.some(
      (p) => p.sessionsAvailable > 0 || p.sessionsLinkedOpen > 0 || (p.remainingAreas || []).length > 0,
    ) ||
    laserPkgs.some((pkg) =>
      (pkg.sessions || []).some((s) => !s?.completedByReception && !s?.linkedLaserSessionId),
    )

  return { hasOpenPackage, partialVisit, hasFreshPackageSession, openPackages }
}
