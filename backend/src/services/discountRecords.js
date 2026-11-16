/**
 * سجل الخصومات المستقل + بناء عرض «الأسعار والخصومات» في نظرة المريض العامة.
 *
 * مبدأ أساسي: هذا الملف لا يُنشئ أي حركة مالية ولا يغيّر ذمة/رصيد المريض.
 * السعر النهائي المعروض يُقرأ دائماً من السجل المالي المعتمد (BillingItem / الباكج)،
 * وسجلات الخصم تشرح كيف وصلنا إليه (من، متى، كم، وبأي ترتيب).
 */
import { DiscountRecord } from '../models/DiscountRecord.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { LaserSession } from '../models/LaserSession.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { AuditLog } from '../models/AuditLog.js'
import { displayPercent, amountFromPercent, percentFromAmount } from './discountMath.js'

const SOURCE_LABELS = {
  payment: 'عند التحصيل',
  laser_session: 'عند تسجيل جلسة الليزر',
  dermatology_session: 'عند تسجيل جلسة الجلدية',
  dermatology_visit: 'عند تسجيل زيارة الجلدية',
  package_sale: 'عند بيع الباكج',
  package_price: 'تخفيض سعر الباكج عن سعر القالب',
  admin_edit: 'تعديل من مدير النظام',
}

export function discountSourceLabel(source) {
  return SOURCE_LABELS[source] || 'خصم'
}

function idStr(v) {
  if (v == null) return ''
  if (typeof v === 'object' && v._id) return String(v._id)
  return String(v)
}

function iso(d) {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function money(n) {
  return Math.round(Number(n) || 0)
}

/* ------------------------------------------------------------------ */
/* الكتابة                                                             */
/* ------------------------------------------------------------------ */

/**
 * يسجّل خصماً جديداً كسطر مستقل. لا يرمي أبداً: فشل التسجيل لا يجوز أن يُفشل عملية مالية نجحت.
 *
 * @param {{
 *   patientId: unknown, department?: string, targetType: 'billing_item'|'patient_package'|'dermatology_visit',
 *   billingItemId?: unknown, clinicalSessionId?: unknown, laserSessionId?: unknown, dermatologyVisitId?: unknown,
 *   packageId?: string, serviceLabel?: string,
 *   entry: { entryMode: 'percent'|'amount', discountPercent: number, discountAmountSyp: number, priceBeforeSyp: number, priceAfterSyp: number },
 *   listPriceSyp?: number, basis?: 'list'|'remaining', source: string,
 *   user?: { _id?: unknown, name?: string } | null, appliedAt?: Date, note?: string, correctsRecordIds?: unknown[],
 * }} opts
 */
export async function recordDiscount(opts) {
  try {
    const { entry } = opts
    if (!entry || !(Number(entry.discountAmountSyp) > 0)) return null
    const targetFilter = discountTargetFilter(opts)
    const prior = targetFilter ? await DiscountRecord.countDocuments(targetFilter) : 0
    const doc = await DiscountRecord.create({
      patientId: opts.patientId,
      department: String(opts.department || ''),
      targetType: opts.targetType,
      billingItemId: opts.billingItemId || null,
      clinicalSessionId: opts.clinicalSessionId || null,
      laserSessionId: opts.laserSessionId || null,
      dermatologyVisitId: opts.dermatologyVisitId || null,
      packageId: opts.packageId ? String(opts.packageId) : '',
      serviceLabel: String(opts.serviceLabel || '').slice(0, 300),
      sequence: prior + 1,
      basis: opts.basis === 'remaining' ? 'remaining' : 'list',
      entryMode: entry.entryMode === 'amount' ? 'amount' : 'percent',
      listPriceSyp: money(opts.listPriceSyp ?? entry.priceBeforeSyp),
      priceBeforeSyp: money(entry.priceBeforeSyp),
      discountPercent: Math.min(100, Math.max(0, Number(entry.discountPercent) || 0)),
      discountAmountSyp: money(entry.discountAmountSyp),
      priceAfterSyp: money(entry.priceAfterSyp),
      source: opts.source,
      appliedByUserId: opts.user?._id || null,
      appliedByName: String(opts.user?.name || '').trim(),
      appliedAt: opts.appliedAt || new Date(),
      note: String(opts.note || '').slice(0, 500),
      correctsRecordIds: Array.isArray(opts.correctsRecordIds) ? opts.correctsRecordIds : [],
    })
    if (Array.isArray(opts.correctsRecordIds) && opts.correctsRecordIds.length) {
      await DiscountRecord.updateMany(
        { _id: { $in: opts.correctsRecordIds } },
        { $set: { replacedByRecordId: doc._id } },
      )
    }
    return doc
  } catch (err) {
    console.error('recordDiscount:', err)
    return null
  }
}

function discountTargetFilter(opts) {
  if (opts.targetType === 'billing_item' && opts.billingItemId) {
    return { billingItemId: opts.billingItemId }
  }
  if (opts.targetType === 'patient_package' && opts.packageId) {
    return { patientId: opts.patientId, packageId: String(opts.packageId) }
  }
  if (opts.targetType === 'dermatology_visit' && opts.dermatologyVisitId) {
    return { dermatologyVisitId: opts.dermatologyVisitId }
  }
  return null
}

/** السجلات الفعّالة لبند فوترة بالترتيب */
export async function activeDiscountRecordsForBillingItem(billingItemId) {
  try {
    return await DiscountRecord.find({ billingItemId, status: 'active' }).sort({ sequence: 1, appliedAt: 1 }).lean()
  } catch (err) {
    console.error('activeDiscountRecordsForBillingItem:', err)
    return []
  }
}

/**
 * يعلّم السجلات الفعّالة لبند كـ«ملغاة» (دون حذف) ويُرجع معرّفاتها لربطها بالسجل المصحِّح.
 */
export async function reverseActiveDiscountsForBillingItem(billingItemId, { user, reason } = {}) {
  try {
    const rows = await DiscountRecord.find({ billingItemId, status: 'active' }).select('_id').lean()
    if (!rows.length) return []
    const ids = rows.map((r) => r._id)
    await DiscountRecord.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'reversed',
          reversedAt: new Date(),
          reversedByUserId: user?._id || null,
          reversedByName: String(user?.name || '').trim(),
          reversalReason: String(reason || '').slice(0, 500),
        },
      },
    )
    return ids
  } catch (err) {
    console.error('reverseActiveDiscountsForBillingItem:', err)
    return []
  }
}

