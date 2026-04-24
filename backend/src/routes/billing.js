import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { PaymentSettings } from '../models/PaymentSettings.js'
import { writeAudit } from '../utils/audit.js'
import { postBillingPayment } from '../services/postingService.js'
import { todayBusinessDate } from '../utils/date.js'
import { round2 } from '../utils/money.js'

export const billingRouter = Router()

billingRouter.use(authMiddleware)

const BILLING_ROLES = ['super_admin', 'reception']

const DEFAULT_BANK_SEED = [
  { name: 'بيمو', active: true, sortOrder: 0 },
  { name: 'العربي الإسلامي', active: true, sortOrder: 1 },
  { name: 'سورية و الخليج', active: true, sortOrder: 2 },
]

async function getOrCreatePaymentSettings() {
  let doc = await PaymentSettings.findById('default').lean()
  if (!doc) {
    await PaymentSettings.create({ _id: 'default', banks: DEFAULT_BANK_SEED })
    doc = await PaymentSettings.findById('default').lean()
  }
  if (!Array.isArray(doc.banks) || doc.banks.length === 0) {
    await PaymentSettings.updateOne({ _id: 'default' }, { $set: { banks: DEFAULT_BANK_SEED } })
    doc = await PaymentSettings.findById('default').lean()
  }
  return doc
}

function billingItemDto(b, patientName, providerName) {
  const patientIdRaw =
    b?.patientId && typeof b.patientId === 'object' && b.patientId._id ? b.patientId._id : b?.patientId
  const providerIdRaw =
    b?.providerUserId && typeof b.providerUserId === 'object' && b.providerUserId._id
      ? b.providerUserId._id
      : b?.providerUserId
  return {
    id: String(b._id),
    clinicalSessionId: String(b.clinicalSessionId),
    patientId: String(patientIdRaw || ''),
    patientName: patientName ?? '',
    providerName: providerName ?? '',
    providerUserId: String(providerIdRaw || ''),
    department: b.department,
    procedureLabel: b.procedureLabel || '—',
    amountDueUsd: b.amountDueUsd,
    currency: b.currency || 'USD',
    businessDate: b.businessDate,
    status: b.status,
    isPackagePrepaid: b.isPackagePrepaid === true,
    patientPackageId: String(b.patientPackageId || ''),
    patientPackageSessionId: String(b.patientPackageSessionId || ''),
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

/** قائمة البنوك المعتمدة للتحصيل (كاش/بنك) */
billingRouter.get('/payment-bank-options', requireRoles(...BILLING_ROLES), async (req, res) => {
  try {
    const doc = await getOrCreatePaymentSettings()
    const allBanks = (doc.banks || [])
      .map((b) => ({
        id: String(b._id),
        name: String(b.name || '').trim(),
        active: b.active !== false,
        sortOrder: Number(b.sortOrder) || 0,
      }))
      .filter((b) => b.name)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'ar'))
    const banks = allBanks.filter((b) => b.active).map(({ id, name }) => ({ id, name }))
    if (req.user.role === 'super_admin' && String(req.query.admin || '') === '1') {
      res.json({ banks, banksAll: allBanks })
      return
    }
    res.json({ banks })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تحديث قائمة البنوك — مدير النظام */
billingRouter.put('/payment-bank-options', requireRoles('super_admin'), async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.banks) ? req.body.banks : []
    const banks = raw
      .map((b, i) => ({
        name: String(b?.name ?? '')
          .trim()
          .slice(0, 80),
        active: b?.active !== false,
        sortOrder: Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : i,
      }))
      .filter((b) => b.name.length > 0)
      .slice(0, 40)
    if (banks.length === 0) {
      res.status(400).json({ error: 'أضف اسماً لبنك واحد على الأقل' })
      return
    }
    await PaymentSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: { banks } },
      { upsert: true, new: true },
    )
    await writeAudit({
      user: req.user,
      action: 'تحديث قائمة بنوك التحصيل',
      entityType: 'PaymentSettings',
      entityId: 'default',
      details: { count: banks.length },
    })
    const doc = await getOrCreatePaymentSettings()
    const out = (doc.banks || []).map((b) => ({
      id: String(b._id),
      name: String(b.name || '').trim(),
      active: b.active !== false,
      sortOrder: Number(b.sortOrder) || 0,
    }))
    res.json({ banks: out })
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
    if (bi.isPackagePrepaid === true) {
      const duePre = round2(Number(bi.amountDueUsd) || 0)
      if (duePre <= 0) {
        res.status(400).json({
          error: 'هذه الجلسة مدفوعة مسبقاً ضمن باكج — استخدم «إنقاص جلسة» عند عدم وجود مبلغ إضافي خارج الباكج.',
        })
        return
      }
    }

    const body = req.body ?? {}
    const amountUsdRaw = Number(body.amountUsd)
    const amountSypRaw = Number(body.amountSyp)

    const paymentChannel = String(body.paymentChannel || 'cash').toLowerCase() === 'bank' ? 'bank' : 'cash'
    let bankName = ''
    if (paymentChannel === 'bank') {
      bankName = String(body.bankName || '').trim()
      const settings = await getOrCreatePaymentSettings()
      const allowedNames = new Set(
        (settings.banks || [])
          .filter((b) => b.active !== false)
          .map((b) => String(b.name || '').trim())
          .filter(Boolean),
      )
      if (!bankName || !allowedNames.has(bankName)) {
        res.status(400).json({ error: 'اختر البنك من القائمة المعتمدة' })
        return
      }
    }

    let receivedUsd = 0
    let receivedSypRecorded = null
    if (Number.isFinite(amountUsdRaw) && amountUsdRaw > 0) {
      receivedUsd = round2(amountUsdRaw)
    } else if (Number.isFinite(amountSypRaw) && amountSypRaw > 0) {
      const bd = await BusinessDay.findOne({ businessDate: bi.businessDate }).lean()
      const rate = Number(bd?.exchangeRate)
      if (!Number.isFinite(rate) || rate <= 0) {
        res.status(400).json({ error: 'سعر الصرف غير متاح لهذا اليوم' })
        return
      }
      receivedSypRecorded = Math.round(amountSypRaw)
      receivedUsd = round2(amountSypRaw / rate)
    }
    if (receivedUsd <= 0) {
      res.status(400).json({ error: 'مبلغ الدفع غير صالح' })
      return
    }

    const method = paymentChannel === 'bank' ? 'bank' : 'cash'
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
      paymentChannel,
      bankName: paymentChannel === 'bank' ? bankName : '',
      receivedAmountSypRecorded: receivedSypRecorded,
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
        paymentChannel: payment.paymentChannel,
        bankName: payment.bankName || undefined,
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
        paymentChannel: payment.paymentChannel,
        bankName: payment.bankName || undefined,
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
