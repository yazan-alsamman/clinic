/**
 * اختبارات العمولة والمستهلكات والأقساط في الإجراءات العامة (أسنان) + فحص صندوق الأخصائيين.
 * تشغيل: npm test (node --test) — بلا قاعدة بيانات: نماذج Mongoose تُستبدل ببيانات في الذاكرة.
 */
import { test, describe, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { Patient } from '../src/models/Patient.js'
import { User } from '../src/models/User.js'
import { DoctorShareSettings } from '../src/models/DoctorShareSettings.js'
import { PatientDebtSettlement } from '../src/models/PatientDebtSettlement.js'
import { ClinicalSession } from '../src/models/ClinicalSession.js'
import { BillingItem } from '../src/models/BillingItem.js'
import {
  GENERAL_PROCEDURE_COMMISSION_RULE,
  addConsumable,
  buildGeneralProceduresReport,
  buildGeneralTreatmentSessionsView,
  closeSession,
  doctorCommissionFromNet,
  generalTreatmentCommissionEntries,
  generalTreatmentNetInRange,
  openSession,
  removeConsumable,
} from '../src/services/generalProcedureSessions.js'
import {
  listDentalClinicSessions,
  summarizeDentalChartFinance,
} from '../src/services/dentalFinanceShares.js'
import {
  applyDentalBillingPaymentToChart,
  applyDentalDebtAllocationsToChart,
} from '../src/services/dentalChartBilling.js'
import { mergePreviousGeneralBillingLinks } from '../src/routes/dental.js'
import { computeLaserSpecialistShares, laserProfitSyp } from '../src/routes/finance.js'
import {
  aggregateReceptionPaidItems,
  composeReceptionInventoryPayload,
} from '../src/routes/billing.js'

/** لا اتصال بقاعدة بيانات: أي استعلام غير مُستبدل يفشل فوراً بدل الانتظار */
mongoose.set('bufferCommands', false)

const ADMIN = { _id: new mongoose.Types.ObjectId(), name: 'مدير النظام', role: 'super_admin' }
const NURSE = { _id: new mongoose.Types.ObjectId(), name: 'مساعدة أسنان', role: 'dental_assistant' }
const DOCTOR_ID = new mongoose.Types.ObjectId()
const DOCTOR_NAME = 'د. سامي'

function fakeQuery(data) {
  const q = {
    select: () => q,
    sort: () => q,
    populate: () => q,
    lean: () => Promise.resolve(data),
    then: (res, rej) => Promise.resolve(data).then(res, rej),
  }
  return q
}

function cashTreatment(extra = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    procedureDescription: 'تبييض',
    totalCostSyp: 1200,
    totalCostUsd: 0,
    costUsdSypRate: 0,
    doctorName: DOCTOR_NAME,
    providerUserId: DOCTOR_ID,
    providerKey: '',
    businessDate: '2026-11-01',
    payments: [],
    commissionRule: GENERAL_PROCEDURE_COMMISSION_RULE,
    sessions: [],
    ...extra,
  }
}

function pay(tr, amountSyp, paidAt) {
  const s = openOrFind(tr, paidAt)
  tr.payments.push({ _id: new mongoose.Types.ObjectId(), amountSyp, currency: 'syp', paidAt, sessionId: s._id })
}

function openOrFind(tr, date) {
  return (tr.sessions || []).find((s) => s.sessionDate === date) || openSession(tr, { sessionDate: date, actor: NURSE })
}

function stubFinanceModels(patients, { doctorPercent = 30, eliasPercent = 0 } = {}) {
  mock.method(Patient, 'find', () => fakeQuery(patients))
  mock.method(User, 'find', () =>
    fakeQuery([{ _id: DOCTOR_ID, name: DOCTOR_NAME, role: 'dental_branch', doctorSharePercent: doctorPercent, active: true }]),
  )
  mock.method(DoctorShareSettings, 'findById', () =>
    Promise.resolve({
      _id: 'default',
      departmentDefaults: { laser: 0, dermatology: 50, dental: 40, skin: 0, solarium: 0 },
      virtualProviders: { elias: eliasPercent },
      seededClinicalDefaults: true,
    }),
  )
  mock.method(PatientDebtSettlement, 'find', () => fakeQuery([]))
}