/* ------------------------------------------------------------------ */
/* العرض — دوال صافية                                                 */
/* ------------------------------------------------------------------ */

function recordToDto(r) {
  return {
    id: idStr(r._id),
    sequence: Number(r.sequence) || 1,
    status: r.status === 'reversed' ? 'reversed' : 'active',
    basis: r.basis === 'remaining' ? 'remaining' : 'list',
    entryMode: r.entryMode === 'amount' ? 'amount' : 'percent',
    percent: displayPercent(r.discountPercent),
    amountSyp: money(r.discountAmountSyp),
    priceBeforeSyp: money(r.priceBeforeSyp),
    priceAfterSyp: money(r.priceAfterSyp),
    appliedAt: iso(r.appliedAt),
    appliedByName: String(r.appliedByName || '').trim() || null,
    source: r.source,
    sourceLabel: discountSourceLabel(r.source),
    historical: false,
    reversedAt: iso(r.reversedAt),
    reversedByName: String(r.reversedByName || '').trim() || null,
    reversalReason: String(r.reversalReason || '').trim() || null,
    isCorrection: Array.isArray(r.correctsRecordIds) && r.correctsRecordIds.length > 0,
    note: String(r.note || '').trim() || null,
  }
}

function legacyDiscount({ key, sequence, basis, percent, amountSyp, priceBeforeSyp, appliedAt, appliedByName, source, note }) {
  const amount = money(amountSyp)
  const before = money(priceBeforeSyp)
  return {
    id: `legacy:${key}`,
    sequence,
    status: 'active',
    basis,
    entryMode: 'percent',
    percent: displayPercent(percent != null ? percent : percentFromAmount(before, amount)),
    amountSyp: amount,
    priceBeforeSyp: before,
    priceAfterSyp: before - amount,
    appliedAt: iso(appliedAt),
    appliedByName: appliedByName ? String(appliedByName).trim() || null : null,
    source,
    sourceLabel: discountSourceLabel(source),
    /** مستخرج من بيانات قديمة — لا يُختلق ما لم يُسجَّل */
    historical: true,
    reversedAt: null,
    reversedByName: null,
    reversalReason: null,
    isCorrection: false,
    note: note || null,
  }
}

