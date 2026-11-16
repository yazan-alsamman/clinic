/**
 * اختبارات رصيد جلسات مناطق باكج الليزر المستقل، والإنقاص الجزئي، وفصل الخدمات خارج الباكج.
 * تشغيل: npm test — بلا قاعدة بيانات (النماذج تُستبدل ببيانات في الذاكرة).
 */
import { test, describe, mock, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { Patient } from '../src/models/Patient.js'
import { LaserSession } from '../src/models/LaserSession.js'
import { LaserProcedureOption } from '../src/models/LaserProcedureOption.js'
import { BillingItem } from '../src/models/BillingItem.js'
import { ClinicalSession } from '../src/models/ClinicalSession.js'
import {
  allocateVisitTreatedAreas,
  computePackageAreaLedger,
  derivePackageAreaDefinitions,
  groupPackageVisits,
  packageHasRemainingAreaSessions,
  planPackageAreaDeduction,
} from '../src/services/packageAreaLedger.js'
import {
  AreaDeductionError,
  applyLaserAreaDeductions,
  buildVisitDeductionPreviewFromData,
  reverseAreaDeductionsForLaserSessions,
} from '../src/services/laserAreaDeductions.js'
import { findFreshLaserPackageSession, resolveLaserPackagesForBooking } from '../src/services/laserPackageBooking.js'

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

const line = (procedureOptionId, areaLabel, extra = {}) => ({ procedureOptionId, areaLabel, isAddon: false, ...extra })
const addon = (procedureOptionId, areaLabel, lineCostSyp) => ({ procedureOptionId, areaLabel, isAddon: true, lineCostSyp })

function newPackage(extra = {}) {
  return {
    _id: oid(),
    department: 'laser',
    title: 'باكج يدين ورجلين',
    procedureOptionIds: [ARMS, LEGS],
    sessionsCount: 5,
    packageTotalSyp: 1_000_000,
    paidAmountSyp: 1_000_000,
    sessions: Array.from({ length: 5 }, (_, i) => ({ _id: oid(), label: `الجلسة ${i + 1}`, completedByReception: false })),
    areaSessions: [],
    areaDeductions: [],
    ...extra,
  }
}

function keysByLabel(pkg) {
  const defs = derivePackageAreaDefinitions(pkg, META)
  return Object.fromEntries(defs.map((d) => [d.label, d.key]))
}

function remaining(pkg) {
  const ledger = computePackageAreaLedger(pkg, { optionMetaById: META })
  return Object.fromEntries(ledger.areas.map((a) => [a.label, a.remainingSessions]))
}

/* ---------- قاعدة بيانات وهمية في الذاكرة ---------- */

/** نسخ عميق يحافظ على ObjectId والتواريخ (مثل نتيجة lean) */
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
function installDb({ patient, laserSessions = [], bills = [] }) {
  db = { patient, laserSessions, bills, billUpdates: [], lsUpdates: [] }
  mock.method(Patient, 'findById', () => fakeQuery(() => db.patient))
  db.update = async (filter, update, opts = {}) => {
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
      const name = path.match(/\$\[(\w+)\]/)[1]
      const pkg = pkgFor(name)
      pkg.areaDeductions = pkg.areaDeductions || []
      for (const row of v.$each) pkg.areaDeductions.push({ _id: oid(), ...row })
    }
    for (const [path, v] of Object.entries(update.$set || {})) {
      const m = path.match(/^sessionPackages\.\$\[(\w+)\]\.areaSessions$/)
      if (m) pkgFor(m[1]).areaSessions = v
    }
    if (update.$inc?.laserAreaLedgerRev) db.patient.laserAreaLedgerRev = rev + 1
    return { modifiedCount: 1 }
  }
  mock.method(Patient, 'updateOne', (...args) => db.update(...args))
  mock.method(LaserSession, 'findById', (id) => fakeQuery(() => db.laserSessions.find((s) => String(s._id) === String(id)) || null))
  mock.method(LaserSession, 'updateOne', async (f, u) => {
    db.lsUpdates.push({ f, u })
    return { modifiedCount: 1 }
  })
  mock.method(BillingItem, 'findById', (id) => fakeQuery(() => db.bills.find((b) => String(b._id) === String(id)) || null))
  mock.method(BillingItem, 'updateOne', async (f, u) => {
    db.billUpdates.push({ f, u })
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

function visit(patient, pkg, lineItems, { packageBillDue = 0 } = {}) {
  const bill = {
    _id: oid(),
    patientId: patient._id,
    department: 'laser',
    isPackagePrepaid: true,
    status: 'pending_payment',
    amountDueSyp: packageBillDue,
    effectiveAmountDueSyp: packageBillDue,
    businessDate: '2026-11-16',
    patientPackageId: String(pkg._id),
  }
  const ls = {
    _id: oid(),
    patientId: patient._id,
    patientPackageId: String(pkg._id),
    billingItemId: bill._id,
    lineItems,
    status: 'completed_pending_collection',
    createdAt: new Date('2026-11-16T10:00:00Z'),
  }
  db.bills.push(bill)
  db.laserSessions.push(ls)
  return { ls, bill }
}

function setup(pkgExtra) {
  const pkg = newPackage(pkgExtra)
  const patient = { _id: oid(), sessionPackages: [pkg], laserAreaLedgerRev: 0 }
  installDb({ patient })
  return { patient, pkg: () => db.patient.sessionPackages[0] }
}

async function deductVisit(patient, ls, labels, requestId = String(oid())) {
  const k = keysByLabel(db.patient.sessionPackages[0])
  return applyLaserAreaDeductions({
    patientId: patient._id,
    laserSessionId: ls._id,
    selections: [{ packageId: String(db.patient.sessionPackages[0]._id), areaKeys: labels.map((l) => k[l]) }],
    requestId,
    user: RECEPTION,
  })
}

afterEach(() => mock.restoreAll())

/* ---------- الاختبارات ---------- */

describe('رصيد مستقل لكل منطقة', () => {
  test('باكج يدين ورجلين: لكل منطقة 5 جلسات مستقلة', () => {
    const ledger = computePackageAreaLedger(newPackage(), { optionMetaById: META })
    assert.deepEqual(
      ledger.areas.map((a) => [a.label, a.sessionsTotal, a.usedSessions, a.remainingSessions]),
      [
        ['يدين', 5, 0, 5],
        ['رجلين', 5, 0, 5],
      ],
    )
  })

  test('عرض متعدد المناطق («إبطين و بكيني») = منطقتان برصيدين منفصلين', () => {
    const offer = String(oid())
    const meta = new Map([[offer, { name: 'إبطين و بكيني', kind: 'offer' }]])
    const defs = derivePackageAreaDefinitions({ procedureOptionIds: [offer], sessionsCount: 6 }, meta)
    assert.deepEqual(defs.map((d) => [d.label, d.sessionsTotal]), [['إبطين', 6], ['بكيني', 6]])
    assert.notEqual(defs[0].key, defs[1].key)
  })
})

describe('الإنقاص الجزئي حسب المناطق المعالجة', () => {
  test('1) يدين ورجلين معاً: جلسة من كل منطقة (4 و 4)', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين'), line(LEGS, 'رجلين')])
    await deductVisit(patient, ls, ['يدين', 'رجلين'])
    assert.deepEqual(remaining(pkg()), { يدين: 4, رجلين: 4 })
  })

  test('2) يدين فقط: تنقص اليدين وحدها (4 و 5)', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين')])
    await deductVisit(patient, ls, ['يدين'])
    assert.deepEqual(remaining(pkg()), { يدين: 4, رجلين: 5 })
  })

  test('3) رجلين فقط: تنقص الرجلين وحدها (5 و 4)', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(LEGS, 'رجلين')])
    await deductVisit(patient, ls, ['رجلين'])
    assert.deepEqual(remaining(pkg()), { يدين: 5, رجلين: 4 })
  })

  test('لا يمكن إنقاص منطقة لم تُسجَّل في جلسة الزيارة (لا إنقاص تلقائي لكل الباكج)', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين')])
    await assert.rejects(() => deductVisit(patient, ls, ['يدين', 'رجلين']), /غير مسجّلة/)
    assert.deepEqual(remaining(pkg()), { يدين: 5, رجلين: 5 })
  })

  test('لا إنقاص بلا منطقة مختارة', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين')])
    await assert.rejects(() => deductVisit(patient, ls, []), AreaDeductionError)
  })

  test('المعاينة قبل التأكيد تحدد المناطق المعالجة فقط', () => {
    const pkg = newPackage()
    const patient = { _id: oid(), sessionPackages: [pkg] }
    const ls = { _id: oid(), patientPackageId: String(pkg._id), lineItems: [line(LEGS, 'رجلين')] }
    const p = buildVisitDeductionPreviewFromData({ patient, laserSession: ls, optionMetaById: META })
    assert.deepEqual(
      p.packages[0].areas.map((a) => [a.label, a.treatedInVisit, a.remainingSessions]),
      [
        ['يدين', false, 5],
        ['رجلين', true, 5],
      ],
    )
    assert.equal(p.pendingAreaCount, 1)
  })

  test('بند الباكج (صفر) يُغلق وجلسة الليزر تكتمل بعد الإنقاص', async () => {
    const { patient, pkg } = setup()
    const { ls, bill } = visit(patient, pkg(), [line(ARMS, 'يدين')])
    await deductVisit(patient, ls, ['يدين'])
    assert.equal(db.bills.find((b) => b._id === bill._id).status, 'paid')
    assert.ok(db.lsUpdates.some((u) => u.u.$set.status === 'completed'))
  })

  test('بند باكج قديم عليه مبلغ: الإنقاص لا يعتبره مدفوعاً', async () => {
    const { patient, pkg } = setup()
    const { ls, bill } = visit(patient, pkg(), [line(ARMS, 'يدين')], { packageBillDue: 50_000 })
    await deductVisit(patient, ls, ['يدين'])
    assert.equal(db.bills.find((b) => b._id === bill._id).status, 'pending_payment')
  })
})