afterEach(() => mock.restoreAll())

describe('Test A — نسبة العمولة الصحيحة (ثلث وليس 30٪)', () => {
  test('600 محصّل − 100 مستهلكات = 500 → 166.67', () => {
    const tr = cashTreatment({ totalCostSyp: 600 })
    const s = openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    addConsumable(tr, s._id, { name: 'قفازات وخيوط', amountSyp: 100 }, { actor: NURSE })
    tr.payments.push({ amountSyp: 600, paidAt: '2026-11-01', sessionId: s._id })
    const view = buildGeneralTreatmentSessionsView(tr, { decimals: 2 })
    assert.equal(view.sessions[0].collectedSyp, 600)
    assert.equal(view.sessions[0].consumablesSyp, 100)
    assert.equal(view.sessions[0].netSyp, 500)
    assert.equal(view.sessions[0].commissionSyp, 166.67)
    assert.notEqual(view.sessions[0].commissionSyp, 150) // 30٪
    assert.notEqual(view.sessions[0].commissionSyp, 166.5) // 33.3٪
  })

  test('الثلث بالضبط بدقة الليرة (تقريب واحد في النهاية)', () => {
    assert.equal(doctorCommissionFromNet(500_000), 166_667)
    assert.equal(doctorCommissionFromNet(500, { decimals: 2 }), 166.67)
    assert.equal(doctorCommissionFromNet(1_020, { decimals: 2 }), 340)
    assert.equal(doctorCommissionFromNet(0), 0)
  })

  test('الخدمة المالية تستخدم الثلث حتى لو كانت نسبة الطبيب المحفوظة 30٪', async () => {
    const tr = cashTreatment({ totalCostSyp: 600_000 })
    const s = openSession(tr, { sessionDate: '2026-11-03', actor: NURSE })
    addConsumable(tr, s._id, { name: 'مواد', amountSyp: 100_000 }, { actor: NURSE })
    tr.payments.push({ amountSyp: 600_000, paidAt: '2026-11-03', sessionId: s._id })
    stubFinanceModels([{ _id: new mongoose.Types.ObjectId(), name: 'مريض', dentalChart: { generalTreatments: [tr] } }], {
      doctorPercent: 30,
    })
    const sum = await summarizeDentalChartFinance({ from: '2026-11-01', to: '2026-11-30' })
    const row = sum.doctors.find((d) => String(d.userId) === String(DOCTOR_ID))
    assert.equal(row.generalCashBaseSyp, 500_000)
    assert.equal(row.shareSyp, 166_667)
    assert.notEqual(row.shareSyp, 150_000)
    assert.equal(sum.generalConsumablesTotalSyp, 100_000)
  })
})

