/**
 * إصلاح الباكجات القديمة التي خُصمت عند تحصيلها قبل تحديث الخصومات.
 *
 * الخطأ القديم (مثال 500,000 − 20٪، المقبوض 400,000):
 *  - بقي سعر الباكج المعتمد 500,000 فأُضيف 100,000 كذمة على المريض.
 *  - طُبّق الخصم ثانيةً على بند الشراء فرُحّل إيراد 320,000 بدل 400,000.
 *
 * هذا الملف يحسب التصحيح لكل باكج متأثر (دالة صافية) ثم يطبّقه عند الطلب فقط:
 *  - سعر الباكج = السعر بعد الخصم، مع حفظ الأصلي والخصم.
 *  - إنقاص ذمة المريض بالمبلغ الزائد (أو إضافة الرصيد الناقص).
 *  - سجل خصم بالوقت ومستلم الدفعة الفعليين (من الدفعة نفسها).
 *  - سجل تدقيق.
 * لا يلمس قيود الصندوق/الدفتر: فرق الإيراد يُعرض فقط ليقرّره المحاسب.
 */
import { Patient } from '../models/Patient.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { DiscountRecord } from '../models/DiscountRecord.js'
/** يسجّل نموذج User لأن populate('receivedBy') يحتاجه حين يعمل السكربت خارج الخادم */
import '../models/User.js'
import { writeAudit } from '../utils/audit.js'
import { amountFromPercent, percentFromAmount } from './discountMath.js'
import { isLegacyPackagePurchaseItem, matchLegacyPurchaseToPackage } from './discountRecords.js'

const money = (n) => Math.round(Number(n) || 0)

/**
 * يحسب خطة الإصلاح لمريض واحد (بلا قاعدة بيانات).
 *
 * @param {{ patient: object, billingItems: object[], paymentsByItemId: Map<string, object>, packagesWithRecords?: Set<string> }} input
 * @returns {object[]} سطر لكل باكج متأثر
 */
export function planLegacyPackageDiscountRepairs({ patient, billingItems, paymentsByItemId, packagesWithRecords = new Set() }) {
  const packages = Array.isArray(patient.sessionPackages) ? patient.sessionPackages : []
  const taken = new Set()
  const plans = []
  let debtLeft = money(patient.outstandingDebtSyp)

  for (const bi of billingItems) {
    if (!isLegacyPackagePurchaseItem(bi)) continue
    const pay = paymentsByItemId.get(String(bi._id))
    const pct = Number(pay?.discountPercent) || 0
    if (!(pct > 0)) continue
    const pkg = matchLegacyPurchaseToPackage(bi, packages, taken)
    if (!pkg) continue
    const pkgId = String(pkg._id)
    taken.add(pkgId)
    if (money(pkg.listPriceSyp) > 0 || packagesWithRecords.has(pkgId)) continue

    const listPriceSyp = money(pkg.packageTotalSyp)
    const discountAmountSyp = amountFromPercent(listPriceSyp, pct)
    const correctTotalSyp = listPriceSyp - discountAmountSyp
    const paidSyp = money(pkg.paidAmountSyp)
    const oldDebtAdded = Math.max(0, listPriceSyp - paidSyp)
    const newDebtAdded = Math.max(0, correctTotalSyp - paidSyp)
    const oldCreditAdded = Math.max(0, paidSyp - listPriceSyp)
    const newCreditAdded = Math.max(0, paidSyp - correctTotalSyp)
    const debtReductionSyp = oldDebtAdded - newDebtAdded
    const creditIncreaseSyp = newCreditAdded - oldCreditAdded
    /** الإيراد المرحّل = المطبّق على البند (بعد الخصم الثاني)؛ المقبوض فعلاً = المبلغ المدفوع */
    const revenueUnderstatedSyp = Math.max(0, paidSyp - money(pay.amountSyp) - money(pay.creditAppliedSyp))

    let status = 'ready'
    let reason = ''
    if (!(discountAmountSyp > 0)) {
      status = 'skip'
      reason = 'لا فرق بعد الخصم'
    } else if (debtReductionSyp > debtLeft) {
      status = 'manual_review'
      reason = `ذمة المريض الحالية (${debtLeft}) أقل من الذمة الزائدة (${debtReductionSyp}) — ربما سُدّدت لاحقاً؛ يحتاج قراراً يدوياً`
    }
    if (status === 'ready') debtLeft -= debtReductionSyp

    plans.push({
      patientId: String(patient._id),
      patientName: String(patient.name || ''),
      fileNumber: String(patient.fileNumber || ''),
      packageId: pkgId,
      packageTitle: String(pkg.title || ''),
      department: String(pkg.department || 'laser'),
      purchaseBillingItemId: String(bi._id),
      paymentId: pay?._id ? String(pay._id) : '',
      discountPercent: pct,
      listPriceSyp,
      discountAmountSyp,
      correctTotalSyp,
      paidSyp,
      debtReductionSyp,
      creditIncreaseSyp,
      revenueUnderstatedSyp,
      appliedAt: pay?.receivedAt || null,
      appliedByUserId: pay?.receivedBy?._id || pay?.receivedBy || null,
      appliedByName: String(pay?.receivedBy?.name || pay?.receivedByName || ''),
      status,
      reason,
    })
  }
  return plans
}

