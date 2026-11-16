/**
 * إنقاص جلسات مناطق باكج الليزر (قراءة/كتابة قاعدة البيانات).
 * المنطق الحسابي في packageAreaLedger.js.
 */
import mongoose from 'mongoose'
import { Patient } from '../models/Patient.js'
import { LaserSession } from '../models/LaserSession.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import {
  AreaDeductionError,
  allocateVisitTreatedAreas,
  areaKeysAlreadyDeductedForVisit,
  computePackageAreaLedger,
  derivePackageAreaDefinitions,
  groupPackageVisits,
  planPackageAreaDeduction,
} from './packageAreaLedger.js'

const MAX_WRITE_ATTEMPTS = 3

function laserPackages(patient) {
  return (Array.isArray(patient?.sessionPackages) ? patient.sessionPackages : []).filter(
    (p) => String(p?.department || 'laser') === 'laser',
  )
}

export async function loadLaserOptionMeta(packages, extraLineItems = []) {
  const ids = new Set()
  for (const pkg of packages || []) {
    for (const id of pkg?.procedureOptionIds || []) if (id) ids.add(String(id))
  }
  for (const li of extraLineItems || []) if (li?.procedureOptionId) ids.add(String(li.procedureOptionId))
  const valid = [...ids].filter((id) => mongoose.isValidObjectId(id))
  const rows = valid.length
    ? await LaserProcedureOption.find({ _id: { $in: valid } }).select('name kind').lean()
    : []
  return new Map(rows.map((r) => [String(r._id), { name: String(r.name || '').trim(), kind: String(r.kind || 'area') }]))
}

function amountDue(bi) {
  return Math.max(0, Math.round(Number(bi?.effectiveAmountDueSyp ?? bi?.amountDueSyp) || 0))
}

/** سطور خارج الباكج في الزيارة + بنود تحصيلها المستقلة */
async function visitAddonServices(laserSession) {
  const addonLines = (Array.isArray(laserSession?.lineItems) ? laserSession.lineItems : [])
    .filter((r) => r?.isAddon === true)
    .map((r) => ({ label: String(r.areaLabel || '').trim() || 'منطقة', priceSyp: Math.round(Number(r.lineCostSyp) || 0) }))
  const addonCs = await ClinicalSession.find({ packageAddonForLaserSessionId: laserSession._id })
    .select('_id billingItemId')
    .lean()
  const billIds = addonCs.map((c) => c.billingItemId).filter(Boolean)
  const bills = billIds.length
    ? await BillingItem.find({ _id: { $in: billIds } }).select('_id status amountDueSyp effectiveAmountDueSyp procedureLabel paidAt').lean()
    : []
  return {
    lines: addonLines,
    bills: bills.map((b) => ({
      billingItemId: String(b._id),
      label: String(b.procedureLabel || ''),
      amountDueSyp: amountDue(b),
      status: String(b.status || ''),
      paidAt: b.paidAt ? new Date(b.paidAt).toISOString() : null,
    })),
  }
}

function visitPackageCandidates(patient, laserSession) {
  const pkgs = laserPackages(patient).filter((p) => p.suspended !== true)
  const primary = String(laserSession?.patientPackageId || '')
  /** الباكج المرتبط بالزيارة أولاً، ثم بقية باكجات الليزر الفعّالة بترتيب الشراء */
  return [...pkgs].sort((a, b) => (String(a._id) === primary ? -1 : String(b._id) === primary ? 1 : 0))
}

/** توزيع مناطق الزيارة على الباكجات (نفس المنطق في المعاينة والتنفيذ) */
function visitAllocation(patient, laserSession, optionMetaById) {
  const ordered = visitPackageCandidates(patient, laserSession).map((pkg) => {
    const ledger = computePackageAreaLedger(pkg, { optionMetaById })
    return { pkg, ledger, alreadyDeducted: areaKeysAlreadyDeductedForVisit(pkg, ledger, laserSession?._id) }
  })
  const alloc = allocateVisitTreatedAreas(ordered, laserSession?.lineItems, optionMetaById)
  return { ordered, alloc }
}

/**
 * معاينة الإنقاص لزيارة ليزر: لكل باكج المناطق ورصيدها، وما عولج في الزيارة (مُحدَّد مسبقاً)،
 * وما أُنقص سابقاً لنفس الزيارة. الإضافات خارج الباكج تُعرض منفصلة ولا تدخل في الإنقاص.
 */