describe('Test B — الأقساط: كل جلسة على ما حُصّل فيها فقط', () => {
  function installmentsTreatment() {
    const tr = cashTreatment({ totalCostSyp: 1200 })
    const plan = [
      ['2026-11-01', 600, 100],
      ['2026-12-01', 300, 50],
      ['2027-01-01', 300, 30],
    ]
    for (const [date, paid, cons] of plan) {
      const s = openSession(tr, { sessionDate: date, actor: NURSE })
      addConsumable(tr, s._id, { name: `مستهلكات ${date}`, amountSyp: cons }, { actor: NURSE })
      tr.payments.push({ amountSyp: paid, paidAt: date, sessionId: s._id })
    }
    return tr
  }

  test('جدول الجلسات يطابق المتوقع', () => {
    const view = buildGeneralTreatmentSessionsView(installmentsTreatment(), { decimals: 2 })
    assert.deepEqual(
      view.sessions.map((s) => [s.collectedSyp, s.consumablesSyp, s.netSyp, s.commissionSyp]),
      [
        [600, 100, 500, 166.67],
        [300, 50, 250, 83.33],
        [300, 30, 270, 90],
      ],
    )
    assert.equal(view.totals.collectedSyp, 1200)
    assert.equal(view.totals.consumablesSyp, 180)
    assert.equal(view.totals.netSyp, 1020)
    assert.equal(view.totals.commissionSyp, 340)
  })

  test('الجلسة الأولى لا تُحسب على كامل 1200 ولا على غير المحصّل', () => {
    const tr = installmentsTreatment()
    const nov = generalTreatmentNetInRange(tr, '2026-11-01', '2026-11-30')
    assert.deepEqual(nov, { collectedSyp: 600, consumablesSyp: 100, netSyp: 500 })
    const dec = generalTreatmentNetInRange(tr, '2026-12-01', '2026-12-31')
    assert.deepEqual(dec, { collectedSyp: 300, consumablesSyp: 50, netSyp: 250 })
  })

  test('تقارير الأشهر في الخدمة المالية', async () => {
    const tr = installmentsTreatment()
    // بالليرة: نضرب بـ 1000 لنتجنب الكسور
    tr.totalCostSyp *= 1000
    for (const p of tr.payments) p.amountSyp *= 1000
    for (const s of tr.sessions) for (const c of s.consumables) c.amountSyp *= 1000
    const patients = [{ _id: new mongoose.Types.ObjectId(), name: 'مريض', dentalChart: { generalTreatments: [tr] } }]
    const shares = []
    for (const [from, to] of [
      ['2026-11-01', '2026-11-30'],
      ['2026-12-01', '2026-12-31'],
      ['2027-01-01', '2027-01-31'],
    ]) {
      stubFinanceModels(patients)
      const sum = await summarizeDentalChartFinance({ from, to })
      shares.push(sum.doctors.find((d) => String(d.userId) === String(DOCTOR_ID))?.shareSyp ?? 0)
      mock.restoreAll()
    }
    assert.deepEqual(shares, [166_667, 83_333, 90_000])
  })
})

describe('Test C — عزل الجلسات', () => {
  test('إضافة مستهلك للجلسة 2 لا تغيّر الجلسة 1', () => {
    const tr = cashTreatment()
    const s1 = openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    addConsumable(tr, s1._id, { name: 'قفازات', amountSyp: 50 }, { actor: NURSE })
    tr.payments.push({ amountSyp: 600, paidAt: '2026-11-01', sessionId: s1._id })
    const before = buildGeneralTreatmentSessionsView(tr).sessions[0]

    const s2 = openSession(tr, { sessionDate: '2026-11-15', actor: NURSE })
    addConsumable(tr, s2._id, { name: 'براغي شد', amountSyp: 80 }, { actor: NURSE })
    const after = buildGeneralTreatmentSessionsView(tr)
    const money = (x) => [x.collectedSyp, x.consumablesSyp, x.netSyp, x.commissionSyp, x.consumables, x.payments]
    assert.deepEqual(money(after.sessions[0]), money(before))
    assert.equal(after.sessions[1].consumablesSyp, 80)
    assert.equal(after.sessions[0].consumables.length, 1)
  })

  test('فتح جلسة جديدة يغلق الجلسة السابقة؛ والموظف لا يعدّل جلسة مغلقة', () => {
    const tr = cashTreatment()
    const s1 = openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    openSession(tr, { sessionDate: '2026-11-15', actor: NURSE })
    assert.ok(s1.closedAt)
    assert.throws(
      () => addConsumable(tr, s1._id, { name: 'x', amountSyp: 10 }, { actor: NURSE, canCorrectClosed: false }),
      (e) => e.status === 403,
    )
  })

  test('الدفعة تذهب لجلسة يوم التحصيل، لا لجلسة قديمة', () => {
    const tr = cashTreatment()
    openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    const s2 = openSession(tr, { sessionDate: '2026-11-15', actor: NURSE })
    tr.payments.push({ amountSyp: 300, paidAt: '2026-11-15' }) // بلا sessionId محفوظ
    const view = buildGeneralTreatmentSessionsView(tr)
    assert.equal(view.sessions[0].collectedSyp, 0)
    assert.equal(view.sessions[1].collectedSyp, 300)
    assert.equal(view.sessions[1].id, String(s2._id))
  })
})

