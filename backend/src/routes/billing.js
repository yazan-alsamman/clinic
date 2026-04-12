import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { LaserSession } from '../models/LaserSession.js'
import { writeAudit } from '../utils/audit.js'
import { postBillingPayment } from '../services/postingService.js'
import { todayBusinessDate } from '../utils/date.js'
import { round2 } from '../utils/money.js'

export const billingRouter = Router()

billingRouter.use(authMiddleware)

const BILLING_ROLES = ['super_admin', 'reception']

function billingItemDto(b, patientName, providerName) {
  return {
    id: String(b._id),
    clinicalSessionId: String(b.clinicalSessionId),
    patientId: String(b.patientId),
    patientName: patientName ?? '',
    providerName: providerName ?? '',
    department: b.department,
    procedureLabel: b.procedureLabel || '—',
    amountDueUsd: b.amountDueUsd,
    currency: b.currency || 'USD',
    businessDate: b.businessDate,
    status: b.status,
    createdAt: b.createdAt,
  }
}

/** بنود في انتظار التحصيل */
billingRouter.get('/pending', requireRoles(...BILLING_ROLES), async (req, res) => {
  try {
    const date = String(req.query.date || '').trim() || todayBusinessDate()
    const items = await BillingItem.find({
      status: 'pending_payment',
      businessDate: date,
    })
      .sort({ createdAt: 1 })
      .populate('patientId', 'name')
      .populate('providerUserId', 'name')
      .lean()

    res.json({
      date,
      items: items.map((b) =>
        billingItemDto(b, b.patientId?.name, b.providerUserId?.name),
      ),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** كل المعلّقة (أيام) — اختياري لمدير */
billingRouter.get('/pending-all', requireRoles('super_admin'), async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '80'), 10) || 80))
    const items = await BillingItem.find({ status: 'pending_payment' })
      .sort({ businessDate: -1, createdAt: 1 })
      .limit(limit)
      .populate('patientId', 'name')
      .populate('providerUserId', 'name')
      .lean()
    res.json({
      items: items.map((b) =>
        billingItemDto(b, b.patientId?.name, b.providerUserId?.name),
      ),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تأكيد استلام الدفع → ترحيل محاسبي */
billingRouter.post('/:id/complete-payment', requireRoles(...BILLING_ROLES), async (req, res) => {
  try {
    const id = req.params.id
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }

    const bi = await BillingItem.findById(id)
    if (!bi) {
      res.status(404).json({ error: 'البند غير موجود' })
      return
    }
    if (bi.status !== 'pending_payment') {
      res.status(400).json({ error: 'البند ليس في انتظار الدفع' })
      return
    }

    const body = req.body ?? {}
    const methodRaw = String(body.method || 'cash').toLowerCase()
    const method = ['cash', 'card', 'transfer', 'other'].includes(methodRaw) ? methodRaw : 'cash'
    let amountUsd = round2(Number(body.amountUsd ?? bi.amountDueUsd) || 0)
    if (amountUsd <= 0) {
      res.status(400).json({ error: 'مبلغ الدفع غير صالح' })
      return
    }
    if (amountUsd > round2(bi.amountDueUsd) + 0.001) {
      res.status(400).json({ error: 'المبلغ أكبر من المستحق' })
      return
    }

    const existingPay = await BillingPayment.findOne({ billingItemId: bi._id })
    if (existingPay) {
      res.status(400).json({ error: 'تم تسجيل دفعة لهذا البند مسبقاً' })
      return
    }

    const payment = await BillingPayment.create({
      billingItemId: bi._id,
      amountUsd,
      method,
      receivedBy: req.user._id,
    })

    bi.status = 'paid'
    bi.paymentId = payment._id
    bi.paidAt = new Date()
    await bi.save()

    if (bi.department === 'laser') {
      await LaserSession.updateOne({ billingItemId: bi._id }, { $set: { status: 'completed' } })
    }

    let posting = { skipped: true, reason: 'unknown' }
    try {
      posting = await postBillingPayment(payment._id, req.user._id)
    } catch (postErr) {
      console.error('postBillingPayment:', postErr)
      await writeAudit({
        user: req.user,
        action: 'دفع مؤكد — فشل الترحيل المحاسبي',
        entityType: 'BillingPayment',
        entityId: payment._id,
        details: { error: String(postErr?.message || postErr) },
      })
      res.status(201).json({
        payment: {
          id: String(payment._id),
          amountUsd: payment.amountUsd,
          method: payment.method,
        },
        billingItem: { id: String(bi._id), status: bi.status },
        accountingWarning: String(postErr?.message || postErr),
      })
      return
    }

    await writeAudit({
      user: req.user,
      action: 'تأكيد دفع بند فوترة',
      entityType: 'BillingItem',
      entityId: bi._id,
      details: {
        paymentId: String(payment._id),
        amountUsd,
        accountingSkipped: posting.skipped,
      },
    })

    const financialDocument = posting.document
      ? { id: String(posting.document._id), idempotencyKey: posting.document.idempotencyKey }
      : posting.documentId
        ? { id: posting.documentId, alreadyPosted: true }
        : null

    res.status(201).json({
      payment: {
        id: String(payment._id),
        amountUsd: payment.amountUsd,
        method: payment.method,
      },
      billingItem: { id: String(bi._id), status: bi.status },
      financialDocument,
      accountingSkipped: posting.skipped,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
