import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { BusinessDay } from '../models/BusinessDay.js'
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

/** عدد البنود المعلّقة (لـ badge في القائمة) */
billingRouter.get('/pending-count', requireRoles(...BILLING_ROLES), async (req, res) => {
  try {
    let filter = { status: 'pending_payment' }
    if (req.user.role === 'super_admin' && String(req.query.all || '') === '1') {
      // Super admin can optionally see all pending across dates.
      filter = { status: 'pending_payment' }
    } else {
      const date = String(req.query.date || '').trim() || todayBusinessDate()
      filter = { status: 'pending_payment', businessDate: date }
    }
    const count = await BillingItem.countDocuments(filter)
    res.json({ count })
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
    const amountUsdRaw = Number(body.amountUsd)
    const amountSypRaw = Number(body.amountSyp)
    let receivedUsd = 0
    if (Number.isFinite(amountUsdRaw) && amountUsdRaw > 0) {
      receivedUsd = round2(amountUsdRaw)
    } else if (Number.isFinite(amountSypRaw) && amountSypRaw > 0) {
      const bd = await BusinessDay.findOne({ businessDate: bi.businessDate }).lean()
      const rate = Number(bd?.exchangeRate)
      if (!Number.isFinite(rate) || rate <= 0) {
        res.status(400).json({ error: 'سعر الصرف غير متاح لهذا اليوم' })
        return
      }
      receivedUsd = round2(amountSypRaw / rate)
    }
    if (receivedUsd <= 0) {
      res.status(400).json({ error: 'مبلغ الدفع غير صالح' })
      return
    }
    const amountDueUsd = round2(Number(bi.amountDueUsd) || 0)
    const appliedAmountUsd = round2(Math.min(receivedUsd, amountDueUsd))
    const settlementDeltaUsd = round2(receivedUsd - amountDueUsd)

    const existingPay = await BillingPayment.findOne({ billingItemId: bi._id })
    if (existingPay) {
      res.status(400).json({ error: 'تم تسجيل دفعة لهذا البند مسبقاً' })
      return
    }

    const payment = await BillingPayment.create({
      billingItemId: bi._id,
      amountUsd: appliedAmountUsd,
      receivedAmountUsd: receivedUsd,
      settlementDeltaUsd,
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

    const patient = await Patient.findById(bi.patientId).lean()
    let outstandingDebtUsd = 0
    let prepaidCreditUsd = 0
    if (patient) {
      let debt = round2(Number(patient.outstandingDebtUsd) || 0)
      let credit = round2(Number(patient.prepaidCreditUsd) || 0)
      if (settlementDeltaUsd < 0) {
        let need = round2(Math.abs(settlementDeltaUsd))
        const useCredit = round2(Math.min(credit, need))
        credit = round2(credit - useCredit)
        need = round2(need - useCredit)
        debt = round2(debt + need)
      } else if (settlementDeltaUsd > 0) {
        let extra = round2(settlementDeltaUsd)
        const settleDebt = round2(Math.min(debt, extra))
        debt = round2(debt - settleDebt)
        extra = round2(extra - settleDebt)
        credit = round2(credit + extra)
      }
      // Avoid full document validation on legacy patient records (e.g. missing newer required fields).
      await Patient.updateOne(
        { _id: bi.patientId },
        {
          $set: {
            outstandingDebtUsd: debt,
            prepaidCreditUsd: credit,
          },
        },
      )
      outstandingDebtUsd = debt
      prepaidCreditUsd = credit
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
        details: {
          error: String(postErr?.message || postErr),
          receivedUsd,
          appliedAmountUsd,
          settlementDeltaUsd,
        },
      })
      res.status(201).json({
        payment: {
          id: String(payment._id),
          amountUsd: payment.amountUsd,
          receivedAmountUsd: payment.receivedAmountUsd,
          settlementDeltaUsd: payment.settlementDeltaUsd,
          method: payment.method,
        },
        billingItem: { id: String(bi._id), status: bi.status },
        patientSettlement: {
          outstandingDebtUsd,
          prepaidCreditUsd,
        },
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
        receivedUsd,
        appliedAmountUsd,
        settlementDeltaUsd,
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
        receivedAmountUsd: payment.receivedAmountUsd,
        settlementDeltaUsd: payment.settlementDeltaUsd,
        method: payment.method,
      },
      billingItem: { id: String(bi._id), status: bi.status },
      patientSettlement: {
        outstandingDebtUsd,
        prepaidCreditUsd,
      },
      financialDocument,
      accountingSkipped: posting.skipped,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