export function buildVisitDeductionPreviewFromData({ patient, laserSession, optionMetaById }) {
  const { ordered, alloc } = visitAllocation(patient, laserSession, optionMetaById)
  const packages = []
  for (const { pkg, ledger, alreadyDeducted } of ordered) {
    const treated = alloc.byPackageId.get(String(pkg._id)) || new Set()
    if (!treated.size && !alreadyDeducted.size && String(pkg._id) !== String(laserSession?.patientPackageId || '')) continue
    packages.push({
      packageId: String(pkg._id),
      title: ledger.title,
      areas: ledger.areas.map((a) => ({
        key: a.key,
        label: a.label,
        sessionsTotal: a.sessionsTotal,
        usedSessions: a.usedSessions,
        remainingSessions: a.remainingSessions,
        treatedInVisit: treated.has(a.key),
        alreadyDeductedForVisit: alreadyDeducted.has(a.key),
      })),
    })
  }
  const pendingAreaCount = packages.reduce(
    (n, p) => n + p.areas.filter((a) => a.treatedInVisit && !a.alreadyDeductedForVisit).length,
    0,
  )
  const lines = Array.isArray(laserSession?.lineItems) ? laserSession.lineItems : []
  return {
    laserSessionId: String(laserSession?._id || ''),
    packages,
    pendingAreaCount,
    allDeducted: packages.length > 0 && pendingAreaCount === 0,
    /** سطور مسجّلة كمنطقة باكج لكن لا رصيد لها — يجب تحويلها لخارج الباكج */
    uncoveredAreaLabels: alloc.uncoveredLineIndexes.map((i) => String(lines[i]?.areaLabel || '').trim()).filter(Boolean),
  }
}

export async function buildVisitDeductionPreview(patientId, laserSessionId) {
  const [patient, ls] = await Promise.all([
    Patient.findById(patientId).select('sessionPackages').lean(),
    LaserSession.findById(laserSessionId).lean(),
  ])
  if (!patient) throw new AreaDeductionError('المريض غير موجود', 404)
  if (!ls || String(ls.patientId) !== String(patient._id)) throw new AreaDeductionError('جلسة الليزر غير موجودة لهذا المريض', 404)
  const optionMetaById = await loadLaserOptionMeta(laserPackages(patient), ls.lineItems)
  const preview = buildVisitDeductionPreviewFromData({ patient, laserSession: ls, optionMetaById })
  const addons = await visitAddonServices(ls)
  return { ...preview, addonServices: addons }
}

/**
 * يطبّق إنقاص المناطق المختارة دفعة واحدة على مستند المريض، مع قفل تفاؤلي (laserAreaLedgerRev)
 * حتى لا ينتج طلبان متزامنان إنقاصاً مزدوجاً أو رصيداً سالباً.
 *
 * @param {{ patientId, laserSessionId?, selections: {packageId: string, areaKeys: string[]}[], requestId?, note?, user }} input
 */
