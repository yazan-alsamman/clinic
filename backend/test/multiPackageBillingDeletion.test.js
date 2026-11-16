/**
 * عدة باكجات منفصلة في زيارة واحدة، فصل الخدمات الإضافية في التحصيل، وحذف بنود التحصيل بأمان.
 * تشغيل: npm test — بلا قاعدة بيانات (النماذج تُستبدل ببيانات في الذاكرة).
 */
import { test, describe, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { Patient } from '../src/models/Patient.js'
import { LaserSession } from '../src/models/LaserSession.js'
import { LaserProcedureOption } from '../src/models/LaserProcedureOption.js'
import { BillingItem } from '../src/models/BillingItem.js'
import { ClinicalSession } from '../src/models/ClinicalSession.js'
import { AuditLog } from '../src/models/AuditLog.js'
import { computePackageAreaLedger, derivePackageAreaDefinitions } from '../src/services/packageAreaLedger.js'
import { applyLaserAreaDeductions, buildVisitDeductionPreviewFromData } from '../src/services/laserAreaDeductions.js'
import { findAdditionalVisitPackages } from '../src/services/laserPackageBooking.js'
import { buildLaserVisitBillingBreakdown } from '../src/services/laserVisitBillingBreakdown.js'
import {
  BillingCancelError,
  cancelPendingBillingItem,
  cancelPendingBillingItems,
  describeBillingItemCancellability,
} from '../src/services/billingItemCancel.js'
import { isManuallyCancelledBillingItem } from '../src/services/dentalChartBilling.js'

mongoose.set('bufferCommands', false)

const oid = () => new mongoose.Types.ObjectId()
const ARMS = String(oid())
const LEGS = String(oid())
const UNDERARMS = String(oid())
const OPTIONS = [
  { _id: ARMS, name: 'يدين', kind: 'area' },
  { _id: LEGS, name: 'رجلين', kind: 'area' },
  { _id: UNDERARMS, name: 'إبطين', kind: 'area' },
]
const META = new Map(OPTIONS.map((o) => [String(o._id), { name: o.name, kind: o.kind }]))
const RECEPTION = { _id: oid(), name: 'الاستقبال', role: 'reception' }
const ADMIN = { _id: oid(), name: 'د. الياس', role: 'super_admin' }

const line = (procedureOptionId, areaLabel) => ({ procedureOptionId, areaLabel, isAddon: false })
const addon = (procedureOptionId, areaLabel, lineCostSyp) => ({ procedureOptionId, areaLabel, isAddon: true, lineCostSyp })

function laserPackage(title, optionIds, sessions = 5, extra = {}) {
  return {
    _id: oid(),
    department: 'laser',
    title,
    procedureOptionIds: optionIds,
    sessionsCount: sessions,
    packageTotalSyp: 500_000,
    paidAmountSyp: 500_000,
    sessions: Array.from({ length: sessions }, (_, i) => ({ _id: oid(), label: `الجلسة ${i + 1}`, completedByReception: false })),
    areaSessions: [],
    areaDeductions: [],
    ...extra,
  }
}

function remaining(pkg) {
  return Object.fromEntries(computePackageAreaLedger(pkg, { optionMetaById: META }).areas.map((a) => [a.label, a.remainingSessions]))
}

function areaKey(pkg, label) {
  return derivePackageAreaDefinitions(pkg, META).find((d) => d.label === label).key
}

/* ---------- قاعدة بيانات وهمية في الذاكرة ---------- */

function clone(v) {
  if (v instanceof mongoose.Types.ObjectId) return v
  if (v instanceof Date) return new Date(v)
  if (Array.isArray(v)) return v.map(clone)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
  return v
}

function fakeQuery(getData) {
  const q = {
    select: () => q,
    sort: () => q,
    lean: () => Promise.resolve(clone(getData())),
    then: (res, rej) => Promise.resolve(clone(getData())).then(res, rej),
  }
  return q
}

let db
function installDb(patient) {
  db = { patient, laserSessions: [], bills: [] }
  mock.method(Patient, 'findById', () => fakeQuery(() => db.patient))
  mock.method(Patient, 'updateOne', async (filter, update, opts = {}) => {
    const rev = Math.trunc(Number(db.patient.laserAreaLedgerRev) || 0)
    const want = filter.laserAreaLedgerRev
    if (want !== undefined) {
      const ok = typeof want === 'object' ? want.$in.includes(db.patient.laserAreaLedgerRev ?? null) || (rev === 0 && want.$in.includes(0)) : want === rev
      if (!ok) return { modifiedCount: 0 }
    }
    const filters = opts.arrayFilters || []
    const pkgFor = (name) => {
      const f = filters.find((x) => Object.keys(x)[0] === `${name}._id`)
      return db.patient.sessionPackages.find((p) => String(p._id) === String(Object.values(f)[0]))
    }
    for (const [path, v] of Object.entries(update.$push || {})) {
      const pkg = pkgFor(path.match(/\$\[(\w+)\]/)[1])
      for (const row of v.$each) pkg.areaDeductions.push({ _id: oid(), ...row })
    }
    for (const [path, v] of Object.entries(update.$set || {})) {
      const m = path.match(/^sessionPackages\.\$\[(\w+)\]\.areaSessions$/)
      if (m) pkgFor(m[1]).areaSessions = v
    }
    if (update.$inc?.laserAreaLedgerRev) db.patient.laserAreaLedgerRev = rev + 1
    return { modifiedCount: 1 }
  })
  mock.method(LaserSession, 'findById', (id) => fakeQuery(() => db.laserSessions.find((s) => String(s._id) === String(id)) || null))
  mock.method(LaserSession, 'updateOne', async () => ({ modifiedCount: 1 }))
  mock.method(BillingItem, 'findById', (id) => fakeQuery(() => db.bills.find((b) => String(b._id) === String(id)) || null))
  mock.method(BillingItem, 'updateOne', async (f, u) => {
    const b = db.bills.find((x) => String(x._id) === String(f._id))
    if (b && u.$set?.status) b.status = u.$set.status
    return { modifiedCount: 1 }
  })
  mock.method(BillingItem, 'create', async () => {
    throw new Error('لا يجب إنشاء أي بند تحصيل عند إنقاص المناطق')
  })
  mock.method(LaserProcedureOption, 'find', () => fakeQuery(() => OPTIONS))
  mock.method(ClinicalSession, 'find', () => fakeQuery(() => []))
}

/** مريض لديه باكج يدين (5) وباكج رجلين (5) منفصلان */
function twoPackages() {
  const arms = laserPackage('باكج يدين', [ARMS])
  const legs = laserPackage('باكج رجلين', [LEGS])
  const patient = { _id: oid(), sessionPackages: [arms, legs], laserAreaLedgerRev: 0 }
  installDb(patient)
  return { patient, arms: () => db.patient.sessionPackages[0], legs: () => db.patient.sessionPackages[1] }
}

function visit(patient, primaryPkg, lineItems) {
  const bill = {
    _id: oid(),
    patientId: patient._id,
    department: 'laser',
    isPackagePrepaid: true,
    status: 'pending_payment',
    amountDueSyp: 0,
    effectiveAmountDueSyp: 0,
    businessDate: '2026-11-16',
    patientPackageId: String(primaryPkg._id),
  }
  const ls = {
    _id: oid(),
    patientId: patient._id,
    patientPackageId: String(primaryPkg._id),
    billingItemId: bill._id,
    lineItems,
    status: 'completed_pending_collection',
    createdAt: new Date('2026-11-16T10:00:00Z'),
  }
  db.bills.push(bill)
  db.laserSessions.push(ls)
  return { ls, bill }
}

function deduct(patient, ls, picks, requestId = String(oid())) {
  return applyLaserAreaDeductions({
    patientId: patient._id,
    laserSessionId: ls._id,
    selections: picks.map(([pkg, labels]) => ({ packageId: String(pkg._id), areaKeys: labels.map((l) => areaKey(pkg, l)) })),
    requestId,
    user: RECEPTION,
  })
}

afterEach(() => mock.restoreAll())

/* ---------- استهلاك عدة باكجات ---------- */

describe('عدة باكجات منفصلة في نفس الزيارة', () => {
  test('1) يدين ورجلين معاً من باكجين: جلسة من كل باكج (4 و 4)', async () => {
    const { patient, arms, legs } = twoPackages()
    const { ls } = visit(patient, arms(), [line(ARMS, 'يدين'), line(LEGS, 'رجلين')])
    const preview = buildVisitDeductionPreviewFromData({ patient: db.patient, laserSession: ls, optionMetaById: META })
    assert.deepEqual(
      preview.packages.map((p) => [p.title, p.areas.filter((a) => a.treatedInVisit).map((a) => a.label)]),
      [
        ['باكج يدين', ['يدين']],
        ['باكج رجلين', ['رجلين']],
      ],
      'المعاينة تعرض الباكجين قبل التأكيد',
    )
    await deduct(patient, ls, [
      [arms(), ['يدين']],
      [legs(), ['رجلين']],
    ])
    assert.deepEqual(remaining(arms()), { يدين: 4 })
    assert.deepEqual(remaining(legs()), { رجلين: 4 })
  })

  test('2) يدين فقط: باكج الرجلين لا يُمس', async () => {
    const { patient, arms, legs } = twoPackages()
    const { ls } = visit(patient, arms(), [line(ARMS, 'يدين')])
    await deduct(patient, ls, [[arms(), ['يدين']]])
    assert.deepEqual(remaining(arms()), { يدين: 4 })
    assert.deepEqual(remaining(legs()), { رجلين: 5 })
  })

  test('3) رجلين فقط (رغم أن الحجز على باكج اليدين): يُنقص باكج الرجلين وحده', async () => {
    const { patient, arms, legs } = twoPackages()
    const { ls } = visit(patient, arms(), [line(LEGS, 'رجلين')])
    const preview = buildVisitDeductionPreviewFromData({ patient: db.patient, laserSession: ls, optionMetaById: META })
    const legsPreview = preview.packages.find((p) => p.title === 'باكج رجلين')
    assert.ok(legsPreview.areas.find((a) => a.label === 'رجلين').treatedInVisit)
    await deduct(patient, ls, [[legs(), ['رجلين']]])
    assert.deepEqual(remaining(arms()), { يدين: 5 })
    assert.deepEqual(remaining(legs()), { رجلين: 4 })
  })

  test('الحجز على باكج واحد: منطقة من باكج آخر للمريض تُضاف لزيارته ولا تُحسب خدمة مدفوعة', () => {
    const { arms } = twoPackages()
    const extra = findAdditionalVisitPackages({
      patient: db.patient,
      matchedPackageIds: [String(arms()._id)],
      lineItems: [line(ARMS, 'يدين'), line(LEGS, 'رجلين')],
      optionMetaById: META,
    })
    assert.deepEqual(
      extra.map((m) => m.pkg.title),
      ['باكج رجلين'],
    )
  })

  test('الإضافة الصريحة خارج الباكج (إبطين) لا تجلب أي باكج', () => {
    const { arms } = twoPackages()
    const extra = findAdditionalVisitPackages({
      patient: db.patient,
      matchedPackageIds: [String(arms()._id)],
      lineItems: [line(ARMS, 'يدين'), addon(UNDERARMS, 'إبطين', 150_000), addon(LEGS, 'رجلين', 200_000)],
      optionMetaById: META,
    })
    assert.equal(extra.length, 0, 'اختيار «خارج الباكج» الصريح يبقى خدمة مدفوعة')
  })

  test('باكج موقوف أو منتهي الرصيد لا يُضاف للزيارة', () => {
    const { arms, legs } = twoPackages()
    legs().suspended = true
    let extra = findAdditionalVisitPackages({
      patient: db.patient,
      matchedPackageIds: [String(arms()._id)],
      lineItems: [line(LEGS, 'رجلين')],
      optionMetaById: META,
    })
    assert.equal(extra.length, 0)
    legs().suspended = false
    legs().areaSessions = [{ key: areaKey(legs(), 'رجلين'), procedureOptionId: LEGS, label: 'رجلين', sessionsTotal: 1 }]
    legs().areaDeductions = [
      { _id: oid(), areaKey: areaKey(legs(), 'رجلين'), areaLabel: 'رجلين', source: 'manual', deductedAt: new Date(), requestId: 'old' },
    ]
    extra = findAdditionalVisitPackages({
      patient: db.patient,
      matchedPackageIds: [String(arms()._id)],
      lineItems: [line(LEGS, 'رجلين')],
      optionMetaById: META,
    })
    assert.equal(extra.length, 0)
  })

  test('6) إعادة نفس طلب الإنقاص لباكجين لا تُنقص مرتين', async () => {
    const { patient, arms, legs } = twoPackages()
    const { ls } = visit(patient, arms(), [line(ARMS, 'يدين'), line(LEGS, 'رجلين')])
    const picks = () => [
      [arms(), ['يدين']],
      [legs(), ['رجلين']],
    ]
    await deduct(patient, ls, picks(), 'same-request')
    await deduct(patient, ls, picks(), 'same-request')
    assert.deepEqual(remaining(arms()), { يدين: 4 })
    assert.deepEqual(remaining(legs()), { رجلين: 4 })
    await assert.rejects(() => deduct(patient, ls, picks(), 'another-request'), (e) => e.status === 409)
  })

  test('7) لا رصيد سالب: باكج رجلين بجلسة واحدة لا يُنقص مرتين', async () => {
    const { patient, arms, legs } = twoPackages()
    legs().areaSessions = [{ key: areaKey(legs(), 'رجلين'), procedureOptionId: LEGS, label: 'رجلين', sessionsTotal: 1 }]
    const v1 = visit(patient, arms(), [line(LEGS, 'رجلين')])
    await deduct(patient, v1.ls, [[legs(), ['رجلين']]])
    const v2 = visit(patient, arms(), [line(LEGS, 'رجلين')])
    await assert.rejects(() => deduct(patient, v2.ls, [[legs(), ['رجلين']]]), /رصيد/)
    assert.deepEqual(remaining(legs()), { رجلين: 0 })
  })
})

/* ---------- الخدمات الإضافية وشاشة التحصيل ---------- */

describe('فصل الخدمات الإضافية في شاشة التحصيل', () => {
  function breakdownFor(lineItems, addonBills = []) {
    const { patient, arms } = twoPackages()
    const { ls } = visit(patient, arms(), lineItems)
    const preview = buildVisitDeductionPreviewFromData({ patient: db.patient, laserSession: ls, optionMetaById: META })
    return buildLaserVisitBillingBreakdown({ preview, laserSession: ls, addonBills })
  }

  test('يدين + رجلين من الباكجات + إبطين إضافية: قسمان منفصلان ومجموع فرعي', () => {
    const addonBill = { _id: oid(), status: 'pending_payment', amountDueSyp: 150_000, effectiveAmountDueSyp: 150_000 }
    const b = breakdownFor([line(ARMS, 'يدين'), line(LEGS, 'رجلين'), addon(UNDERARMS, 'إبطين', 150_000)], [addonBill])
    assert.deepEqual(
      b.packageCovered.map((r) => [r.label, r.packageTitle, r.deductionStatus, r.remainingAfter, r.additionalChargeSyp]),
      [
        ['يدين', 'باكج يدين', 'pending', 4, 0],
        ['رجلين', 'باكج رجلين', 'pending', 4, 0],
      ],
    )
    assert.deepEqual(b.addonServices, [{ label: 'إبطين', originalPriceSyp: 150_000 }])
    assert.equal(b.addonSubtotalSyp, 150_000)
    assert.equal(b.addonAmountDueSyp, 150_000)
    assert.equal(b.addonPendingSyp, 150_000)
    assert.equal(b.packageChargeSyp, 0)
    assert.ok(!b.packageCovered.some((r) => r.label === 'إبطين'), 'الخدمة الإضافية لا تظهر كمنطقة باكج')
  })

  test('الخدمة الإضافية لا تُنقص أي جلسة ولا تغيّر سعر الباكج', () => {
    const { patient, arms, legs } = twoPackages()
    const { ls } = visit(patient, arms(), [addon(UNDERARMS, 'إبطين', 150_000)])
    const preview = buildVisitDeductionPreviewFromData({ patient: db.patient, laserSession: ls, optionMetaById: META })
    assert.equal(preview.pendingAreaCount, 0)
    const b = buildLaserVisitBillingBreakdown({ preview, laserSession: ls })
    assert.equal(b.packageCovered.length, 0)
    assert.deepEqual(remaining(arms()), { يدين: 5 })
    assert.deepEqual(remaining(legs()), { رجلين: 5 })
    assert.equal(arms().packageTotalSyp, 500_000)
  })

  test('بعد الخصم أو الكفر: المطلوب دفعه يختلف عن السعر الأصلي، والبند الملغى لا يُحتسب', () => {
    const paid = { _id: oid(), status: 'paid', amountDueSyp: 120_000, effectiveAmountDueSyp: 120_000 }
    const cancelled = { _id: oid(), status: 'cancelled', amountDueSyp: 150_000, effectiveAmountDueSyp: 150_000 }
    const b = breakdownFor([line(ARMS, 'يدين'), addon(UNDERARMS, 'إبطين', 150_000)], [paid, cancelled])
    assert.equal(b.addonSubtotalSyp, 150_000)
    assert.equal(b.addonAmountDueSyp, 120_000)
    assert.equal(b.addonPaidSyp, 120_000)
    assert.equal(b.addonPendingSyp, 0)
    assert.equal(b.addonBills.length, 1)
  })

  test('بعد الإنقاص: تظهر المنطقة «أُنقصت» برصيدها الجديد ولا تُعرض للإنقاص مرة أخرى', async () => {
    const { patient, arms } = twoPackages()
    const { ls } = visit(patient, arms(), [line(ARMS, 'يدين')])
    await deduct(patient, ls, [[arms(), ['يدين']]])
    const preview = buildVisitDeductionPreviewFromData({ patient: db.patient, laserSession: ls, optionMetaById: META })
    const b = buildLaserVisitBillingBreakdown({ preview, laserSession: ls })
    assert.deepEqual(
      b.packageCovered.map((r) => [r.label, r.deductionStatus, r.remainingAfter]),
      [['يدين', 'deducted', 4]],
    )
  })
})

/* ---------- حذف بنود التحصيل ---------- */

function bill(extra = {}) {
  return {
    _id: oid(),
    patientId: oid(),
    department: 'dental',
    procedureLabel: 'تنظيف',
    amountDueSyp: 100_000,
    businessDate: '2026-11-16',
    status: 'pending_payment',
    paymentId: null,
    paidAt: null,
    ...extra,
  }
}

function installBillingDb(bills, { patient = null, raceStatus = null } = {}) {
  const store = { bills, audits: [], updates: [] }
  mock.method(BillingItem, 'findById', (id) => fakeQuery(() => store.bills.find((b) => String(b._id) === String(id)) || null))
  mock.method(BillingItem, 'findOneAndUpdate', (filter, update) =>
    fakeQuery(() => {
      const b = store.bills.find((x) => String(x._id) === String(filter._id))
      if (b && raceStatus) b.status = raceStatus
      if (!b || b.status !== filter.status || (b.paymentId ?? null) !== filter.paymentId) return null
      Object.assign(b, update.$set)
      store.updates.push({ filter, update })
      return b
    }),
  )
  mock.method(Patient, 'findById', () => fakeQuery(() => patient))
  mock.method(LaserSession, 'findOne', () => fakeQuery(() => null))
  mock.method(AuditLog, 'create', async (row) => {
    store.audits.push(row)
    return row
  })
  return store
}

describe('حذف بنود التحصيل', () => {
  test('البند المعلّق قابل للحذف؛ المحصّل والمحذوف والمرتبط بدفعة غير قابل مع سبب واضح', () => {
    assert.equal(describeBillingItemCancellability(bill()).cancellable, true)
    const paid = describeBillingItemCancellability(bill({ status: 'paid', paidAt: new Date('2026-11-15') }))
    assert.equal(paid.code, 'PAID')
    assert.match(paid.reason, /محصّل بتاريخ 2026-11-15/)
    assert.match(paid.reason, /ملف المريض/, 'يوجّه لمسار العكس بدل الحذف')
    const gone = describeBillingItemCancellability(bill({ status: 'cancelled', cancelledByName: 'د. الياس' }))
    assert.equal(gone.alreadyCancelled, true)
    assert.match(gone.reason, /د\. الياس/)
    assert.equal(describeBillingItemCancellability(bill({ paymentId: oid() })).code, 'HAS_PAYMENT')
    assert.equal(describeBillingItemCancellability(bill(), { activeAreaDeductionCount: 1 }).code, 'AREA_DEDUCTIONS')
    assert.equal(describeBillingItemCancellability(null).code, 'NOT_FOUND')
  })

  test('حذف بند معلّق: يُلغى (لا يُمحى) ويُسجَّل من حذفه ومتى ولماذا', async () => {
    const b = bill()
    const store = installBillingDb([b])
    const out = await cancelPendingBillingItem({ id: b._id, user: ADMIN, reason: 'مكرر' })
    assert.equal(out.ok, true)
    assert.equal(b.status, 'cancelled')
    assert.equal(b.cancelledByName, 'د. الياس')
    assert.equal(String(b.cancelledByUserId), String(ADMIN._id))
    assert.equal(b.cancelReason, 'مكرر')
    assert.equal(b.cancelSource, 'billing_delete')
    assert.ok(b.cancelledAt instanceof Date)
    assert.equal(store.updates[0].filter.status, 'pending_payment', 'الكتابة مشروطة بأن البند ما زال معلّقاً')
    assert.equal(store.audits.length, 1)
    assert.equal(store.audits[0].userName, 'د. الياس')
    assert.equal(store.audits[0].details.reason, 'مكرر')
  })

  test('حذف بند محصّل مرفوض (409) ولا يُمس السجل المالي', async () => {
    const b = bill({ status: 'paid', paidAt: new Date(), paymentId: oid() })
    const store = installBillingDb([b])
    await assert.rejects(
      () => cancelPendingBillingItem({ id: b._id, user: ADMIN }),
      (e) => e instanceof BillingCancelError && e.status === 409 && e.code === 'PAID',
    )
    assert.equal(b.status, 'paid')
    assert.equal(store.updates.length, 0)
    assert.equal(store.audits.length, 0)
  })

  test('قائمة قديمة: بند حُذف مسبقاً يعيد نجاحاً دون سجل تدقيق ثانٍ (لا رسالة خطأ مضللة)', async () => {
    const b = bill({ status: 'cancelled', cancelledByName: 'الاستقبال' })
    const store = installBillingDb([b])
    const out = await cancelPendingBillingItem({ id: b._id, user: ADMIN })
    assert.equal(out.alreadyCancelled, true)
    assert.equal(store.audits.length, 0)
  })

  test('سباق مع التحصيل: إن حُصّل البند لحظة الحذف يُرفض الحذف ولا يُلغى المحصّل', async () => {
    const b = bill()
    const store = installBillingDb([b], { raceStatus: 'paid' })
    await assert.rejects(() => cancelPendingBillingItem({ id: b._id, user: ADMIN }), (e) => e.code === 'PAID')
    assert.equal(b.status, 'paid')
    assert.equal(store.audits.length, 0)
  })

  test('بند زيارة باكج أُنقصت مناطقها لا يُحذف قبل تصحيح الإنقاص', async () => {
    const b = bill({ department: 'laser', isPackagePrepaid: true, amountDueSyp: 0 })
    const patient = {
      _id: b.patientId,
      sessionPackages: [laserPackage('باكج يدين', [ARMS], 5, { areaDeductions: [{ _id: oid(), billingItemId: b._id, areaKey: 'x' }] })],
    }
    installBillingDb([b], { patient })
    await assert.rejects(() => cancelPendingBillingItem({ id: b._id, user: ADMIN }), (e) => e.code === 'AREA_DEDUCTIONS')
    assert.equal(b.status, 'pending_payment')
  })

  test('حذف متعدد: المعلّق يُحذف، والمحصّل يبقى مع سببه، دون إيقاف البقية', async () => {
    const a = bill()
    const c = bill()
    const p = bill({ status: 'paid', paidAt: new Date() })
    const store = installBillingDb([a, c, p])
    const out = await cancelPendingBillingItems({ ids: [a._id, p._id, c._id], user: ADMIN, reason: 'تنظيف' })
    assert.equal(out.cancelledCount, 2)
    assert.equal(out.failedCount, 1)
    assert.equal(out.results.find((r) => r.id === String(p._id)).code, 'PAID')
    assert.equal(a.status, 'cancelled')
    assert.equal(c.status, 'cancelled')
    assert.equal(p.status, 'paid')
    assert.equal(store.audits.length, 2)
  })

  test('حذف متعدد بلا بنود يُرفض', async () => {
    installBillingDb([])
    await assert.rejects(() => cancelPendingBillingItems({ ids: [], user: ADMIN }), (e) => e.code === 'EMPTY')
  })

  test('بند أسنان حذفه المدير لا يُعاد إنشاؤه تلقائياً عند حفظ المخطط', () => {
    assert.equal(isManuallyCancelledBillingItem({ status: 'cancelled', cancelSource: 'billing_delete' }), true)
    assert.equal(isManuallyCancelledBillingItem({ status: 'cancelled', cancelSource: '' }), false)
    assert.equal(isManuallyCancelledBillingItem({ status: 'pending_payment', cancelSource: 'billing_delete' }), false)
  })
})