describe('Test D — تصحيح جلسة مغلقة', () => {
  function closedTwoSessions() {
    const tr = cashTreatment()
    const s1 = openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    addConsumable(tr, s1._id, { name: 'مستهلكات', amountSyp: 100 }, { actor: NURSE })
    tr.payments.push({ amountSyp: 600, paidAt: '2026-11-01', sessionId: s1._id })
    const s2 = openSession(tr, { sessionDate: '2026-12-01', actor: NURSE })
    addConsumable(tr, s2._id, { name: 'مستهلكات', amountSyp: 50 }, { actor: NURSE })
    tr.payments.push({ amountSyp: 300, paidAt: '2026-12-01', sessionId: s2._id })
    closeSession(tr, s2._id, { actor: NURSE })
    return { tr, s1, s2 }
  }

  test('إضافة 20 منسية للجلسة 1 → 120 مستهلكات، 480 صافي، 160 عمولة؛ الجلسة 2 لا تتغير', () => {
    const { tr, s1 } = closedTwoSessions()
    const s2Before = buildGeneralTreatmentSessionsView(tr, { decimals: 2 }).sessions[1]
    addConsumable(
      tr,
      s1._id,
      { name: 'خيط جراحي منسي', amountSyp: 20 },
      { actor: ADMIN, canCorrectClosed: true, reason: 'نُسي تسجيله', businessDate: '2026-12-10' },
    )
    const view = buildGeneralTreatmentSessionsView(tr, { decimals: 2 })
    assert.equal(view.sessions[0].consumablesSyp, 120)
    assert.equal(view.sessions[0].netSyp, 480)
    assert.equal(view.sessions[0].commissionSyp, 160)
    assert.equal(view.sessions[0].consumables.at(-1).addedByName, ADMIN.name)
    assert.deepEqual(view.sessions[1], s2Before)
  })

  test('التصحيح يتطلب سبباً ومدير نظام', () => {
    const { tr, s1 } = closedTwoSessions()
    assert.throws(
      () => addConsumable(tr, s1._id, { name: 'x', amountSyp: 20 }, { actor: ADMIN, canCorrectClosed: true }),
      (e) => e.status === 400,
    )
    assert.throws(
      () => addConsumable(tr, s1._id, { name: 'x', amountSyp: 20 }, { actor: NURSE, reason: 'r' }),
      (e) => e.status === 403,
    )
  })

  test('سجل التدقيق يحفظ القيم قبل وبعد، والحذف منطقي', () => {
    const { tr, s1 } = closedTwoSessions()
    const row = addConsumable(
      tr,
      s1._id,
      { name: 'خيط', amountSyp: 20 },
      { actor: ADMIN, canCorrectClosed: true, reason: 'نُسي', businessDate: '2026-12-10' },
    )
    removeConsumable(tr, s1._id, row._id, {
      actor: ADMIN,
      canCorrectClosed: true,
      reason: 'إدخال مكرر',
      businessDate: '2026-12-11',
    })
    const adj = s1.adjustments
    assert.equal(adj.length, 2)
    assert.equal(adj[0].action, 'consumable_added')
    assert.equal(adj[0].previousConsumablesSyp, 100)
    assert.equal(adj[0].newConsumablesSyp, 120)
    assert.equal(adj[0].byName, ADMIN.name)
    assert.ok(adj[0].at instanceof Date)
    assert.equal(adj[1].action, 'consumable_removed')
    assert.equal(adj[1].previousConsumablesSyp, 120)
    assert.equal(adj[1].newConsumablesSyp, 100)
    // المستهلك المحذوف يبقى ظاهراً في السجل
    const view = buildGeneralTreatmentSessionsView(tr)
    assert.equal(view.sessions[0].consumables.length, 2)
    assert.equal(view.sessions[0].consumables[1].removed, true)
    assert.equal(view.sessions[0].consumablesSyp, 100)
  })
})

