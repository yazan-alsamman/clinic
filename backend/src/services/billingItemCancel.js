import mongoose from 'mongoose'
import { BillingItem } from '../models/BillingItem.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { writeAudit } from '../utils/audit.js'

/**
 * حذف (إلغاء) بند تحصيل من شاشة التحصيل.
 *
 * القاعدة المالية: يُلغى فقط البند الذي لم يُقبض بعد (pending_payment) — يبقى السجل في قاعدة البيانات
 * بحالة cancelled مع من ألغاه ومتى ولماذا، ولا يُمس أي قيد مالي.
 * البند المحصّل لا يُحذف من هنا: يُعكس عبر حذف/تصحيح الجلسة من ملف المريض (قيد عكسي + سجل تدقيق).
 */

export const CANCEL_REASON_MAX = 500

export class BillingCancelError extends Error {
  constructor(message, status = 400, code = 'NOT_CANCELLABLE', extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

function fmtDay(d) {
  if (!d) return ''
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10)
}

/**
 * هل يمكن إلغاء البند؟ (دالة صرفة — تُستخدم في الخادم والاختبارات)
 * @param {object|null} bi
 * @param {{ activeAreaDeductionCount?: number }} [ctx]
 * @returns {{ cancellable: boolean, alreadyCancelled?: boolean, code: string, reason: string }}
 */
export function describeBillingItemCancellability(bi, ctx = {}) {
  if (!bi) return { cancellable: false, code: 'NOT_FOUND', reason: 'البند غير موجود — ربما حُذف أو أُعيد إنشاؤه. حدّث القائمة.' }
  const status = String(bi.status || '')
  if (status === 'cancelled') {
    const who = String(bi.cancelledByName || '').trim()
    const when = fmtDay(bi.cancelledAt)
    return {
      cancellable: false,
      alreadyCancelled: true,
      code: 'ALREADY_CANCELLED',
      reason: `البند محذوف مسبقاً${who ? ` بواسطة ${who}` : ''}${when ? ` بتاريخ ${when}` : ''}.`,
    }
  }
  if (status === 'paid') {
    const when = fmtDay(bi.paidAt)
    return {
      cancellable: false,
      code: 'PAID',
      reason:
        `البند محصّل${when ? ` بتاريخ ${when}` : ''} — لا يُحذف من التحصيل حتى لا يُمحى قيد مالي. ` +
        'لعكسه احذف الجلسة أو الإجراء من ملف المريض (يُنشأ قيد عكسي ويُسجَّل من نفّذه).',
    }
  }
  if (status !== 'pending_payment') {
    return { cancellable: false, code: 'UNKNOWN_STATUS', reason: `حالة البند غير معروفة (${status || 'فارغة'}) — راجع المدير.` }
  }
  if (bi.paymentId || bi.paidAt) {
    return {
      cancellable: false,
      code: 'HAS_PAYMENT',
      reason: 'البند مرتبط بدفعة مسجّلة رغم أنه معلّق — لا يُحذف تلقائياً؛ راجع سجل الدفعات أولاً.',
    }
  }
  if (Number(ctx.activeAreaDeductionCount) > 0) {
    return {
      cancellable: false,
      code: 'AREA_DEDUCTIONS',
      reason:
        'أُنقصت جلسات مناطق باكج لهذه الزيارة — صحّح الإنقاص أولاً من سجل الباكج في ملف المريض، أو احذف جلسة الليزر نفسها.',
    }
  }
  return { cancellable: true, code: 'OK', reason: '' }
}

/** عدد إنقاصات المناطق الفعّالة المرتبطة بهذا البند أو بجلسة الليزر الخاصة به */
export async function countActiveAreaDeductionsForBill(bi) {
  if (!bi || bi.isPackagePrepaid !== true || String(bi.department || '') !== 'laser') return 0
  const patient = await Patient.findById(bi.patientId).select('sessionPackages').lean()
  if (!patient) return 0
  const ls = await LaserSession.findOne({ billingItemId: bi._id }).select('_id').lean()
  const billId = String(bi._id)
  const lsId = ls?._id ? String(ls._id) : ''
  let n = 0
  for (const pkg of patient.sessionPackages || []) {
    for (const d of pkg.areaDeductions || []) {
      if (d.reversedAt) continue
      if (String(d.billingItemId || '') === billId || (lsId && String(d.laserSessionId || '') === lsId)) n += 1
    }
  }
  return n
}

/**
 * إلغاء بند واحد. عملية ذرية: الكتابة مشروطة بأن البند ما زال معلّقاً (لا سباق مع التحصيل).
 * إعادة الطلب على بند أُلغي مسبقاً تعيد نجاحاً (alreadyCancelled) دون سجل تدقيق ثانٍ.
 */
export async function cancelPendingBillingItem({ id, user, reason = '' }) {
  const billId = String(id || '').trim()
  if (!mongoose.isValidObjectId(billId)) throw new BillingCancelError('معرّف غير صالح', 400, 'INVALID_ID')
  const note = String(reason || '').trim().slice(0, CANCEL_REASON_MAX)

  const bi = await BillingItem.findById(billId).lean()
  const activeAreaDeductionCount = bi ? await countActiveAreaDeductionsForBill(bi) : 0
  const check = describeBillingItemCancellability(bi, { activeAreaDeductionCount })
  if (check.alreadyCancelled) {
    return { ok: true, alreadyCancelled: true, billingItem: { id: billId, status: 'cancelled' }, message: check.reason }
  }
  if (!check.cancellable) {
    throw new BillingCancelError(check.reason, check.code === 'NOT_FOUND' ? 404 : 409, check.code, {
      currentStatus: bi?.status || null,
    })
  }

  const now = new Date()
  const updated = await BillingItem.findOneAndUpdate(
    { _id: billId, status: 'pending_payment', paymentId: null },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        cancelledByUserId: user?._id ?? null,
        cancelledByName: String(user?.name || ''),
        cancelReason: note,
        cancelSource: 'billing_delete',
      },
    },
    { new: true },
  ).lean()

  if (!updated) {
    /** تغيّرت الحالة بين القراءة والكتابة (مثلاً حُصّل من جهاز آخر) */
    const fresh = await BillingItem.findById(billId).lean()
    const again = describeBillingItemCancellability(fresh)
    if (again.alreadyCancelled) {
      return { ok: true, alreadyCancelled: true, billingItem: { id: billId, status: 'cancelled' }, message: again.reason }
    }
    throw new BillingCancelError(again.reason || 'تغيّرت حالة البند — حدّث القائمة.', 409, again.code, {
      currentStatus: fresh?.status || null,
    })
  }

  try {
    await writeAudit({
      user,
      action: 'إلغاء بند تحصيل معلّق',
      entityType: 'BillingItem',
      entityId: updated._id,
      details: {
        previousStatus: 'pending_payment',
        nextStatus: 'cancelled',
        department: updated.department,
        businessDate: updated.businessDate,
        patientId: updated.patientId ? String(updated.patientId) : '',
        amountDueSyp: Math.round(Number(updated.amountDueSyp) || 0),
        amountDueUsd: Number(updated.amountDueUsd) || 0,
        procedureLabel: String(updated.procedureLabel || ''),
        reason: note,
      },
    })
  } catch (auditErr) {
    console.error('writeAudit (cancel billing item):', auditErr)
  }

  return { ok: true, alreadyCancelled: false, billingItem: { id: billId, status: 'cancelled' } }
}