describe('الخدمات خارج الباكج', () => {
  test('4) إبطين خارج الباكج: لا تُنقص أي جلسة ولا يمكن إنقاصها من رصيد الباكج', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [addon(UNDERARMS, 'إبطين', 150_000)])
    const preview = buildVisitDeductionPreviewFromData({ patient: db.patient, laserSession: ls, optionMetaById: META })
    assert.equal(preview.pendingAreaCount, 0)
    assert.ok(preview.packages[0].areas.every((a) => !a.treatedInVisit))
    await assert.rejects(
      () =>
        applyLaserAreaDeductions({
          patientId: patient._id,
          laserSessionId: ls._id,
          selections: [{ packageId: String(pkg()._id), areaKeys: [`${UNDERARMS}:0:0`] }],
          requestId: 'r1',
          user: RECEPTION,
        }),
      /خارج الباكج/,
    )
    assert.deepEqual(remaining(pkg()), { يدين: 5, رجلين: 5 })
    assert.equal(pkg().packageTotalSyp, 1_000_000, 'سعر الباكج لا يتغير')
  })

  test('5) يدين + رجلين + إبطين في نفس الزيارة: تُنقص اليدين والرجلين فقط', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين'), line(LEGS, 'رجلين'), addon(UNDERARMS, 'إبطين', 150_000)])
    const preview = buildVisitDeductionPreviewFromData({ patient: db.patient, laserSession: ls, optionMetaById: META })
    assert.deepEqual(
      preview.packages[0].areas.filter((a) => a.treatedInVisit).map((a) => a.label),
      ['يدين', 'رجلين'],
    )
    await deductVisit(patient, ls, ['يدين', 'رجلين'])
    assert.deepEqual(remaining(pkg()), { يدين: 4, رجلين: 4 })
    assert.equal(pkg().areaDeductions.length, 2)
    assert.ok(pkg().areaDeductions.every((d) => d.areaLabel !== 'إبطين'))
  })

  test('9) دفع الخدمة الإضافية لا يغيّر رصيد الباكج، والإنقاص لا يُنشئ أو يدمج أي دفعة', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين'), addon(UNDERARMS, 'إبطين', 150_000)])
    const before = remaining(pkg())
    /** بند الإضافات المستقل يُحصّل (لا علاقة له بالباكج) */
    const addonBill = { _id: oid(), status: 'paid', amountDueSyp: 150_000, isPackagePrepaid: false }
    db.bills.push(addonBill)
    assert.deepEqual(remaining(pkg()), before)
    await deductVisit(patient, ls, ['يدين'])
    /** الإنقاص لم يلمس بند الإضافات، ولم يُنشئ بنداً (BillingItem.create يرمي خطأ) */
    assert.ok(db.billUpdates.every((u) => String(u.f._id) !== String(addonBill._id)))
    assert.equal(pkg().paidAmountSyp, 1_000_000)
    assert.deepEqual(remaining(pkg()), { يدين: 4, رجلين: 5 })
  })

  test('منطقة مسجّلة كباكج بلا رصيد تُكشف قبل الحفظ (يجب تحويلها لخارج الباكج)', () => {
    const pkg = newPackage({ sessionsCount: 1 })
    const k = keysByLabel(pkg)
    pkg.areaDeductions = [{ _id: oid(), areaKey: k['يدين'], deductedAt: new Date() }]
    const ledger = computePackageAreaLedger(pkg, { optionMetaById: META })
    const { uncoveredLineIndexes } = allocateVisitTreatedAreas([{ pkg, ledger }], [line(ARMS, 'يدين'), line(LEGS, 'رجلين')], META)
    assert.deepEqual(uncoveredLineIndexes, [0])
  })

  test('نفس المنطقة في باكجين: العلاج الواحد يُحتسب لباكج واحد فقط', () => {
    const a = newPackage()
    const b = newPackage()
    const ordered = [a, b].map((pkg) => ({ pkg, ledger: computePackageAreaLedger(pkg, { optionMetaById: META }) }))
    const { byPackageId } = allocateVisitTreatedAreas(ordered, [line(ARMS, 'يدين')], META)
    assert.equal(byPackageId.get(String(a._id)).size, 1)
    assert.equal(byPackageId.get(String(b._id)).size, 0)
  })
})