describe('Test E — عمولة سبق تسجيلها/دفعها', () => {
  test('فرق العمولة يظهر كتسوية بتاريخ التصحيح ولا يغيّر الشهر السابق', async () => {
    const tr = cashTreatment({ totalCostSyp: 900_000 })
    const s1 = openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    addConsumable(tr, s1._id, { name: 'مستهلكات', amountSyp: 100_000 }, { actor: NURSE })
    tr.payments.push({ amountSyp: 600_000, paidAt: '2026-11-01', sessionId: s1._id })
    closeSession(tr, s1._id, { actor: NURSE })
    const patients = [{ _id: new mongoose.Types.ObjectId(), name: 'مريض', dentalChart: { generalTreatments: [tr] } }]

    const shareFor = async (from, to) => {
      stubFinanceModels(patients)
      const sum = await summarizeDentalChartFinance({ from, to })
      mock.restoreAll()
      return sum.doctors.find((d) => String(d.userId) === String(DOCTOR_ID))?.shareSyp ?? 0
    }
    const novBefore = await shareFor('2026-11-01', '2026-11-30')
    assert.equal(novBefore, 166_667) // سُجّلت/دُفعت للطبيب عن تشرين الثاني

    addConsumable(
      tr,
      s1._id,
      { name: 'منسي', amountSyp: 20_000 },
      { actor: ADMIN, canCorrectClosed: true, reason: 'نُسي', businessDate: '2026-12-10' },
    )
    assert.equal(await shareFor('2026-11-01', '2026-11-30'), novBefore) // لا تغيير صامت
    const dec = await shareFor('2026-12-01', '2026-12-31')
    assert.equal(dec, -6_667) // تسوية صريحة: (−20,000) ÷ 3
    const adj = s1.adjustments[0]
    assert.equal(adj.previousCommissionSyp, 166_667)
    assert.equal(adj.newCommissionSyp, 160_000)
    assert.equal(adj.commissionDeltaSyp, -6_667)
    assert.equal(adj.businessDate, '2026-12-10')
    // الدفعة الأصلية لم تُلمس
    assert.equal(tr.payments[0].amountSyp, 600_000)
    assert.equal(tr.payments[0].paidAt, '2026-11-01')
    // قيد التصحيح ظاهر في تقرير العيادات
    stubFinanceModels(patients)
    const list = await listDentalClinicSessions({ from: '2026-12-01', to: '2026-12-31' })
    const corr = list.rows.filter((r) => r.kind === 'consumable' && r.isCorrection)
    assert.equal(corr.length, 1)
    assert.equal(corr[0].amountSyp, 20_000)
    assert.equal(corr[0].sessionDate, '2026-11-01')
  })
})