function sortRecords(rows) {
  return [...rows].sort((a, b) => {
    const s = (Number(a.sequence) || 0) - (Number(b.sequence) || 0)
    if (s !== 0) return s
    return new Date(a.appliedAt || 0).getTime() - new Date(b.appliedAt || 0).getTime()
  })
}

function finalizeService(svc) {
  const active = svc.discounts.filter((d) => d.status === 'active')
  const totalDiscountSyp = Math.max(0, svc.originalPriceSyp - svc.finalPriceSyp)
  const sumActive = active.reduce((s, d) => s + d.amountSyp, 0)
  const notes = [...(svc.notes || [])]
  if (active.length && sumActive !== totalDiscountSyp) {
    notes.push(
      'مجموع الخصومات المسجّلة لا يطابق الفرق بين السعر الأصلي والسعر النهائي — المعتمد هو السعر النهائي من السجل المالي.',
    )
  }
  return {
    ...svc,
    discounts: svc.discounts,
    hasDiscount: active.length > 0 || totalDiscountSyp > 0,
    totalDiscountSyp,
    totalDiscountPercent: displayPercent(percentFromAmount(svc.originalPriceSyp, totalDiscountSyp)),
    activeDiscountsTotalSyp: sumActive,
    historical: svc.discounts.some((d) => d.historical),
    notes,
  }
}

const PACKAGE_PURCHASE_LABEL = 'باكج مسبق الدفع'

export function isLegacyPackagePurchaseItem(bi) {
  return (
    !bi.packagePurchaseId &&
    bi.isPackagePrepaid !== true &&
    String(bi.procedureLabel || '').includes(PACKAGE_PURCHASE_LABEL)
  )
}

/** يربط بند شراء باكج قديم بالباكج الأقرب (نفس القسم والمبلغ وخلال 30 دقيقة) */
export function matchLegacyPurchaseToPackage(bi, packages, taken) {
  const biT = new Date(bi.createdAt || 0).getTime()
  let best = null
  let bestDiff = Infinity
  for (const pkg of packages) {
    const pid = idStr(pkg._id)
    if (taken.has(pid)) continue
    if (String(pkg.department || 'laser') !== String(bi.department)) continue
    if (money(pkg.paidAmountSyp) !== money(bi.listAmountDueSyp || bi.amountDueSyp)) continue
    const diff = Math.abs(new Date(pkg.createdAt || 0).getTime() - biT)
    if (diff <= 30 * 60 * 1000 && diff < bestDiff) {
      best = pkg
      bestDiff = diff
    }
  }
  return best
}

/** أقسام يمكن أن يُدخل فيها خصم على البند قبل التحصيل (فلا يُعرف من الدفعة وحدها متى طُبّق) */
export const ADMIN_EDIT_AUDIT_ACTION = 'تعديل كامل لبند تحصيل (مدير النظام)'

const PRESET_DISCOUNT_DEPARTMENTS = new Set(['dermatology', 'skin'])

/**
 * يستخرج خصومات بند قديم من الحقول المحفوظة (بلا اختلاق):
 *  - خصم جلسة الليزر: الوقت = إنشاء الجلسة، المُطبِّق = المعالج الذي سجّلها (هو من أدخل الخصم).
 *  - خصم البند: إن كان مؤكداً أنه طُبّق عند التحصيل → وقت الدفعة ومستلمها؛ وإلا يُترك الوقت والمُطبِّق فارغين.
 */