/** يجمع الخطط لكل المرضى (أو مريض واحد) من قاعدة البيانات — قراءة فقط */
export async function collectLegacyPackageDiscountRepairs({ patientId = null } = {}) {
  const filter = { 'sessionPackages.0': { $exists: true } }
  if (patientId) filter._id = patientId
  const patients = await Patient.find(filter)
    .select('_id name fileNumber outstandingDebtSyp prepaidCreditSyp sessionPackages')
    .lean()
  const all = []
  for (const patient of patients) {
    const billingItems = await BillingItem.find({ patientId: patient._id, status: 'paid' }).lean()
    const candidates = billingItems.filter(isLegacyPackagePurchaseItem)
    if (!candidates.length) continue
    const payments = await BillingPayment.find({ billingItemId: { $in: candidates.map((b) => b._id) } })
      .populate('receivedBy', 'name')
      .lean()
    const paymentsByItemId = new Map(payments.map((p) => [String(p.billingItemId), p]))
    const recPkgIds = await DiscountRecord.distinct('packageId', { patientId: patient._id, targetType: 'patient_package' })
    all.push(
      ...planLegacyPackageDiscountRepairs({
        patient,
        billingItems: candidates,
        paymentsByItemId,
        packagesWithRecords: new Set(recPkgIds.map(String)),
      }),
    )
  }
  return all
}

/** يطبّق خطة «ready» واحدة. يعيد التحقق قبل الكتابة حتى لا يُطبَّق مرتين. */
export async function applyLegacyPackageDiscountRepair(plan, user) {
  if (plan.status !== 'ready') return { applied: false, reason: 'not_ready' }
  const patient = await Patient.findById(plan.patientId)
  if (!patient) return { applied: false, reason: 'patient_missing' }
  const pkg = (patient.sessionPackages || []).find((p) => String(p._id) === plan.packageId)
  if (!pkg) return { applied: false, reason: 'package_missing' }
  if (money(pkg.listPriceSyp) > 0 || money(pkg.packageTotalSyp) !== plan.listPriceSyp) {
    return { applied: false, reason: 'already_changed' }
  }
  const debtBefore = money(patient.outstandingDebtSyp)
  const creditBefore = money(patient.prepaidCreditSyp)
  if (plan.debtReductionSyp > debtBefore) return { applied: false, reason: 'debt_changed' }

  pkg.listPriceSyp = plan.listPriceSyp
  pkg.discountAmountSyp = plan.discountAmountSyp
  pkg.discountPercent = Math.min(100, percentFromAmount(plan.listPriceSyp, plan.discountAmountSyp))
  pkg.packageTotalSyp = plan.correctTotalSyp
  pkg.settlementDeltaSyp = plan.paidSyp - plan.correctTotalSyp
  patient.outstandingDebtSyp = debtBefore - plan.debtReductionSyp
  patient.prepaidCreditSyp = creditBefore + plan.creditIncreaseSyp
  await patient.save()

  await DiscountRecord.create({
    patientId: patient._id,
    department: plan.department,
    targetType: 'patient_package',
    packageId: plan.packageId,
    serviceLabel: plan.packageTitle,
    sequence: 1,
    basis: 'list',
    entryMode: 'percent',
    listPriceSyp: plan.listPriceSyp,
    priceBeforeSyp: plan.listPriceSyp,
    discountPercent: plan.discountPercent,
    discountAmountSyp: plan.discountAmountSyp,
    priceAfterSyp: plan.correctTotalSyp,
    source: 'package_sale',
    appliedByUserId: plan.appliedByUserId || null,
    appliedByName: plan.appliedByName,
    appliedAt: plan.appliedAt || undefined,
    note: 'مُرحَّل من دفعة شراء الباكج (إصلاح خصم الباكج القديم)',
  })

  await writeAudit({
    user,
    action: 'إصلاح خصم باكج قديم (ذمة زائدة)',
    entityType: 'Patient',
    entityId: patient._id,
    details: {
      ...plan,
      debtBefore,
      debtAfter: patient.outstandingDebtSyp,
      creditBefore,
      creditAfter: patient.prepaidCreditSyp,
    },
  })
  return { applied: true }
}