export async function applyLaserAreaDeductions({ patientId, laserSessionId = null, selections, requestId = '', note = '', user }) {
  const source = laserSessionId ? 'laser_visit' : 'manual'
  const sel = (Array.isArray(selections) ? selections : [])
    .map((s) => ({ packageId: String(s?.packageId || '').trim(), areaKeys: Array.isArray(s?.areaKeys) ? s.areaKeys : [] }))
    .filter((s) => s.packageId && s.areaKeys.length)
  if (!sel.length) throw new AreaDeductionError('اختر منطقة واحدة على الأقل للإنقاص.')
  if (new Set(sel.map((s) => s.packageId)).size !== sel.length) throw new AreaDeductionError('باكج مكرر في الطلب.')
  const reqId = String(requestId || '').trim()
  if (source === 'manual' && !reqId) throw new AreaDeductionError('معرّف الطلب مطلوب للإنقاص اليدوي.')
  if (source === 'manual' && !String(note || '').trim()) throw new AreaDeductionError('اكتب سبب الإنقاص اليدوي (مثلاً: زيارة قديمة لم تُسجّل).')

  let ls = null
  let packageBill = null
  if (laserSessionId) {
    ls = await LaserSession.findById(laserSessionId).lean()
    if (!ls || String(ls.patientId) !== String(patientId)) throw new AreaDeductionError('جلسة الليزر غير موجودة لهذا المريض', 404)
    if (ls.billingItemId) packageBill = await BillingItem.findById(ls.billingItemId).lean()
  }
  const visitDate = String(packageBill?.businessDate || '') || (ls?.createdAt ? new Date(ls.createdAt).toISOString().slice(0, 10) : '')

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const patient = await Patient.findById(patientId).select('sessionPackages laserAreaLedgerRev').lean()
    if (!patient) throw new AreaDeductionError('المريض غير موجود', 404)
    const rev = Math.trunc(Number(patient.laserAreaLedgerRev) || 0)
    const pkgs = laserPackages(patient)
    const optionMetaById = await loadLaserOptionMeta(pkgs, ls?.lineItems)
    const now = new Date()
    const plans = []
    for (const s of sel) {
      const pkg = pkgs.find((p) => String(p._id) === s.packageId)
      if (!pkg) throw new AreaDeductionError('الباكج غير موجود', 404)
      if (ls) {
        /** الإنقاص من زيارة يتبع ما سُجّل فعلاً في الجلسة — لا منطقة لم تُعالَج، ولا منطقة احتُسبت لباكج آخر */
        const allowed = visitAllocation(patient, ls, optionMetaById).alloc.byPackageId.get(String(pkg._id)) || new Set()
        const defs = derivePackageAreaDefinitions(pkg, optionMetaById)
        const exhausted = new Set(
          computePackageAreaLedger(pkg, { optionMetaById }).areas.filter((a) => a.remainingSessions < 1).map((a) => a.key),
        )
        const known = new Set(defs.map((d) => d.key))
        /** منطقة ليست من الباكج أو بلا رصيد: يُترك الرفض لرسالة planPackageAreaDeduction الأوضح */
        const notTreated = s.areaKeys.filter((k) => known.has(String(k)) && !allowed.has(String(k)) && !exhausted.has(String(k)))
        if (notTreated.length) {
          const labels = notTreated.map((k) => defs.find((d) => d.key === String(k))?.label || k)
          throw new AreaDeductionError(
            `هذه المنطقة غير مسجّلة لهذا الباكج في جلسة الليزر لهذه الزيارة: ${labels.join('، ')}. عدّل الجلسة أولاً أو استخدم الإنقاص اليدوي من ملف المريض.`,
          )
        }
      }
      const plan = planPackageAreaDeduction({
        pkg,
        areaKeys: s.areaKeys,
        laserSessionId: ls?._id || null,
        billingItemId: packageBill?._id || null,
        requestId: reqId,
        visitDate,
        note,
        source,
        user,
        now,
        optionMetaById,
      })
      plans.push({ pkg, plan, defs: derivePackageAreaDefinitions(pkg, optionMetaById) })
    }
    if (plans.every((p) => p.plan.duplicateRequest)) {
      return { duplicateRequest: true, deducted: [] }
    }
    if (plans.some((p) => p.plan.duplicateRequest)) throw new AreaDeductionError('تم تنفيذ جزء من هذا الطلب مسبقاً — حدّث الصفحة.', 409)

    const update = { $inc: { laserAreaLedgerRev: 1 }, $push: {}, $set: {} }
    const arrayFilters = []
    plans.forEach(({ pkg, plan, defs }, i) => {
      const f = `p${i}`
      arrayFilters.push({ [`${f}._id`]: pkg._id })
      update.$push[`sessionPackages.$[${f}].areaDeductions`] = { $each: plan.rows }
      /** أول إنقاص بالمناطق: تُحفظ نسخة المناطق كي يبقى المفتاح والاسم ثابتين */
      if (!(Array.isArray(pkg.areaSessions) && pkg.areaSessions.length)) {
        update.$set[`sessionPackages.$[${f}].areaSessions`] = defs
      }
    })
    if (!Object.keys(update.$set).length) delete update.$set
    const revFilter = rev === 0 ? { $in: [0, null] } : rev
    const r = await Patient.updateOne({ _id: patient._id, laserAreaLedgerRev: revFilter }, update, { arrayFilters })
    if (!r || (r.modifiedCount ?? r.nModified ?? 0) === 0) continue

    const deducted = plans.flatMap(({ pkg, plan }) =>
      plan.rows.map((row) => ({ packageId: String(pkg._id), areaKey: row.areaKey, areaLabel: row.areaLabel })),
    )
    if (ls) {
      /** بند الباكج (صفر) يُغلق؛ إن بقي عليه مبلغ قديم يبقى للتحصيل العادي — لا يُعتبر مدفوعاً */
      if (packageBill && packageBill.isPackagePrepaid === true && packageBill.status === 'pending_payment' && amountDue(packageBill) <= 0) {
        await BillingItem.updateOne({ _id: packageBill._id, status: 'pending_payment' }, { $set: { status: 'paid', paidAt: new Date() } })
      }
      if (ls.status !== 'completed') await LaserSession.updateOne({ _id: ls._id }, { $set: { status: 'completed' } })
    }
    return { duplicateRequest: false, deducted, visitDate }
  }
  throw new AreaDeductionError('تغيّر رصيد الباكج أثناء الحفظ — حدّث الصفحة وأعد المحاولة.', 409)
}