function deriveLegacyItemDiscounts({ biId, bi, pay, laser, biList, finalPriceSyp, stopAtSyp, ambiguousTiming }) {
  const out = []
  let originalPriceSyp = biList
  const laserPct = Number(laser?.discountPercent) || 0
  if (laser && laser.isPackageSession !== true && laserPct > 0 && money(laser.costSyp) > biList) {
    originalPriceSyp = money(laser.costSyp)
    out.push(
      legacyDiscount({
        key: `${biId}:laser`,
        sequence: out.length + 1,
        basis: 'list',
        percent: laserPct,
        amountSyp: originalPriceSyp - biList,
        priceBeforeSyp: originalPriceSyp,
        appliedAt: laser.createdAt,
        appliedByName: laser.operatorName,
        source: 'laser_session',
      }),
    )
  }
  const endSyp = stopAtSyp != null ? stopAtSyp : finalPriceSyp
  const itemDiscountSyp = Math.max(0, biList - endSyp)
  if (itemDiscountSyp > 0) {
    const payPct = Number(pay?.discountPercent) || 0
    const atPayment = stopAtSyp == null && payPct > 0 && !ambiguousTiming
    out.push(
      legacyDiscount({
        key: `${biId}:${atPayment ? 'payment' : 'item'}`,
        sequence: out.length + 1,
        basis: out.length ? 'remaining' : 'list',
        percent: stopAtSyp == null && Number(bi.discountPercent) > 0 ? Number(bi.discountPercent) : null,
        amountSyp: itemDiscountSyp,
        priceBeforeSyp: biList,
        appliedAt: atPayment ? pay.receivedAt : null,
        appliedByName: atPayment ? pay.receivedByName : null,
        source: atPayment ? 'payment' : String(bi.department) === 'dermatology' ? 'dermatology_session' : 'admin_edit',
        note: atPayment ? null : 'سجل قديم: لم يكن النظام يحفظ وقت هذا الخصم ومن طبّقه.',
      }),
    )
  }
  return { originalPriceSyp, discounts: out }
}

function paymentPaidSyp(pay) {
  if (!pay) return 0
  return money(pay.amountSyp) + money(pay.creditAppliedSyp)
}

/**
 * يبني قائمة الخدمات مع أسعارها وخصوماتها (دالة صافية — بلا قاعدة بيانات).
 *
 * @param {{
 *   billingItems?: object[],
 *   paymentsByItemId?: Map<string, object>,
 *   laserByItemId?: Map<string, object>,
 *   standaloneLaserSessions?: object[],
 *   dermVisits?: object[],
 *   packages?: object[],
 *   records?: object[],
 *   departments?: Set<string> | null,
 * }} input
 */