export const BULK_CANCEL_MAX = 100

/**
 * حذف عدة بنود: كل بند يُفحص ويُلغى مستقلاً — بند محصّل لا يوقف البقية ولا يُلغى.
 * @returns {{ results: { id: string, ok: boolean, alreadyCancelled?: boolean, code?: string, error?: string }[], cancelledCount: number, failedCount: number }}
 */
export async function cancelPendingBillingItems({ ids, user, reason = '' }) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter(Boolean))]
  if (!list.length) throw new BillingCancelError('اختر بنداً واحداً على الأقل', 400, 'EMPTY')
  if (list.length > BULK_CANCEL_MAX) throw new BillingCancelError(`الحد الأقصى ${BULK_CANCEL_MAX} بند في المرة الواحدة`, 400, 'TOO_MANY')
  const results = []
  for (const id of list) {
    try {
      const r = await cancelPendingBillingItem({ id, user, reason })
      results.push({ id, ok: true, alreadyCancelled: r.alreadyCancelled === true })
    } catch (e) {
      if (!(e instanceof BillingCancelError)) throw e
      results.push({ id, ok: false, code: e.code, error: e.message })
    }
  }
  return {
    results,
    cancelledCount: results.filter((r) => r.ok && !r.alreadyCancelled).length,
    failedCount: results.filter((r) => !r.ok).length,
  }
}
