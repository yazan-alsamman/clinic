/**
 * اختبارات الخصومات: الحساب (نسبة/مبلغ)، السجلات المستقلة، الترتيب، العرض في نظرة المريض،
 * سلامة الصندوق (لا خصم مكرر ولا حركة إضافية)، السجلات القديمة، والصلاحيات.
 * تشغيل: npm test — بلا قاعدة بيانات (النماذج تُستبدل ببيانات في الذاكرة).
 */
import { test, describe, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { BillingPayment } from '../src/models/BillingPayment.js'
import { Patient } from '../src/models/Patient.js'
import { LaserSession } from '../src/models/LaserSession.js'
import { DiscountRecord } from '../src/models/DiscountRecord.js'
import { FinancialDocument } from '../src/models/FinancialDocument.js'
import { AuditLog } from '../src/models/AuditLog.js'
import {
  amountFromPercent,
  combineSequentialDiscount,
  displayPercent,
  percentFromAmount,
  resolveDiscountEntry,
} from '../src/services/discountMath.js'
import {
  buildPatientDiscountOverview,
  discountOverviewDepartmentsForRole,
  reverseActiveDiscountsForBillingItem,
} from '../src/services/discountRecords.js'
import { completeBillingItemPayment } from '../src/services/billingPaymentCompletion.js'
import { packagePaymentBodyWithoutDiscount, resolvePackageSaleDiscount } from '../src/routes/patients.js'

mongoose.set('bufferCommands', false)

const oid = () => new mongoose.Types.ObjectId()
const PATIENT_ID = oid()
const RECEPTION = { _id: oid(), name: 'موظفة الاستقبال', role: 'reception' }

function fakeQuery(data) {
  const q = {
    select: () => q,
    sort: () => q,
    populate: () => q,
    limit: () => q,
    lean: () => Promise.resolve(data),
    then: (res, rej) => Promise.resolve(data).then(res, rej),
  }
  return q
}

function record(extra) {
  return {
    _id: oid(),
    patientId: PATIENT_ID,
    targetType: 'billing_item',
    sequence: 1,
    basis: 'list',
    entryMode: 'percent',
    status: 'active',
    source: 'payment',
    currency: 'SYP',
    correctsRecordIds: [],
    ...extra,
  }
}

function billingItem(extra) {
  return {
    _id: oid(),
    patientId: PATIENT_ID,
    department: 'laser',
    procedureLabel: 'خدمة',
    businessDate: '2026-11-16',
    createdAt: new Date('2026-11-16T08:00:00Z'),
    status: 'paid',
    currency: 'SYP',
    discountPercent: 0,
    isPackagePrepaid: false,
    isCreditTopUp: false,
    ...extra,
  }
}

afterEach(() => mock.restoreAll())

/* ---------------------------------------------------------------- */

describe('Test 1 — خصم باكج 20٪ يظهر في نظرة المريض', () => {
  test('500,000 − 20٪ = 400,000: الأصلي والنسبة والمبلغ والنهائي', () => {
    const sale = resolvePackageSaleDiscount({ discountPercent: 20 }, 500000)
    assert.equal(sale.packageTotalSyp, 400000)
    assert.equal(sale.listPriceSyp, 500000)
    assert.equal(sale.saleEntry.discountAmountSyp, 100000)
    assert.deepEqual(sale.packageFields, { listPriceSyp: 500000, discountAmountSyp: 100000, discountPercent: 20 })

    const pkgId = oid()
    const ov = buildPatientDiscountOverview({
      packages: [
        {
          _id: pkgId,
          department: 'laser',
          title: 'ذراعين + ساقين',
          packageTotalSyp: sale.packageTotalSyp,
          ...sale.packageFields,
          paidAmountSyp: 400000,
          createdAt: new Date('2026-11-16T07:30:00Z'),
        },
      ],
      records: [
        record({
          targetType: 'patient_package',
          packageId: String(pkgId),
          source: 'package_sale',
          listPriceSyp: 500000,
          priceBeforeSyp: 500000,
          discountPercent: 20,
          discountAmountSyp: 100000,
          priceAfterSyp: 400000,
          appliedByName: 'موظفة الاستقبال',
          appliedAt: new Date('2026-11-16T07:30:00Z'),
        }),
      ],
    })
    const pkg = ov.services.find((s) => s.kind === 'package')
    assert.equal(pkg.originalPriceSyp, 500000)
    assert.equal(pkg.totalDiscountPercent, 20)
    assert.equal(pkg.totalDiscountSyp, 100000)
    assert.equal(pkg.finalPriceSyp, 400000)
    assert.equal(pkg.paidSyp, 400000)
    assert.equal(pkg.remainingSyp, 0)
    assert.equal(pkg.discounts.length, 1)
    assert.equal(pkg.discounts[0].amountSyp, 100000)
    assert.equal(pkg.notes.length, 0)
  })

  test('خفض السعر عن سعر القالب يُسجَّل خصماً مستقلاً، ثم خصم البيع على المتبقي', () => {
    const sale = resolvePackageSaleDiscount({ discountPercent: 10 }, 450000, { templateListPriceSyp: 500000 })
    assert.equal(sale.listPriceSyp, 500000)
    assert.equal(sale.priceEntry.discountAmountSyp, 50000)
    assert.equal(sale.saleEntry.priceBeforeSyp, 450000)
    assert.equal(sale.saleEntry.discountAmountSyp, 45000)
    assert.equal(sale.packageTotalSyp, 405000)
    assert.equal(sale.packageFields.discountAmountSyp, 95000)
  })
})

describe('Test 2 — خصم ثابت على جلسة واحدة', () => {
  test('200,000 − 30,000 = 170,000 (15٪)', () => {
    const entry = resolveDiscountEntry({ baseSyp: 200000, amountSyp: 30000 })
    assert.equal(entry.entryMode, 'amount')
    assert.equal(displayPercent(entry.discountPercent), 15)
    assert.equal(entry.priceAfterSyp, 170000)

    const bi = billingItem({
      department: 'dermatology',
      procedureLabel: 'جلسة تقشير',
      listAmountDueSyp: 200000,
      discountPercent: entry.discountPercent,
      effectiveAmountDueSyp: 170000,
      amountDueSyp: 170000,
    })
    const ov = buildPatientDiscountOverview({
      billingItems: [bi],
      paymentsByItemId: new Map([[String(bi._id), { amountSyp: 170000, creditAppliedSyp: 0 }]]),
      records: [
        record({
          billingItemId: bi._id,
          entryMode: 'amount',
          source: 'dermatology_session',
          listPriceSyp: 200000,
          priceBeforeSyp: 200000,
          discountPercent: entry.discountPercent,
          discountAmountSyp: 30000,
          priceAfterSyp: 170000,
          appliedByName: 'د. ريم',
          appliedAt: new Date('2026-11-16T09:00:00Z'),
        }),
      ],
    })
    const s = ov.services[0]
    assert.equal(s.originalPriceSyp, 200000)
    assert.equal(s.totalDiscountSyp, 30000)
    assert.equal(s.totalDiscountPercent, 15)
    assert.equal(s.finalPriceSyp, 170000)
    assert.equal(s.paidSyp, 170000)
    assert.equal(s.discounts[0].entryMode, 'amount')
    assert.equal(s.discounts[0].percent, 15)
  })
})

describe('Test 3/4 — الإدخال بالنسبة وبالمبلغ', () => {
  test('20٪ على 500,000 = 100,000', () => {
    const e = resolveDiscountEntry({ baseSyp: 500000, percent: 20 })
    assert.equal(e.discountAmountSyp, 100000)
    assert.equal(e.priceAfterSyp, 400000)
    assert.equal(amountFromPercent(500000, 20), 100000)
  })
  test('75,000 على 500,000 = 15٪', () => {
    const e = resolveDiscountEntry({ baseSyp: 500000, amountSyp: 75000 })
    assert.equal(displayPercent(e.discountPercent), 15)
    assert.equal(e.priceAfterSyp, 425000)
    assert.equal(percentFromAmount(500000, 75000), 15)
  })
  test('نسبة كسرية: المبلغ هو المرجع والنسبة تُعرض بمنزلتين', () => {
    const e = resolveDiscountEntry({ baseSyp: 300000, amountSyp: 10000 })
    assert.equal(e.discountAmountSyp, 10000)
    assert.equal(displayPercent(e.discountPercent), 3.33)
    assert.equal(e.priceAfterSyp, 290000)
  })
  test('رفض الخصم غير الصالح: أكبر من السعر، سالب، أكثر من 100٪، أو نسبة ومبلغ معاً', () => {
    assert.throws(() => resolveDiscountEntry({ baseSyp: 100000, amountSyp: 100000 }), /أقل من 1/)
    assert.throws(() => resolveDiscountEntry({ baseSyp: 100000, amountSyp: 150000 }), /أقل من 1/)
    assert.throws(() => resolveDiscountEntry({ baseSyp: 100000, amountSyp: -5 }), /غير صالح/)
    assert.throws(() => resolveDiscountEntry({ baseSyp: 100000, percent: 120 }), /بين 0 و 100/)
    assert.throws(() => resolveDiscountEntry({ baseSyp: 100000, percent: 10, amountSyp: 5000 }), /ليس الاثنين/)
    assert.equal(resolveDiscountEntry({ baseSyp: 100000, percent: 0 }), null)
    assert.equal(resolveDiscountEntry({ baseSyp: 100000 }), null)
  })
  test('جلسة مجانية 100٪ مسموحة فقط حيث كانت مسموحة (minPriceAfterSyp: 0)', () => {
    const e = resolveDiscountEntry({ baseSyp: 100000, percent: 100, minPriceAfterSyp: 0 })
    assert.equal(e.priceAfterSyp, 0)
  })
})

describe('Test 5/6 — خصومات متعددة مستقلة وترتيبها', () => {
  const list = 500000
  const first = resolveDiscountEntry({ baseSyp: list, percent: 10 })
  const afterFirst = first.priceAfterSyp
  const second = resolveDiscountEntry({ baseSyp: afterFirst, percent: 5 })
  const combined = combineSequentialDiscount({ listSyp: list, currentEffectiveSyp: afterFirst, entry: second })

  test('الخصم الثاني يُحسب على المتبقي (450,000) لا على الأصلي', () => {
    assert.equal(first.discountAmountSyp, 50000)
    assert.equal(second.discountAmountSyp, 22500)
    assert.equal(combined.effectiveAmountDueSyp, 427500)
    assert.equal(displayPercent(combined.discountPercent), 14.5)
  })

  test('كل خصم سطر مستقل بنسبته ومبلغه ووقته ومن طبّقه، والإجمالي يطابق السجل المالي', () => {
    const bi = billingItem({
      procedureLabel: 'ليزر — ذراعين',
      listAmountDueSyp: list,
      discountPercent: combined.discountPercent,
      effectiveAmountDueSyp: combined.effectiveAmountDueSyp,
      amountDueSyp: combined.effectiveAmountDueSyp,
    })
    const ov = buildPatientDiscountOverview({
      billingItems: [bi],
      paymentsByItemId: new Map([[String(bi._id), { amountSyp: 427500, creditAppliedSyp: 0 }]]),
      records: [
        record({
          billingItemId: bi._id,
          sequence: 2,
          basis: 'remaining',
          listPriceSyp: list,
          priceBeforeSyp: afterFirst,
          discountPercent: 5,
          discountAmountSyp: 22500,
          priceAfterSyp: 427500,
          appliedByName: 'د. محمد',
          appliedAt: new Date('2026-11-16T11:15:00+02:00'),
        }),
        record({
          billingItemId: bi._id,
          sequence: 1,
          source: 'laser_session',
          listPriceSyp: list,
          priceBeforeSyp: list,
          discountPercent: 10,
          discountAmountSyp: 50000,
          priceAfterSyp: 450000,
          appliedByName: 'د. أحمد',
          appliedAt: new Date('2026-11-16T10:30:00+02:00'),
        }),
      ],
    })
    const s = ov.services[0]
    assert.equal(s.discounts.length, 2)
    assert.deepEqual(
      s.discounts.map((d) => [d.sequence, d.percent, d.amountSyp, d.appliedByName, d.basis]),
      [
        [1, 10, 50000, 'د. أحمد', 'list'],
        [2, 5, 22500, 'د. محمد', 'remaining'],
      ],
    )
    assert.equal(s.discounts[0].appliedAt, '2026-11-16T08:30:00.000Z')
    assert.equal(s.discounts[1].appliedAt, '2026-11-16T09:15:00.000Z')
    assert.equal(s.originalPriceSyp, 500000)
    assert.equal(s.totalDiscountSyp, 72500)
    assert.equal(s.finalPriceSyp, 427500)
    assert.equal(s.notes.length, 0, 'مجموع السجلات يطابق الفرق — لا تحذير')
  })

  test('النهائي يُقرأ دائماً من السجل المالي؛ عدم التطابق يظهر كملاحظة لا كإعادة حساب', () => {
    const bi = billingItem({ listAmountDueSyp: 500000, effectiveAmountDueSyp: 430000, amountDueSyp: 430000 })
    const ov = buildPatientDiscountOverview({
      billingItems: [bi],
      records: [
        record({ billingItemId: bi._id, listPriceSyp: 500000, priceBeforeSyp: 500000, discountAmountSyp: 50000, priceAfterSyp: 450000, discountPercent: 10 }),
      ],
    })
    assert.equal(ov.services[0].finalPriceSyp, 430000)
    assert.equal(ov.services[0].notes.length, 1)
  })
})

describe('Test 7 — كل أنواع الخدمات', () => {
  test('أسنان، تقويم، إجراءات عامة، ليزر، جلدية، باكج، جلسة باكج بإضافة، جلسة قديمة', () => {
    const dental = billingItem({ department: 'dental', procedureLabel: 'حشوة', listAmountDueSyp: 100000, discountPercent: 10, effectiveAmountDueSyp: 90000, amountDueSyp: 90000 })
    const ortho = billingItem({ department: 'dental', procedureLabel: 'تقويم — قسط', listAmountDueSyp: 300000, effectiveAmountDueSyp: 300000, amountDueSyp: 300000 })
    const general = billingItem({ department: 'dental', procedureLabel: 'إجراء عام — تبييض', listAmountDueSyp: 200000, discountPercent: 25, effectiveAmountDueSyp: 150000, amountDueSyp: 150000, status: 'pending_payment' })
    const pkgSessionZero = billingItem({ isPackagePrepaid: true, listAmountDueSyp: 0, amountDueSyp: 0 })
    const addon = billingItem({ procedureLabel: 'إضافة خارج الباكج', listAmountDueSyp: 60000, effectiveAmountDueSyp: 60000, amountDueSyp: 60000 })
    const topUp = billingItem({ isCreditTopUp: true, listAmountDueSyp: 50000, amountDueSyp: 50000 })
    const pkgId = oid()
    const items = [dental, ortho, general, pkgSessionZero, addon, topUp]
    const pays = new Map(
      [dental, ortho, addon].map((b) => [
        String(b._id),
        { amountSyp: b.amountDueSyp, creditAppliedSyp: 0, discountPercent: b.discountPercent, listAmountDueSyp: b.listAmountDueSyp, effectiveAmountDueSyp: b.effectiveAmountDueSyp, receivedAt: new Date('2026-11-10T10:00:00Z'), receivedByName: 'الاستقبال' },
      ]),
    )
    const ov = buildPatientDiscountOverview({
      billingItems: items,
      paymentsByItemId: pays,
      packages: [{ _id: pkgId, department: 'solarium', title: 'سولاريوم 10', packageTotalSyp: 90000, listPriceSyp: 100000, discountAmountSyp: 10000, paidAmountSyp: 90000, createdAt: new Date() }],
      records: [record({ targetType: 'patient_package', packageId: String(pkgId), source: 'package_sale', listPriceSyp: 100000, priceBeforeSyp: 100000, discountPercent: 10, discountAmountSyp: 10000, priceAfterSyp: 90000 })],
      standaloneLaserSessions: [{ _id: oid(), treatmentNumber: 7, costSyp: 100000, discountPercent: 20, createdAt: new Date('2025-01-01'), operatorName: 'أخصائية' }],
      dermVisits: [{ _id: oid(), costSyp: 80000, discountPercent: 50, areaTreatment: 'فيلر', createdAt: new Date('2025-02-01'), providerName: 'د. ريم' }],
    })
    const byLabel = Object.fromEntries(ov.services.map((s) => [s.label, s]))
    assert.equal(byLabel['حشوة'].totalDiscountSyp, 10000)
    assert.equal(byLabel['تقويم — قسط'].hasDiscount, false, 'بدون خصم: لا معلومات خصم مضللة')
    assert.equal(byLabel['تقويم — قسط'].discounts.length, 0)
    assert.equal(byLabel['إجراء عام — تبييض'].finalPriceSyp, 150000)
    assert.equal(byLabel['إجراء عام — تبييض'].remainingSyp, 150000)
    assert.equal(byLabel['سولاريوم 10'].totalDiscountSyp, 10000)
    assert.equal(byLabel['إضافة خارج الباكج'].hasDiscount, false)
    assert.equal(byLabel['ليزر — معالجة 7'].totalDiscountSyp, 20000)
    assert.equal(byLabel['فيلر'].finalPriceSyp, 40000)
    assert.ok(!ov.services.some((s) => s.billingItemId === String(pkgSessionZero._id)), 'جلسة باكج بلا مبلغ ليست خدمة مسعّرة')
    assert.ok(!ov.services.some((s) => s.billingItemId === String(topUp._id)), 'شحن الرصيد ليس خدمة')
    assert.equal(ov.summary.discountedCount, 5)
  })
})

describe('Test 8 — سلامة الصندوق: لا خصم مكرر ولا حركة إضافية', () => {
  function stubPaymentModels({ activeRecords = [], laserSession = null } = {}) {
    const created = { payments: [], records: [], patientUpdates: [] }
    mock.method(Patient, 'findById', () => fakeQuery({ _id: PATIENT_ID, outstandingDebtSyp: 0, prepaidCreditSyp: 0 }))
    mock.method(Patient, 'updateOne', (_f, u) => {
      created.patientUpdates.push(u)
      return Promise.resolve({})
    })
    mock.method(BillingPayment, 'findOne', () => Promise.resolve(null))
    mock.method(BillingPayment, 'create', (doc) => {
      const p = { _id: oid(), receivedAt: new Date('2026-11-16T10:00:00Z'), ...doc }
      created.payments.push(p)
      return Promise.resolve(p)
    })
    mock.method(LaserSession, 'updateOne', () => Promise.resolve({}))
    mock.method(LaserSession, 'findOne', () => fakeQuery(laserSession))
    mock.method(FinancialDocument, 'findOne', () => fakeQuery({ _id: oid() }))
    mock.method(AuditLog, 'create', () => Promise.resolve({}))
    mock.method(DiscountRecord, 'find', () => fakeQuery(activeRecords))
    mock.method(DiscountRecord, 'countDocuments', () => Promise.resolve(activeRecords.length))
    mock.method(DiscountRecord, 'create', (doc) => {
      const r = { _id: oid(), ...doc }
      created.records.push(r)
      return Promise.resolve(r)
    })
    mock.method(DiscountRecord, 'updateMany', () => Promise.resolve({}))
    return created
  }

  function pendingItem(extra) {
    return {
      _id: oid(),
      patientId: PATIENT_ID,
      clinicalSessionId: oid(),
      department: 'laser',
      procedureLabel: 'ليزر',
      businessDate: '2026-11-16',
      status: 'pending_payment',
      currency: 'SYP',
      discountPercent: 0,
      save() {
        return Promise.resolve(this)
      },
      ...extra,
    }
  }

  test('خصم مبلغ ثابت عند التحصيل: دفعة واحدة، سجل خصم واحد، المستحق بعد الخصم', async () => {
    const created = stubPaymentModels()
    const bi = pendingItem({ listAmountDueSyp: 200000, effectiveAmountDueSyp: 200000, amountDueSyp: 200000 })
    await completeBillingItemPayment(bi, { payCurrency: 'SYP', paymentChannel: 'cash', amountSyp: 170000, discountAmountSyp: 30000 }, RECEPTION)
    assert.equal(created.payments.length, 1)
    assert.equal(created.payments[0].amountSyp, 170000)
    assert.equal(created.payments[0].effectiveAmountDueSyp, 170000)
    assert.equal(created.payments[0].settlementDeltaSyp, 0, 'لا ذمة ولا رصيد ناتج عن الخصم')
    assert.equal(bi.effectiveAmountDueSyp, 170000)
    assert.equal(bi.listAmountDueSyp, 200000)
    assert.equal(created.records.length, 1)
    assert.equal(created.records[0].discountAmountSyp, 30000)
    assert.equal(created.records[0].entryMode, 'amount')
    assert.equal(created.records[0].appliedByName, 'موظفة الاستقبال')
    const debtUpdate = created.patientUpdates[0].$set
    assert.equal(debtUpdate.outstandingDebtSyp, 0)
    assert.equal(debtUpdate.prepaidCreditSyp, 0)
  })

  test('خصم إضافي على بند عليه خصم سابق: يُطبَّق على المتبقي ويُسجَّل سطراً ثانياً', async () => {
    const prior = record({ listPriceSyp: 500000, priceBeforeSyp: 500000, discountAmountSyp: 50000, priceAfterSyp: 450000, discountPercent: 10 })
    const created = stubPaymentModels({ activeRecords: [prior] })
    const bi = pendingItem({ department: 'dermatology', listAmountDueSyp: 500000, discountPercent: 10, effectiveAmountDueSyp: 450000, amountDueSyp: 450000 })
    await completeBillingItemPayment(bi, { payCurrency: 'SYP', paymentChannel: 'cash', amountSyp: 427500, discountPercent: 5 }, RECEPTION)
    assert.equal(bi.effectiveAmountDueSyp, 427500)
    assert.equal(displayPercent(bi.discountPercent), 14.5)
    assert.equal(created.payments[0].amountSyp, 427500)
    assert.equal(created.records.length, 1)
    assert.equal(created.records[0].basis, 'remaining')
    assert.equal(created.records[0].sequence, 2)
    assert.equal(created.records[0].priceBeforeSyp, 450000)
    assert.equal(created.records[0].listPriceSyp, 500000)
  })

  test('بلا خصم جديد: لا سجل خصم، وسلوك التحصيل كما هو', async () => {
    const created = stubPaymentModels()
    const bi = pendingItem({ listAmountDueSyp: 100000, effectiveAmountDueSyp: 100000, amountDueSyp: 100000 })
    await completeBillingItemPayment(bi, { payCurrency: 'SYP', paymentChannel: 'cash', amountSyp: 100000, discountPercent: 0 }, RECEPTION)
    assert.equal(created.records.length, 0)
    assert.equal(created.payments[0].discountPercent, 0)
    assert.equal(created.payments[0].amountSyp, 100000)
  })

  test('باكج بخصم 20٪: بند الشراء يُحصَّل بلا خصم ثانٍ والذمة صفر (كان الخصم يتحوّل لذمة)', async () => {
    const created = stubPaymentModels()
    const body = { packageTotalSyp: 500000, paidAmountSyp: 400000, discountPercent: 20, payCurrency: 'SYP', paymentChannel: 'cash', amountSyp: 400000 }
    const sale = resolvePackageSaleDiscount(body, body.packageTotalSyp)
    const settlementDeltaSyp = body.paidAmountSyp - sale.packageTotalSyp
    assert.equal(settlementDeltaSyp, 0, 'لا ذمة 100,000 على المريض')
    const purchaseBi = pendingItem({ listAmountDueSyp: 400000, effectiveAmountDueSyp: 400000, amountDueSyp: 400000 })
    await completeBillingItemPayment(purchaseBi, packagePaymentBodyWithoutDiscount(body), RECEPTION, { skipPatientDebtUpdate: true })
    assert.equal(created.payments.length, 1)
    assert.equal(created.payments[0].discountPercent, 0)
    assert.equal(created.payments[0].amountSyp, 400000, 'الإيراد = المقبوض (كان 320,000 بسبب خصم مكرر)')
    assert.equal(created.payments[0].settlementDeltaSyp, 0)
    assert.equal(created.records.length, 0, 'خصم الباكج يُسجَّل على الباكج لا على بند الشراء')
    assert.equal(created.patientUpdates.length, 0)
  })

  test('بناء العرض لا يلمس أي نموذج مالي', () => {
    const forbidden = [
      [BillingPayment, 'create'],
      [Patient, 'updateOne'],
      [FinancialDocument, 'create'],
      [DiscountRecord, 'create'],
    ].map(([M, m]) => mock.method(M, m, () => assert.fail(`${m} يجب ألا يُستدعى`)))
    const bi = billingItem({ listAmountDueSyp: 100000, discountPercent: 10, effectiveAmountDueSyp: 90000, amountDueSyp: 90000 })
    buildPatientDiscountOverview({ billingItems: [bi] })
    for (const f of forbidden) assert.equal(f.mock.callCount(), 0)
  })
})

describe('Test 9 — السجلات القديمة دون اختلاق', () => {
  test('خصم قديم عند التحصيل: الوقت والمستلم من الدفعة الفعلية', () => {
    const bi = billingItem({ department: 'laser', listAmountDueSyp: 300000, discountPercent: 10, effectiveAmountDueSyp: 270000, amountDueSyp: 270000 })
    const ov = buildPatientDiscountOverview({
      billingItems: [bi],
      paymentsByItemId: new Map([[String(bi._id), { amountSyp: 270000, discountPercent: 10, listAmountDueSyp: 300000, effectiveAmountDueSyp: 270000, receivedAt: new Date('2025-06-01T09:00:00Z'), receivedByName: 'سارة' }]]),
    })
    const d = ov.services[0].discounts[0]
    assert.equal(d.historical, true)
    assert.equal(d.amountSyp, 30000)
    assert.equal(d.appliedByName, 'سارة')
    assert.equal(d.appliedAt, '2025-06-01T09:00:00.000Z')
  })

  test('خصم جلدية قديم مُدخل قبل التحصيل: لا وقت ولا اسم (غير محفوظين)', () => {
    const bi = billingItem({ department: 'dermatology', listAmountDueSyp: 200000, discountPercent: 15, effectiveAmountDueSyp: 170000, amountDueSyp: 170000 })
    const ov = buildPatientDiscountOverview({
      billingItems: [bi],
      paymentsByItemId: new Map([[String(bi._id), { amountSyp: 170000, discountPercent: 15, listAmountDueSyp: 200000, effectiveAmountDueSyp: 170000, receivedAt: new Date(), receivedByName: 'سارة' }]]),
    })
    const d = ov.services[0].discounts[0]
    assert.equal(d.appliedAt, null)
    assert.equal(d.appliedByName, null)
    assert.equal(d.amountSyp, 30000)
    assert.equal(d.percent, 15)
  })

  test('خصم جلسة ليزر قديم: البند بالسعر بعد الخصم، الأصلي من الجلسة', () => {
    const bi = billingItem({ listAmountDueSyp: 400000, effectiveAmountDueSyp: 400000, amountDueSyp: 400000 })
    const ov = buildPatientDiscountOverview({
      billingItems: [bi],
      laserByItemId: new Map([[String(bi._id), { costSyp: 500000, discountPercent: 20, createdAt: new Date('2025-05-05T08:00:00Z'), operatorName: 'أخصائية ليزر' }]]),
    })
    const s = ov.services[0]
    assert.equal(s.originalPriceSyp, 500000)
    assert.equal(s.totalDiscountSyp, 100000)
    assert.equal(s.discounts[0].appliedByName, 'أخصائية ليزر')
  })

  test('باكج قديم خُصم عند تحصيله: يظهر الخصم المسجّل مع تنبيه للمراجعة', () => {
    const pkgId = oid()
    const created = new Date('2025-03-03T10:00:00Z')
    const purchase = billingItem({ procedureLabel: 'ليزر — باكج مسبق الدفع (6 جلسة)', listAmountDueSyp: 400000, discountPercent: 20, effectiveAmountDueSyp: 320000, amountDueSyp: 320000, createdAt: created })
    const ov = buildPatientDiscountOverview({
      billingItems: [purchase],
      paymentsByItemId: new Map([[String(purchase._id), { amountSyp: 320000, discountPercent: 20, listAmountDueSyp: 400000, effectiveAmountDueSyp: 320000, receivedAt: created, receivedByName: 'سارة' }]]),
      packages: [{ _id: pkgId, department: 'laser', title: 'باكج قديم', packageTotalSyp: 500000, paidAmountSyp: 400000, createdAt: created }],
    })
    assert.equal(ov.services.length, 1, 'بند الشراء مدموج في صف الباكج')
    const pkg = ov.services[0]
    assert.equal(pkg.finalPriceSyp, 500000, 'لا يُعاد حساب السعر المعتمد')
    assert.equal(pkg.discounts[0].amountSyp, 80000)
    assert.equal(pkg.discounts[0].historical, true)
    assert.ok(pkg.notes.some((n) => n.includes('مراجعة')))
  })
})

describe('Test 10 — الصلاحيات وتتبّع التعديلات', () => {
  test('كل دور يرى أقسامه فقط', () => {
    assert.equal(discountOverviewDepartmentsForRole('super_admin'), null)
    assert.equal(discountOverviewDepartmentsForRole('reception'), null)
    assert.deepEqual([...discountOverviewDepartmentsForRole('laser')], ['laser'])
    assert.deepEqual([...discountOverviewDepartmentsForRole('dental_branch')], ['dental'])
    assert.equal(discountOverviewDepartmentsForRole('unknown').size, 0)
    const ov = buildPatientDiscountOverview({
      billingItems: [
        billingItem({ department: 'dental', listAmountDueSyp: 1000, effectiveAmountDueSyp: 1000, amountDueSyp: 1000 }),
        billingItem({ department: 'laser', listAmountDueSyp: 1000, effectiveAmountDueSyp: 1000, amountDueSyp: 1000 }),
      ],
      departments: discountOverviewDepartmentsForRole('dental_branch'),
    })
    assert.deepEqual(ov.services.map((s) => s.department), ['dental'])
  })

  test('تصحيح الخصم: السجل الأصلي يبقى «ملغى» بمن ومتى، والجديد يشير إليه', () => {
    const bi = billingItem({ status: 'pending_payment', listAmountDueSyp: 500000, discountPercent: 15, effectiveAmountDueSyp: 425000, amountDueSyp: 425000 })
    const original = record({ billingItemId: bi._id, status: 'reversed', reversedAt: new Date('2026-11-16T12:00:00Z'), reversedByName: 'مدير النظام', reversalReason: 'تصحيح نسبة', listPriceSyp: 500000, priceBeforeSyp: 500000, discountPercent: 10, discountAmountSyp: 50000, priceAfterSyp: 450000, appliedAt: new Date('2026-11-16T10:00:00Z') })
    const correction = record({ billingItemId: bi._id, sequence: 2, source: 'admin_edit', correctsRecordIds: [original._id], listPriceSyp: 500000, priceBeforeSyp: 500000, discountPercent: 15, discountAmountSyp: 75000, priceAfterSyp: 425000, appliedByName: 'مدير النظام', appliedAt: new Date('2026-11-16T12:00:00Z') })
    const s = buildPatientDiscountOverview({ billingItems: [bi], records: [original, correction] }).services[0]
    assert.equal(s.discounts.length, 2)
    assert.equal(s.discounts[0].status, 'reversed')
    assert.equal(s.discounts[0].reversedByName, 'مدير النظام')
    assert.equal(s.discounts[1].isCorrection, true)
    assert.equal(s.totalDiscountSyp, 75000, 'الملغى لا يُحسب')
    assert.equal(s.notes.length, 0)
  })

  test('الإلغاء يعلّم السجلات ولا يحذفها', async () => {
    const ids = [oid(), oid()]
    mock.method(DiscountRecord, 'find', () => fakeQuery(ids.map((_id) => ({ _id }))))
    const upd = mock.method(DiscountRecord, 'updateMany', () => Promise.resolve({}))
    const del = mock.method(DiscountRecord, 'deleteMany', () => assert.fail('لا حذف'))
    const out = await reverseActiveDiscountsForBillingItem(oid(), { user: { _id: oid(), name: 'مدير' }, reason: 'تصحيح' })
    assert.deepEqual(out, ids)
    assert.equal(upd.mock.calls[0].arguments[1].$set.status, 'reversed')
    assert.equal(upd.mock.calls[0].arguments[1].$set.reversedByName, 'مدير')
    assert.equal(del.mock.callCount(), 0)
  })
})