export function buildPatientDiscountOverview(input) {
  const {
    billingItems = [],
    paymentsByItemId = new Map(),
    laserByItemId = new Map(),
    standaloneLaserSessions = [],
    dermVisits = [],
    packages = [],
    records = [],
    departments = null,
    adminEditedItemIds = new Set(),
  } = input
  const allowDept = (d) => !departments || departments.has(String(d || ''))

  const recordsByItem = new Map()
  const recordsByPackage = new Map()
  const recordsByDermVisit = new Map()
  for (const r of records) {
    if (r.targetType === 'billing_item' && r.billingItemId) {
      const k = idStr(r.billingItemId)
      if (!recordsByItem.has(k)) recordsByItem.set(k, [])
      recordsByItem.get(k).push(r)
    } else if (r.targetType === 'patient_package' && r.packageId) {
      const k = String(r.packageId)
      if (!recordsByPackage.has(k)) recordsByPackage.set(k, [])
      recordsByPackage.get(k).push(r)
    } else if (r.targetType === 'dermatology_visit' && r.dermatologyVisitId) {
      const k = idStr(r.dermatologyVisitId)
      if (!recordsByDermVisit.has(k)) recordsByDermVisit.set(k, [])
      recordsByDermVisit.get(k).push(r)
    }
  }

  const services = []

  /** بنود شراء الباكجات تُدمج في صف الباكج نفسه */
  const purchaseItemByPackage = new Map()
  const legacyTaken = new Set()
  for (const bi of billingItems) {
    if (bi.packagePurchaseId) {
      purchaseItemByPackage.set(String(bi.packagePurchaseId), bi)
      legacyTaken.add(String(bi.packagePurchaseId))
    }
  }
  for (const bi of billingItems) {
    if (!isLegacyPackagePurchaseItem(bi)) continue
    const pkg = matchLegacyPurchaseToPackage(bi, packages, legacyTaken)
    if (pkg) {
      legacyTaken.add(idStr(pkg._id))
      purchaseItemByPackage.set(idStr(pkg._id), bi)
    }
  }
  const foldedItemIds = new Set([...purchaseItemByPackage.values()].map((bi) => idStr(bi._id)))

  for (const bi of billingItems) {
    const biId = idStr(bi._id)
    if (foldedItemIds.has(biId)) continue
    if (bi.status === 'cancelled' || bi.isCreditTopUp === true) continue
    if (!allowDept(bi.department)) continue
    const pay = paymentsByItemId.get(biId) || null
    const recs = recordsByItem.get(biId) || []
    const finalPriceSyp = money(bi.effectiveAmountDueSyp || bi.amountDueSyp)
    const biList = money(bi.listAmountDueSyp || bi.amountDueSyp)
    /** جلسة ضمن باكج بلا مبلغ إضافي: ليست خدمة مسعّرة */
    if (bi.isPackagePrepaid === true && finalPriceSyp <= 0 && !recs.length) continue

    const active = sortRecords(recs.filter((r) => r.status !== 'reversed'))
    const firstActive = active[0] || null
    /** أول سجل فعّال محسوب على «المتبقي» = كان قبله خصم قديم غير مسجّل */
    const recordsStartFromRemaining = Boolean(firstActive && firstActive.basis === 'remaining')
    let legacy = { originalPriceSyp: biList, discounts: [] }
    if (!recs.length || recordsStartFromRemaining) {
      legacy = deriveLegacyItemDiscounts({
        biId,
        bi,
        pay,
        laser: laserByItemId.get(biId),
        biList,
        finalPriceSyp,
        stopAtSyp: recordsStartFromRemaining ? money(firstActive.priceBeforeSyp) : null,
        ambiguousTiming: adminEditedItemIds.has(biId) || PRESET_DISCOUNT_DEPARTMENTS.has(String(bi.department)),
      })
    }
    let originalPriceSyp = legacy.originalPriceSyp
    if (firstActive && !recordsStartFromRemaining) {
      originalPriceSyp = money(firstActive.listPriceSyp || firstActive.priceBeforeSyp) || biList
    } else if (recordsStartFromRemaining) {
      originalPriceSyp = Math.max(legacy.originalPriceSyp, money(firstActive.listPriceSyp))
    }
    const discounts = [...legacy.discounts, ...sortRecords(recs).map(recordToDto)].map((d, i) => ({
      ...d,
      sequence: i + 1,
    }))
    const notes = []

    const isPaid = bi.status === 'paid'
    const paidSyp = isPaid ? paymentPaidSyp(pay) : 0
    const svc = {
      key: `bi:${biId}`,
      kind: bi.isPackagePrepaid === true ? 'package_session' : 'service',
      billingItemId: biId,
      department: String(bi.department || ''),
      label: String(bi.procedureLabel || '').trim() || 'خدمة',
      businessDate: String(bi.businessDate || ''),
      createdAt: iso(bi.createdAt),
      status: isPaid ? 'paid' : 'pending_payment',
      currency: String(bi.currency || 'SYP').toUpperCase() === 'USD' ? 'USD' : 'SYP',
      originalPriceSyp,
      finalPriceSyp,
      paidSyp,
      remainingSyp: Math.max(0, finalPriceSyp - paidSyp),
      discounts,
      notes,
    }
    if (svc.currency === 'USD') {
      svc.originalPriceUsd = Number(bi.listAmountDueUsd || bi.amountDueUsd) || 0
      svc.finalPriceUsd = Number(bi.effectiveAmountDueUsd || bi.amountDueUsd) || 0
    }
    services.push(finalizeService(svc))
  }

  for (const pkg of packages) {
    const pid = idStr(pkg._id)
    const dept = String(pkg.department || 'laser')
    if (!allowDept(dept)) continue
    const recs = recordsByPackage.get(pid) || []
    const active = sortRecords(recs.filter((r) => r.status !== 'reversed'))
    const finalPriceSyp = money(pkg.packageTotalSyp)
    let originalPriceSyp = money(pkg.listPriceSyp) || finalPriceSyp
    if (!money(pkg.listPriceSyp) && active.length) {
      originalPriceSyp = money(active[0].listPriceSyp || active[0].priceBeforeSyp) || finalPriceSyp
    }
    let discounts = sortRecords(recs).map(recordToDto)
    const notes = []
    if (!recs.length) {
      const purchase = purchaseItemByPackage.get(pid)
      const pay = purchase ? paymentsByItemId.get(idStr(purchase._id)) : null
      const payPct = Number(pay?.discountPercent) || 0
      if (payPct > 0) {
        const payList = money(pay.listAmountDueSyp)
        const payEff = money(pay.effectiveAmountDueSyp)
        discounts = [
          legacyDiscount({
            key: `${pid}:purchase`,
            sequence: 1,
            basis: 'list',
            percent: payPct,
            amountSyp: Math.max(0, payList - payEff),
            priceBeforeSyp: payList,
            appliedAt: pay.receivedAt,
            appliedByName: pay.receivedByName,
            source: 'payment',
          }),
        ]
        notes.push(
          'خصم سُجّل على دفعة شراء الباكج قبل تحديث النظام: لم يُخفَّض سعر الباكج المعتمد، وقد يكون فرق الخصم أُضيف كذمة على المريض — يحتاج مراجعة الإدارة.',
        )
      }
    }
    const paidSyp = money(pkg.paidAmountSyp)
    services.push(
      finalizeService({
        key: `pkg:${pid}`,
        kind: 'package',
        packageId: pid,
        department: dept,
        label: String(pkg.title || '').trim() || (dept === 'solarium' ? 'باكج سولاريوم' : 'باكج ليزر'),
        businessDate: pkg.createdAt ? iso(pkg.createdAt).slice(0, 10) : '',
        createdAt: iso(pkg.createdAt),
        status: 'package',
        currency: 'SYP',
        originalPriceSyp,
        finalPriceSyp,
        paidSyp,
        remainingSyp: Math.max(0, finalPriceSyp - paidSyp),
        discounts,
        notes,
      }),
    )
  }

  /** جلسات ليزر قديمة جداً بلا بند تحصيل (رُحّلت مباشرة) */
  for (const s of standaloneLaserSessions) {
    if (!allowDept('laser')) break
    const cost = money(s.costSyp)
    if (!(cost > 0)) continue
    const pct = Number(s.discountPercent) || 0
    const amount = amountFromPercent(cost, pct)
    services.push(
      finalizeService({
        key: `ls:${idStr(s._id)}`,
        kind: 'service',
        department: 'laser',
        label: `ليزر — معالجة ${s.treatmentNumber ?? ''}`.trim(),
        businessDate: s.createdAt ? iso(s.createdAt).slice(0, 10) : '',
        createdAt: iso(s.createdAt),
        status: 'legacy',
        currency: 'SYP',
        originalPriceSyp: cost,
        finalPriceSyp: cost - amount,
        paidSyp: null,
        remainingSyp: null,
        discounts:
          amount > 0
            ? [
                legacyDiscount({
                  key: `ls:${idStr(s._id)}`,
                  sequence: 1,
                  basis: 'list',
                  percent: pct,
                  amountSyp: amount,
                  priceBeforeSyp: cost,
                  appliedAt: s.createdAt,
                  appliedByName: s.operatorName,
                  source: 'laser_session',
                }),
              ]
            : [],
        notes: [],
      }),
    )
  }

  for (const v of dermVisits) {
    if (!allowDept('dermatology')) break
    const cost = money(v.costSyp)
    if (!(cost > 0)) continue
    const vid = idStr(v._id)
    const recs = recordsByDermVisit.get(vid) || []
    const pct = Number(v.discountPercent) || 0
    const amount = amountFromPercent(cost, pct)
    const discounts = recs.length
      ? sortRecords(recs).map(recordToDto)
      : amount > 0
        ? [
            legacyDiscount({
              key: `dv:${vid}`,
              sequence: 1,
              basis: 'list',
              percent: pct,
              amountSyp: amount,
              priceBeforeSyp: cost,
              appliedAt: v.createdAt,
              appliedByName: v.providerName,
              source: 'dermatology_visit',
            }),
          ]
        : []
    services.push(
      finalizeService({
        key: `dv:${vid}`,
        kind: 'service',
        department: 'dermatology',
        label: String(v.areaTreatment || v.sessionType || 'جلدية').trim(),
        businessDate: String(v.businessDate || ''),
        createdAt: iso(v.createdAt),
        status: 'legacy',
        currency: 'SYP',
        originalPriceSyp: cost,
        finalPriceSyp: cost - amount,
        paidSyp: null,
        remainingSyp: null,
        discounts,
        notes: [],
      }),
    )
  }

  services.sort((a, b) => {
    const da = String(a.createdAt || a.businessDate || '')
    const db = String(b.createdAt || b.businessDate || '')
    return db.localeCompare(da)
  })

  const discounted = services.filter((s) => s.hasDiscount)
  const summary = {
    servicesCount: services.length,
    discountedCount: discounted.length,
    discountsCount: services.reduce((n, s) => n + s.discounts.filter((d) => d.status === 'active').length, 0),
    totalOriginalSyp: services.reduce((n, s) => n + s.originalPriceSyp, 0),
    totalDiscountSyp: services.reduce((n, s) => n + s.totalDiscountSyp, 0),
    totalFinalSyp: services.reduce((n, s) => n + s.finalPriceSyp, 0),
    totalPaidSyp: services.reduce((n, s) => n + (Number(s.paidSyp) || 0), 0),
  }
  return { summary, services }
}