/** عكس إنقاص (تصحيح) — يبقى السطر في السجل مع السبب */
export async function reverseLaserAreaDeduction({ patientId, packageId, deductionId, reason, user }) {
  const why = String(reason || '').trim()
  if (!why) throw new AreaDeductionError('سبب التصحيح مطلوب.')
  const r = await Patient.updateOne(
    { _id: patientId },
    {
      $inc: { laserAreaLedgerRev: 1 },
      $set: {
        'sessionPackages.$[pkg].areaDeductions.$[d].reversedAt': new Date(),
        'sessionPackages.$[pkg].areaDeductions.$[d].reversedByUserId': user?._id || null,
        'sessionPackages.$[pkg].areaDeductions.$[d].reverseReason': why.slice(0, 500),
      },
    },
    { arrayFilters: [{ 'pkg._id': new mongoose.Types.ObjectId(packageId) }, { 'd._id': new mongoose.Types.ObjectId(deductionId), 'd.reversedAt': null }] },
  )
  if (!r || (r.modifiedCount ?? 0) === 0) throw new AreaDeductionError('الإنقاص غير موجود أو مُصحَّح مسبقاً.', 404)
}

/** عند حذف جلسة ليزر: تُعكس إنقاصات المناطق المرتبطة بها (تبقى في السجل) */
export async function reverseAreaDeductionsForLaserSessions(patientId, laserSessionIds, reason = 'حذف جلسة الليزر') {
  const ids = (laserSessionIds || []).map(String).filter((id) => mongoose.isValidObjectId(id))
  if (!patientId || !ids.length) return
  await Patient.updateOne(
    { _id: patientId },
    {
      $inc: { laserAreaLedgerRev: 1 },
      $set: {
        'sessionPackages.$[].areaDeductions.$[d].reversedAt': new Date(),
        'sessionPackages.$[].areaDeductions.$[d].reverseReason': reason,
      },
    },
    { arrayFilters: [{ 'd.laserSessionId': { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) }, 'd.reversedAt': null }] },
  )
}

/** نظرة المريض: رصيد كل منطقة وسجل الزيارات، والخدمات خارج الباكج بأسعارها وحالة دفعها */
export async function buildPatientLaserPackageLedger(patientId) {
  const patient = await Patient.findById(patientId).select('sessionPackages').lean()
  if (!patient) throw new AreaDeductionError('المريض غير موجود', 404)
  const pkgs = laserPackages(patient)
  const lsIds = new Set()
  for (const pkg of pkgs) {
    for (const s of pkg.sessions || []) if (s?.completedByReception && s.linkedLaserSessionId) lsIds.add(String(s.linkedLaserSessionId))
    for (const d of pkg.areaDeductions || []) if (d?.laserSessionId) lsIds.add(String(d.laserSessionId))
  }
  const sessions = lsIds.size
    ? await LaserSession.find({ _id: { $in: [...lsIds] } }).select('_id lineItems createdAt treatmentNumber').lean()
    : []
  const laserSessionsById = new Map(sessions.map((s) => [String(s._id), s]))
  const optionMetaById = await loadLaserOptionMeta(pkgs, sessions.flatMap((s) => s.lineItems || []))
  const packages = pkgs.map((pkg) => {
    const ledger = computePackageAreaLedger(pkg, { optionMetaById, laserSessionsById })
    const visits = groupPackageVisits(ledger).map((v) => ({
      ...v,
      treatmentNumber: v.laserSessionId ? laserSessionsById.get(v.laserSessionId)?.treatmentNumber ?? null : null,
    }))
    return { ...ledger, visits }
  })

  /** خدمات خارج الباكج: بنود الإضافات المستقلة لكل زيارة باكج */
  const addonCs = await ClinicalSession.find({ patientId: patient._id, packageAddonForLaserSessionId: { $ne: null } })
    .select('_id billingItemId businessDate procedureDescription packageAddonForLaserSessionId sessionFeeSyp')
    .sort({ businessDate: -1 })
    .lean()
  const billIds = addonCs.map((c) => c.billingItemId).filter(Boolean)
  const bills = billIds.length
    ? await BillingItem.find({ _id: { $in: billIds } }).select('_id status amountDueSyp effectiveAmountDueSyp paidAt').lean()
    : []
  const billById = new Map(bills.map((b) => [String(b._id), b]))
  const addonServices = addonCs.map((c) => {
    const b = c.billingItemId ? billById.get(String(c.billingItemId)) : null
    return {
      id: String(c._id),
      laserSessionId: String(c.packageAddonForLaserSessionId),
      businessDate: String(c.businessDate || ''),
      label: String(c.procedureDescription || ''),
      priceSyp: b ? amountDue(b) : Math.round(Number(c.sessionFeeSyp) || 0),
      status: b ? String(b.status || '') : 'no_bill',
      paidAt: b?.paidAt ? new Date(b.paidAt).toISOString() : null,
    }
  })
  return { packages, addonServices }
}

export { AreaDeductionError }