describe('Test F — عمولات الأخصائيين والصندوق', () => {
  test('حصة أخصائي الليزر = الإيراد المحصّل × نسبته الخاصة (لا ثلث)', async () => {
    const spId = new mongoose.Types.ObjectId()
    mock.method(User, 'find', () =>
      fakeQuery([{ _id: spId, name: 'أخصائية ليزر', active: true, doctorSharePercent: 10 }]),
    )
    const items = [{ department: 'laser', providerUserId: spId, paymentId: 'p1' }]
    const payById = new Map([['p1', { amountSyp: 1_000_000 }]])
    const out = await computeLaserSpecialistShares({ items, payById })
    assert.equal(out.specialists[0].sharePercent, 10)
    assert.equal(out.specialists[0].shareSyp, 100_000)
    assert.equal(out.specialistSharesTotalSyp, 100_000)
  })

  test('ربح الليزر يطرح حصص الأخصائيين مرة واحدة', () => {
    assert.equal(
      laserProfitSyp({ revenueSyp: 1_000_000, expensesSyp: 200_000, specialistSharesSyp: 100_000 }),
      700_000,
    )
    assert.equal(laserProfitSyp({ revenueSyp: 500_000, expensesSyp: 0, specialistSharesSyp: 0 }), 500_000)
  })

  test('الصندوق = التحصيل − المصاريف اليدوية + المقبوضات؛ لا خصم تلقائي للعمولات', () => {
    const items = [{ department: 'laser', paymentId: 'p1' }]
    const payById = new Map([
      ['p1', { payCurrency: 'SYP', receivedAmountSyp: 1_000_000, paymentChannel: 'cash' }],
    ])
    const rollup = aggregateReceptionPaidItems(items, payById)
    const payload = composeReceptionInventoryPayload(
      rollup,
      [{ _id: 'm1', kind: 'expense', reason: 'دفع حصة أخصائية', amountSyp: 100_000 }],
      0,
      { businessDate: '2026-11-16', dayActive: true, usdSypRate: null },
    )
    // العمولة لا تُخصم إلا إذا سجّلها المدير يدوياً كمصروف — وتُخصم مرة واحدة فقط
    assert.equal(payload.summary.cashBase.totalSyp, 1_000_000)
    assert.equal(payload.summary.cash.totalSyp, 900_000)
  })
})