/** الأقسام المسموح للدور برؤية أسعارها في نظرة المريض — null = الكل */
export function discountOverviewDepartmentsForRole(role) {
  if (role === 'super_admin' || role === 'reception') return null
  if (role === 'laser') return new Set(['laser'])
  if (role === 'dermatology' || role === 'dermatology_manager' || role === 'dermatology_assistant_manager') {
    return new Set(['dermatology', 'skin'])
  }
  if (role === 'dental_branch' || role === 'dental_assistant') return new Set(['dental'])
  return new Set()
}

/* ------------------------------------------------------------------ */
/* التحميل من قاعدة البيانات                                           */
/* ------------------------------------------------------------------ */

export async function loadPatientDiscountOverview(patient, { departments = null, onlyProviderUserId = null } = {}) {
  const pid = patient._id
  const biFilter = onlyProviderUserId ? { patientId: pid, providerUserId: onlyProviderUserId } : { patientId: pid }
  const dvFilter = onlyProviderUserId ? { patientId: pid, providerUserId: onlyProviderUserId } : { patientId: pid }
  const [billingItems, records, laserRows, dermRows] = await Promise.all([
    BillingItem.find(biFilter).lean(),
    DiscountRecord.find({ patientId: pid }).lean(),
    LaserSession.find({ patientId: pid }).populate('operatorUserId', 'name').lean(),
    DermatologyVisit.find(dvFilter).populate('providerUserId', 'name').lean(),
  ])
  const itemIds = billingItems.map((b) => b._id)
  const [payments, adminEdits] = itemIds.length
    ? await Promise.all([
        BillingPayment.find({ billingItemId: { $in: itemIds } }).populate('receivedBy', 'name').lean(),
        /** بنود عدّل المدير خصمها قبل التحصيل: لا نعتبر وقت الدفعة وقتاً للخصم */
        AuditLog.find({
          entityType: 'BillingItem',
          action: ADMIN_EDIT_AUDIT_ACTION,
          entityId: { $in: itemIds.map((x) => String(x)) },
        })
          .select('entityId')
          .lean(),
      ])
    : [[], []]
  const adminEditedItemIds = new Set(adminEdits.map((a) => String(a.entityId)))

  const paymentsByItemId = new Map()
  for (const p of payments) {
    paymentsByItemId.set(idStr(p.billingItemId), {
      ...p,
      receivedByName: String(p.receivedBy?.name || '').trim(),
    })
  }
  const laserByItemId = new Map()
  const standaloneLaserSessions = []
  for (const s of laserRows) {
    const row = { ...s, operatorName: String(s.operatorUserId?.name || '').trim() }
    if (s.billingItemId) laserByItemId.set(idStr(s.billingItemId), row)
    else if (s.status === 'completed') standaloneLaserSessions.push(row)
  }
  const dermVisits = dermRows.map((v) => ({ ...v, providerName: String(v.providerUserId?.name || '').trim() }))

  return buildPatientDiscountOverview({
    billingItems,
    paymentsByItemId,
    laserByItemId,
    standaloneLaserSessions,
    dermVisits,
    packages: Array.isArray(patient.sessionPackages) ? patient.sessionPackages : [],
    records,
    departments,
    adminEditedItemIds,
  })
}