describe('منع التكرار والرصيد السالب', () => {
  test('6) إعادة إرسال نفس الطلب لا تُنقص مرة ثانية', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين')])
    const first = await deductVisit(patient, ls, ['يدين'], 'same-request')
    const again = await deductVisit(patient, ls, ['يدين'], 'same-request')
    assert.equal(first.duplicateRequest, false)
    assert.equal(again.duplicateRequest, true)
    assert.deepEqual(remaining(pkg()), { يدين: 4, رجلين: 5 })
  })

  test('6) طلب جديد لنفس الزيارة ونفس المنطقة يُرفض (409)', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين')])
    await deductVisit(patient, ls, ['يدين'], 'r-1')
    await assert.rejects(() => deductVisit(patient, ls, ['يدين'], 'r-2'), (e) => e.status === 409)
    assert.deepEqual(remaining(pkg()), { يدين: 4, رجلين: 5 })
  })

  test('طلبان متزامنان: القفل التفاؤلي يمنع الكتابة المزدوجة', async () => {
    const { patient, pkg } = setup()
    const { ls } = visit(patient, pkg(), [line(ARMS, 'يدين')])
    const k = keysByLabel(db.patient.sessionPackages[0])
    const realUpdate = db.update
    let calls = 0
    db.update = async (...args) => {
      calls += 1
      if (calls === 1) {
        /** طلب آخر سبقنا بين القراءة والكتابة: أنقص اليدين لنفس الزيارة وغيّر الإصدار */
        db.patient.sessionPackages[0].areaDeductions.push({ _id: oid(), areaKey: k['يدين'], laserSessionId: ls._id, deductedAt: new Date() })
        db.patient.laserAreaLedgerRev = 1
      }
      return realUpdate(...args)
    }
    await assert.rejects(() => deductVisit(patient, ls, ['يدين'], 'r-x'), (e) => e.status === 409)
    assert.equal(db.patient.sessionPackages[0].areaDeductions.filter((d) => !d.reversedAt).length, 1)
  })

  test('7) رصيد غير كافٍ: لا يُسمح برصيد سالب', () => {
    const pkg = newPackage({ sessionsCount: 1 })
    const k = keysByLabel(pkg)
    pkg.areaDeductions = [{ _id: oid(), areaKey: k['يدين'], laserSessionId: oid(), deductedAt: new Date() }]
    assert.throws(
      () => planPackageAreaDeduction({ pkg, areaKeys: [k['يدين']], laserSessionId: oid(), optionMetaById: META }),
      /لا يوجد رصيد متبقٍ/,
    )
    const ledger = computePackageAreaLedger(pkg, { optionMetaById: META })
    assert.equal(ledger.areas.find((a) => a.label === 'يدين').remainingSessions, 0)
  })

  test('باكج انتهت كل مناطقه لا يُعرض للحجز، وباكج فيه منطقة واحدة برصيد يُعرض', () => {
    const pkg = newPackage({ sessionsCount: 1 })
    const k = keysByLabel(pkg)
    pkg.areaSessions = derivePackageAreaDefinitions(pkg, META)
    pkg.areaDeductions = [{ _id: oid(), areaKey: k['يدين'], deductedAt: new Date() }]
    assert.equal(packageHasRemainingAreaSessions(pkg), true)
    assert.ok(findFreshLaserPackageSession({ sessionPackages: [pkg] }))
    pkg.areaDeductions.push({ _id: oid(), areaKey: k['رجلين'], deductedAt: new Date() })
    assert.equal(packageHasRemainingAreaSessions(pkg), false)
    assert.equal(findFreshLaserPackageSession({ sessionPackages: [pkg] }), null)
  })

  test('«استكمال باكج» القديم يُعامل كزيارة باكج عادية ولا يدمج الزيارات', async () => {
    const pkg = newPackage()
    const r = await resolveLaserPackagesForBooking({ sessionPackages: [pkg] }, [String(pkg._id)], 'continue_package')
    assert.equal(r.error, null)
    assert.equal(r.primary.mode, 'visit')
    assert.equal(r.primary.session, null)
  })
})