describe('Test G — مسار الإجراءات العامة الكامل', () => {
  test('حفظ إجراء جديد → تحصيل استقبال جزئي → تسديد ذمة → التقارير', async () => {
    // 1) إجراء جديد عبر دمج حفظ المخطط: يأخذ قاعدة الجلسات تلقائياً، والقديم يبقى قديماً
    const legacyId = new mongoose.Types.ObjectId()
    const newId = new mongoose.Types.ObjectId()
    const merged = mergePreviousGeneralBillingLinks(
      [{ _id: legacyId, totalCostSyp: 50_000, billingItemId: null, payments: [] }],
      [
        { _id: legacyId, totalCostSyp: 50_000, payments: [] },
        { _id: newId, totalCostSyp: 1_200_000, payments: [], commissionRule: '', sessions: [{ fake: 1 }] },
      ],
    )
    assert.equal(merged[0].commissionRule, '')
    assert.equal(merged[1].commissionRule, GENERAL_PROCEDURE_COMMISSION_RULE)
    assert.deepEqual(merged[1].sessions, []) // لا تُقبل جلسات من العميل

    const billingItemId = new mongoose.Types.ObjectId()
    const csId = new mongoose.Types.ObjectId()
    const patient = new Patient({
      fileNumber: 'T-1',
      name: 'مريض اختبار',
      dentalChart: {
        teeth: [],
        generalTreatments: [
          {
            _id: newId,
            procedureDescription: 'تقويم شفاف',
            totalCostSyp: 1_200_000,
            doctorName: DOCTOR_NAME,
            providerUserId: DOCTOR_ID,
            businessDate: '2026-11-01',
            billingItemId,
            clinicalSessionId: csId,
            commissionRule: GENERAL_PROCEDURE_COMMISSION_RULE,
          },
        ],
      },
    })
    mock.method(patient, 'save', () => Promise.resolve(patient))
    mock.method(Patient, 'findById', () => Promise.resolve(patient))
    mock.method(ClinicalSession, 'findById', () => fakeQuery({ _id: csId, dentalTreatmentId: String(newId) }))
    // تسوية المخابر بعد التحصيل لا تخص هذا الاختبار
    mock.method(BillingItem, 'find', () => fakeQuery([]))

    // 2) الجلسة 1: المساعدة تضيف المستهلكات، والاستقبال يحصّل 600 ألف من 1.2 مليون
    const tr = patient.dentalChart.generalTreatments[0]
    const s1 = openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    addConsumable(tr, s1._id, { name: 'قفازات + خيوط', amountSyp: 100_000 }, { actor: NURSE })
    const ok = await applyDentalBillingPaymentToChart(
      { _id: billingItemId, department: 'dental', clinicalSessionId: csId, patientId: patient._id, amountDueSyp: 1_200_000 },
      { amountSyp: 600_000, creditAppliedSyp: 0, payCurrency: 'SYP', createdAt: new Date('2026-11-01T10:00:00Z') },
    )
    assert.equal(ok, true)
    assert.equal(String(tr.payments[0].sessionId), String(s1._id))

    // 3) الجلسة 2: تسديد ذمة 300 ألف (قسط) — تُنشأ جلسة اليوم تلقائياً وتُربط بها
    await applyDentalDebtAllocationsToChart(
      patient._id,
      [{ department: 'dental', amountSyp: 300_000, billingItemId }],
      { paidAt: '2026-12-01', note: 'تسديد ذمة' },
    )
    const s2 = tr.sessions.find((s) => s.sessionDate === '2026-12-01')
    assert.ok(s2, 'جلسة القسط أُنشئت')
    assert.ok(s1.closedAt, 'الجلسة السابقة أُغلقت')
    assert.equal(String(tr.payments[1].sessionId), String(s2._id))
    addConsumable(tr, s2._id, { name: 'براغي شد', amountSyp: 50_000 }, { actor: NURSE })

    const plain = patient.toObject()
    const patients = [{ ...plain, dentalChart: plain.dentalChart }]

    // 4) تقرير المالية لكل شهر
    stubFinanceModels(patients)
    const nov = await summarizeDentalChartFinance({ from: '2026-11-01', to: '2026-11-30' })
    mock.restoreAll()
    stubFinanceModels(patients)
    const dec = await summarizeDentalChartFinance({ from: '2026-12-01', to: '2026-12-31' })
    mock.restoreAll()
    const novRow = nov.doctors.find((d) => String(d.userId) === String(DOCTOR_ID))
    const decRow = dec.doctors.find((d) => String(d.userId) === String(DOCTOR_ID))
    assert.equal(novRow.shareSyp, 166_667) // (600−100)÷3 — لا على 1.2 مليون
    assert.equal(decRow.shareSyp, 83_333) // (300−50)÷3
    assert.equal(nov.totalRevenueSyp, 1_200_000) // الإيراد كما كان (سعر الإجراء بتاريخه)

    // 5) تقرير عيادات الأسنان يعرض التحصيل والمستهلكات لكل جلسة
    stubFinanceModels(patients)
    const decList = await listDentalClinicSessions({ from: '2026-12-01', to: '2026-12-31' })
    const clinic = decList.clinics.find((c) => c.key === String(DOCTOR_ID))
    assert.equal(clinic.cashRuleCollectedSyp, 300_000)
    assert.equal(clinic.cashRuleConsumablesSyp, 50_000)
    assert.equal(clinic.shareSyp, 83_333)
    assert.equal(decList.rows.filter((r) => r.kind === 'collection').length, 1)

    // 6) التقرير النهائي للمريض
    const report = buildGeneralProceduresReport(plain.dentalChart)
    assert.equal(report.totals.sessionCount, 2)
    assert.equal(report.totals.collectedSyp, 900_000)
    assert.equal(report.totals.remainingSyp, 300_000)
    assert.equal(report.totals.consumablesSyp, 150_000)
    assert.equal(report.totals.commissionSyp, 166_667 + 83_333)
  })
})

