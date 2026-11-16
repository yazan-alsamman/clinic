import { LaserSession } from '../models/LaserSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { Patient } from '../models/Patient.js'
import { buildPackageAreaBreakdown } from './laserPackageAreaBreakdown.js'
import { computePackageAreaLedger, packageHasRemainingAreaSessions } from './packageAreaLedger.js'

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

/**
 * باكج ليزر صالح لزيارة جديدة: غير موقوف وفيه رصيد لمنطقة واحدة على الأقل.
 * لم تعد الزيارة تحجز «جلسة» من الباكج — الإنقاص يكون لاحقاً لكل منطقة عولجت فعلاً.
 * (يبقى الاسم القديم للتوافق مع بقية الكود)
 */
export function findFreshLaserPackageSession(patientLike, packageId) {
  const packages = Array.isArray(patientLike?.sessionPackages) ? patientLike.sessionPackages : []
  for (const pkg of packages) {
    if (String(pkg?.department || '') !== 'laser') continue
    if (pkg.suspended === true) continue
    if (!packageIdMatches(pkg, packageId)) continue
    if (!packageHasRemainingAreaSessions(pkg)) continue
    return {
      pkg,
      session: null,
      mode: 'visit',
      expectedAreas: packageExpectedAreaCount(pkg),
    }
  }
  return null
}

/**
 * لم يعد هناك «استكمال» جلسة باكج ناقصة عبر زيارات: كل زيارة سجل مستقل بتاريخه،
 * وكل منطقة تُنقص من رصيدها الخاص. يبقى التصدير للتوافق ويعيد دائماً null.
 */
export async function findContinueLaserPackageSession() {
  return null
}

export function normalizeLaserSlotPackageModeForResolve(mode) {
  const m = String(mode || '').trim()
  /** «استكمال الباكج» القديم = زيارة باكج عادية (أرصدة المناطق مستقلة) */
  if (m === 'continue_package_with_addon' || m === 'continue_package') return 'use_package'
  if (m === 'use_package_with_addon') return 'use_package'
  return m
}

/** عند اختيار أكثر من باكج لزيارة واحدة: كل باكج يجب أن يكون فيه رصيد لمنطقة واحدة على الأقل */
export async function resolveLaserPackagesForBooking(patientLike, packageIds, slotPackageMode) {
  const ids = [...new Set((packageIds || []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 12)
  if (!ids.length) return { matches: [], primary: null, error: 'اختر باكجاً واحداً على الأقل.' }
  if (normalizeLaserSlotPackageModeForResolve(slotPackageMode) === 'outside_package') {
    return { matches: [], primary: null, error: null }
  }
  const matches = []
  for (const id of ids) {
    const match = findFreshLaserPackageSession(patientLike, id)
    if (!match) {
      const title = String(
        (patientLike?.sessionPackages || []).find((p) => String(p?._id || '') === id)?.title || 'الباكج',
      ).trim()
      return {
        matches: [],
        primary: null,
        error: `لا يمكن استخدام «${title}» في هذه الزيارة — لا يوجد رصيد متبقٍ لأي منطقة أو الباكج موقوف.`,
      }
    }
    matches.push(match)
  }
  return { matches, primary: matches[0], error: null }
}

export async function attachPackageSessionsToLaserSession({ patientId, matches, laserSessionId, billingItemId }) {
  const pid = String(patientId || '').trim()
  const lsId = laserSessionId || null
  if (!pid || !lsId) return
  for (const match of matches || []) {
    const pkgId = match?.pkg?._id
    const sessId = match?.session?._id
    if (!pkgId || !sessId) continue
    await Patient.updateOne(
      { _id: pid },
      {
        $set: {
          'sessionPackages.$[pkg].sessions.$[sess].linkedLaserSessionId': lsId,
          ...(billingItemId
            ? { 'sessionPackages.$[pkg].sessions.$[sess].linkedBillingItemId': billingItemId }
            : {}),
        },
      },
      { arrayFilters: [{ 'pkg._id': pkgId }, { 'sess._id': sessId }] },
    )
  }
}

export async function resolveLaserPackageSessionForBooking(patientLike, slotPackageMode, packageId) {
  const mode = normalizeLaserSlotPackageModeForResolve(slotPackageMode)
  if (mode === 'outside_package') return null
  return findFreshLaserPackageSession(patientLike, packageId)
}

/**
 * سياق الحجز للاستقبال: الباكجات الفعّالة مع رصيد كل منطقة.
 * لا تُعدَّل البيانات القديمة هنا (كان الكود القديم يعيد فتح جلسات مثبّتة — أُلغي حفاظاً على الأرصدة).
 */
export async function getLaserBookingContextForPatient(patientDoc) {
  const packages = Array.isArray(patientDoc?.sessionPackages) ? patientDoc.sessionPackages : []
  const laserPkgs = packages.filter((p) => String(p?.department || '') === 'laser' && p.suspended !== true)
  if (!laserPkgs.length) {
    return { hasOpenPackage: false, partialVisit: null, hasFreshPackageSession: false, openPackages: [] }
  }
  const optionIds = new Set()
  for (const pkg of laserPkgs) for (const id of pkg.procedureOptionIds || []) if (id) optionIds.add(String(id))
  const optionRows =
    optionIds.size > 0
      ? await LaserProcedureOption.find({ _id: { $in: [...optionIds] } }).select('name kind').lean()
      : []
  const optionMetaById = new Map(
    optionRows.map((r) => [String(r._id), { name: String(r.name || '').trim(), kind: String(r.kind || 'area').trim() }]),
  )

  const openPackages = []
  for (const pkg of laserPkgs) {
    const ledger = computePackageAreaLedger(pkg, { optionMetaById })
    if (!ledger.anyRemaining) continue
    const ids = Array.isArray(pkg.procedureOptionIds) ? pkg.procedureOptionIds.map(String) : []
    const sessionsCount = Math.max(1, Math.trunc(Number(pkg.sessionsCount) || 1))
    const maxRemaining = Math.max(0, ...ledger.areas.map((a) => a.remainingSessions))
    openPackages.push({
      id: String(pkg._id),
      title: ledger.title,
      notes: String(pkg.notes || '').trim(),
      sessionsCount,
      sessionsCompleted: ledger.legacyCompletedSessions,
      /** يمكن حجز زيارة ما دام في أي منطقة رصيد */
      sessionsAvailable: maxRemaining,
      sessionsLinkedOpen: 0,
      sessionsRemaining: maxRemaining,
      areaCount: ledger.areas.length,
      areaLabels: ledger.areas.map((a) => a.label),
      areaBalances: ledger.areas.map((a) => ({
        key: a.key,
        label: a.label,
        sessionsTotal: a.sessionsTotal,
        usedSessions: a.usedSessions,
        remainingSessions: a.remainingSessions,
      })),
      remainingAreas: [],
      procedureOptionIds: ids,
      packageTotalSyp: Math.round(Number(pkg.packageTotalSyp) || 0),
      paidAmountSyp: Math.round(Number(pkg.paidAmountSyp) || 0),
      isPartial: false,
      isFreshTarget: openPackages.length === 0,
      hasContinue: false,
    })
  }
  return {
    hasOpenPackage: openPackages.length > 0,
    partialVisit: null,
    hasFreshPackageSession: openPackages.length > 0,
    openPackages,
  }
}