describe('سجل المريض', () => {
  test('8) السجل يعرض استهلاك كل منطقة بالتاريخ والمناطق المعالجة في كل زيارة', async () => {
    const { patient, pkg } = setup()
    const v1 = visit(patient, pkg(), [line(ARMS, 'يدين'), line(LEGS, 'رجلين')])
    await deductVisit(patient, v1.ls, ['يدين', 'رجلين'])
    const v2 = visit(patient, pkg(), [line(ARMS, 'يدين')])
    await deductVisit(patient, v2.ls, ['يدين'])
    const ledger = computePackageAreaLedger(pkg(), { optionMetaById: META })
    const arms = ledger.areas.find((a) => a.label === 'يدين')
    const legs = ledger.areas.find((a) => a.label === 'رجلين')
    assert.deepEqual([arms.usedSessions, arms.remainingSessions, arms.history.length], [2, 3, 2])
    assert.deepEqual([legs.usedSessions, legs.remainingSessions, legs.history.length], [1, 4, 1])
    assert.ok(arms.history.every((h) => h.date && h.visitDate === '2026-11-16'))
    const visits = groupPackageVisits(ledger)
    const byLs = new Map(visits.map((v) => [v.laserSessionId, v.areas.map((a) => a.label).sort()]))
    assert.deepEqual(byLs.get(String(v1.ls._id)), ['رجلين', 'يدين'].sort())
    assert.deepEqual(byLs.get(String(v2.ls._id)), ['يدين'])
  })

  test('حذف جلسة الليزر يعكس إنقاصاتها (تبقى في السجل) ويعود الرصيد', async () => {
    let captured
    mock.method(Patient, 'updateOne', async (f, u, o) => {
      captured = { f, u, o }
      return { modifiedCount: 1 }
    })
    const lsId = oid()
    await reverseAreaDeductionsForLaserSessions(oid(), [lsId])
    assert.ok(captured.u.$set['sessionPackages.$[].areaDeductions.$[d].reversedAt'] instanceof Date)
    assert.equal(String(captured.o.arrayFilters[0]['d.laserSessionId'].$in[0]), String(lsId))
    assert.equal(captured.o.arrayFilters[0]['d.reversedAt'], null)

    const pkg = newPackage()
    const k = keysByLabel(pkg)
    pkg.areaDeductions = [{ _id: oid(), areaKey: k['يدين'], deductedAt: new Date(), reversedAt: new Date(), reverseReason: 'حذف' }]
    const ledger = computePackageAreaLedger(pkg, { optionMetaById: META })
    const arms = ledger.areas.find((a) => a.label === 'يدين')
    assert.equal(arms.remainingSessions, 5)
    assert.equal(arms.history.length, 1)
    assert.equal(arms.history[0].reversed, true)
  })
})