describe('Test H — سلامة السجلات التاريخية ومنع الخصم المكرر', () => {
  test('إجراء عام قديم (بلا قاعدة) يُحسب كما كان تماماً', async () => {
    const legacy = {
      _id: new mongoose.Types.ObjectId(),
      procedureDescription: 'تنظيف',
      totalCostSyp: 500_000,
      doctorName: DOCTOR_NAME,
      providerUserId: DOCTOR_ID,
      businessDate: '2026-11-05',
      payments: [{ amountSyp: 200_000, paidAt: '2026-11-05' }],
    }
    const tooth = {
      fdi: 11,
      treatments: [
        { _id: new mongoose.Types.ObjectId(), totalCostSyp: 300_000, doctorName: DOCTOR_NAME, providerUserId: DOCTOR_ID, businessDate: '2026-11-06', payments: [] },
      ],
      labWorks: [],
    }
    stubFinanceModels(
      [{ _id: new mongoose.Types.ObjectId(), name: 'مريض', dentalChart: { teeth: [tooth], generalTreatments: [legacy] } }],
      { doctorPercent: 30 },
    )
    const sum = await summarizeDentalChartFinance({ from: '2026-11-01', to: '2026-11-30' })
    const row = sum.doctors.find((d) => String(d.userId) === String(DOCTOR_ID))
    // القاعدة القديمة: (500,000 + 300,000) × 30٪ = 240,000 (بلا تغيير)
    assert.equal(row.shareSyp, 240_000)
    assert.equal(row.generalCashBaseSyp, 0)
    assert.equal(sum.otherShareSyp + sum.ayhamShareSyp + sum.iyadShareSyp + sum.omarShareSyp + sum.eliasShareSyp, sum.doctorSharesTotalSyp)
  })

  test('لا تُضاف جلسات أو مستهلكات لإجراء قديم', () => {
    const legacy = cashTreatment({ commissionRule: '' })
    assert.throws(() => openSession(legacy, { sessionDate: '2026-11-01' }), (e) => e.status === 400)
    assert.deepEqual(generalTreatmentCommissionEntries(legacy), [])
  })

  test('كل مستهلك يُخصم مرة واحدة فقط عبر كل الفترات والتقارير', () => {
    const tr = cashTreatment()
    const s1 = openSession(tr, { sessionDate: '2026-11-01', actor: NURSE })
    const c1 = addConsumable(tr, s1._id, { name: 'a', amountSyp: 100 }, { actor: NURSE })
    const c2 = addConsumable(tr, s1._id, { name: 'b', amountSyp: 40 }, { actor: NURSE })
    removeConsumable(tr, s1._id, c2._id, { actor: NURSE }) // حُذف قبل الإغلاق → بلا أثر
    tr.payments.push({ amountSyp: 600, paidAt: '2026-11-01', sessionId: s1._id })
    closeSession(tr, s1._id, { actor: NURSE })
    removeConsumable(tr, s1._id, c1._id, {
      actor: ADMIN,
      canCorrectClosed: true,
      reason: 'لم يُستخدم',
      businessDate: '2026-12-02',
    })
    assert.throws(() => removeConsumable(tr, s1._id, c1._id, { actor: ADMIN, canCorrectClosed: true, reason: 'x' }))
    const allTime = generalTreatmentNetInRange(tr, '2000-01-01', '2100-12-31')
    const view = buildGeneralTreatmentSessionsView(tr)
    assert.equal(allTime.netSyp, view.totals.netSyp) // مجموع الفترات = حساب الجلسة الحالي
    assert.equal(view.totals.consumablesSyp, 0)
    assert.equal(allTime.collectedSyp, 600)
  })

  test('مجموع عمولات الفترات = عمولة الإجراء الكاملة (بلا تكرار)', () => {
    const tr = cashTreatment()
    for (const [d, p, c] of [
      ['2026-11-01', 600, 100],
      ['2026-12-01', 300, 50],
      ['2027-01-01', 300, 30],
    ]) {
      const s = openSession(tr, { sessionDate: d, actor: NURSE })
      addConsumable(tr, s._id, { name: 'x', amountSyp: c }, { actor: NURSE })
      tr.payments.push({ amountSyp: p, paidAt: d, sessionId: s._id })
    }
    const months = [
      ['2026-11-01', '2026-11-30'],
      ['2026-12-01', '2026-12-31'],
      ['2027-01-01', '2027-01-31'],
    ].map(([f, t]) => generalTreatmentNetInRange(tr, f, t).netSyp)
    assert.equal(months.reduce((a, b) => a + b, 0), 1020)
  })
})