describe('10) الباكجات القديمة والبيانات التاريخية', () => {
  let legacy
  let lsVerified
  beforeEach(() => {
    lsVerified = { _id: oid(), lineItems: [line(ARMS, 'يدين'), line(LEGS, 'رجلين')], createdAt: new Date('2026-10-01') }
    legacy = newPackage()
    legacy.areaSessions = undefined
    legacy.areaDeductions = undefined
    legacy.sessions[0] = { ...legacy.sessions[0], completedByReception: true, completedAt: new Date('2026-10-01'), linkedLaserSessionId: lsVerified._id }
    /** جلسة قديمة مثبّتة يدوياً بلا جلسة ليزر — لا نعرف المناطق */
    legacy.sessions[1] = { ...legacy.sessions[1], completedByReception: true, completedAt: new Date('2026-10-15') }
  })

  test('الرصيد القديم يبقى كما هو: جلستان مثبّتتان = 3 متبقية لكل منطقة', () => {
    const ledger = computePackageAreaLedger(legacy, {
      optionMetaById: META,
      laserSessionsById: new Map([[String(lsVerified._id), lsVerified]]),
    })
    for (const a of ledger.areas) {
      assert.equal(a.usedSessions, 2)
      assert.equal(a.remainingSessions, 3)
      assert.equal(a.legacyUnverifiedSessions, 1, 'الجلسة اليدوية تبقى «غير محددة المناطق» ولا يُخترع لها تاريخ علاج')
    }
    const arms = ledger.areas.find((a) => a.label === 'يدين')
    assert.deepEqual(
      arms.history.map((h) => [h.source, h.legacyUnverified]),
      [
        ['legacy_session', false],
        ['legacy_session', true],
      ],
    )
  })

  test('أول إنقاص على باكج قديم يحفظ نسخة المناطق ولا يغيّر جلساته القديمة', async () => {
    const patient = { _id: oid(), sessionPackages: [legacy] }
    installDb({ patient })
    const sessionsBefore = clone(legacy.sessions)
    const { ls } = visit(patient, legacy, [line(LEGS, 'رجلين')])
    await deductVisit(patient, ls, ['رجلين'])
    const pkg = db.patient.sessionPackages[0]
    assert.equal(pkg.areaSessions.length, 2)
    assert.deepEqual(pkg.sessions, sessionsBefore)
    assert.deepEqual(remaining(pkg), { يدين: 3, رجلين: 2 })
  })

  test('جلسة ليزر قديمة مثبّتة لا تُنقص مرة ثانية بالنظام الجديد', () => {
    const k = keysByLabel(legacy)
    assert.throws(
      () =>
        planPackageAreaDeduction({ pkg: legacy, areaKeys: [k['يدين']], laserSessionId: lsVerified._id, optionMetaById: META }),
      (e) => e.status === 409,
    )
  })
})
