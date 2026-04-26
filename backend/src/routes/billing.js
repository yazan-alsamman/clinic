import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { PaymentSettings } from '../models/PaymentSettings.js'
import { writeAudit } from '../utils/audit.js'
import { postBillingPayment } from '../services/postingService.js'
import { todayBusinessDate } from '../utils/date.js'
import { round2, round6 } from '../utils/money.js'
export const billingRouter = Router()

billingRouter.use(authMiddleware)

const BILLING_ROLES = ['super_admin', 'reception']

const DEPT_LABEL_AR = {
  laser: 'ليزر',
  dermatology: 'جلدية',
  dental: 'أسنان',
  solarium: 'سولاريوم',
}

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
    amountDueSyp: b.amountDueSyp,
    currency: b.currency || 'SYP',
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

/**
 * جرد مالي يومي للاستقبال: يوم التقويم الحالي فقط (لا يُقبل تاريخ من الواجهة).
 * تجميع كل التحصيلات المؤكدة لهذا التاريخ — كاش/بنك، ل.س و USD.
 */
billingRouter.get('/reception-daily-inventory', requireRoles('reception', 'super_admin'), async (req, res) => {
  try {
    const businessDate = todayBusinessDate()
    const ybd = await BusinessDay.findOne({ businessDate }).lean()
    const dayActive = Boolean(ybd?.active) && !ybd?.closedAt
    const usdSypRate =
      ybd?.usdSypRate != null && Number.isFinite(Number(ybd.usdSypRate)) && Number(ybd.usdSypRate) > 0
        ? Number(ybd.usdSypRate)
        : null

    const items = await BillingItem.find({
      businessDate,
      status: 'paid',
      paymentId: { $ne: null },
    })
      .sort({ paidAt: 1, createdAt: 1 })
      .populate('patientId', 'name')
      .populate('providerUserId', 'name')
      .lean()

    const payIds = [...new Set(items.map((i) => i.paymentId).filter(Boolean))]
    const payments = payIds.length
      ? await BillingPayment.find({ _id: { $in: payIds } })
          .populate('receivedBy', 'name')
          .lean()
      : []
    const payById = new Map(payments.map((p) => [String(p._id), p]))

    const cash = { totalSyp: 0, totalUsd: 0 }
    const bankMap = new Map()
    let refundsRecordedSyp = 0
    let refundsRecordedUsd = 0
    /** @type {Record<string, { key: string, label: string, transactionCount: number, cashSyp: number, cashUsd: number, bankSyp: number, bankUsd: number }>} */
    const byDept = {}

    const transactions = []

    for (const bi of items) {
      const p = payById.get(String(bi.paymentId))
      if (!p) continue

      const payCur = String(p.payCurrency || 'SYP').toUpperCase() === 'USD' ? 'USD' : 'SYP'
      const sypPart = Math.round(Number(p.receivedAmountSyp) || 0)
      const usdPart = round2(Number(p.receivedAmountUsd) || 0)
      const channel = p.paymentChannel === 'bank' ? 'bank' : 'cash'
      const refSyp = Math.round(Number(p.patientRefundSyp) || 0)
      const refUsd = round2(Number(p.patientRefundUsd) || 0)
      refundsRecordedSyp += refSyp
      refundsRecordedUsd += refUsd

      const deptKey = String(bi.department || 'other')
      if (!byDept[deptKey]) {
        byDept[deptKey] = {
          key: deptKey,
          label: DEPT_LABEL_AR[deptKey] ?? deptKey,
          transactionCount: 0,
          cashSyp: 0,
          cashUsd: 0,
          bankSyp: 0,
          bankUsd: 0,
        }
      }
      byDept[deptKey].transactionCount += 1

      if (channel === 'cash') {
        if (payCur === 'USD') {
          cash.totalUsd = round2(cash.totalUsd + usdPart)
          byDept[deptKey].cashUsd = round2(byDept[deptKey].cashUsd + usdPart)
        } else {
          cash.totalSyp += sypPart
          byDept[deptKey].cashSyp += sypPart
        }
      } else {
        const label = String(p.bankName || '').trim() || 'بنك'
        const cur = bankMap.get(label) || { bankName: label, totalSyp: 0, totalUsd: 0 }
        if (payCur === 'USD') {
          cur.totalUsd = round2(cur.totalUsd + usdPart)
          byDept[deptKey].bankUsd = round2(byDept[deptKey].bankUsd + usdPart)
        } else {
          cur.totalSyp += sypPart
          byDept[deptKey].bankSyp += sypPart
        }
        bankMap.set(label, cur)
      }

      const patientName =
        bi.patientId && typeof bi.patientId === 'object' && 'name' in bi.patientId
          ? String(bi.patientId.name || '').trim()
          : ''
      const providerName =
        bi.providerUserId && typeof bi.providerUserId === 'object' && 'name' in bi.providerUserId
          ? String(bi.providerUserId.name || '').trim()
          : ''
      const receivedByName =
        p.receivedBy && typeof p.receivedBy === 'object' && 'name' in p.receivedBy
          ? String(p.receivedBy.name || '').trim()
          : ''

      transactions.push({
        billingItemId: String(bi._id),
        paymentId: String(p._id),
        paidAt: bi.paidAt ? new Date(bi.paidAt).toISOString() : null,
        patientName: patientName || '—',
        providerName: providerName || '—',
        receivedByName: receivedByName || '—',
        department: deptKey,
        departmentLabel: DEPT_LABEL_AR[deptKey] ?? deptKey,
        procedureLabel: String(bi.procedureLabel || '—'),
        paymentChannel: channel,
        bankName: channel === 'bank' ? String(p.bankName || '').trim() || '—' : '',
        payCurrency: payCur,
        receivedAmountSyp: sypPart,
        receivedAmountUsd: usdPart,
        amountDueSyp: Math.round(Number(bi.amountDueSyp) || 0),
        settlementDeltaSyp: Math.round(Number(p.settlementDeltaSyp) || 0),
        patientRefundSyp: refSyp,
        patientRefundUsd: refUsd,
      })
    }

    const banks = [...bankMap.values()].sort((a, b) => String(a.bankName).localeCompare(String(b.bankName), 'ar'))
    const totalsSyp = cash.totalSyp + banks.reduce((s, b) => s + (Math.round(Number(b.totalSyp)) || 0), 0)
    const totalsUsd = round2(cash.totalUsd + banks.reduce((s, b) => s + (Number(b.totalUsd) || 0), 0))

    const pendingCount = await BillingItem.countDocuments({ businessDate, status: 'pending_payment' })

    res.json({
      businessDate,
      /** ثابت: لا يُسمح بطلب أيام أخرى من واجهة الاستقبال */
      dateLockedToToday: true,
      dayActive,
      usdSypRate,
      summary: {
        cash: { totalSyp: cash.totalSyp, totalUsd: round2(cash.totalUsd) },
        banks,
        totals: { totalSyp: totalsSyp, totalUsd: totalsUsd },
        refundsRecorded: { totalSyp: refundsRecordedSyp, totalUsd: round2(refundsRecordedUsd) },
        transactionCount: transactions.length,
        pendingCollectionCount: pendingCount,
      },
      byDepartment: Object.values(byDept).sort((a, b) => a.label.localeCompare(b.label, 'ar')),
      transactions,
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
    const amountDueSyp = Math.round(Number(bi.amountDueSyp) || 0)
    if (amountDueSyp <= 0) {
      res.status(400).json({
        error: bi.isPackagePrepaid
          ? 'هذه الجلسة ضمن باكج ولا يوجد مبلغ إضافي مستحق. استخدم «إنقاص جلسة» من صفحة التحصيل.'
          : 'لا يوجد مبلغ مستحق على هذا البند. افتح ملف المريض وتأكد من تسعير الجلسة (ليزر / استقبال) بالليرة ثم أعد إنشاء البند إن لزم.',
      })
      return
    }

    const body = req.body ?? {}
    const payCurrencyRaw = String(body.payCurrency || 'SYP').trim().toUpperCase()
    const payCurrency = payCurrencyRaw === 'USD' ? 'USD' : 'SYP'

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

    let receivedSyp = 0
    let receivedUsd = 0
    let patientRefundSyp = 0
    let patientRefundUsd = 0
    if (payCurrency === 'USD') {
      const bd = await BusinessDay.findOne({ businessDate: bi.businessDate }).lean()
      const rate = Number(bd?.usdSypRate)
      if (!Number.isFinite(rate) || rate <= 0) {
        res.status(400).json({
          error:
            'لا يتوفر سعر صرف مسجّل لتاريخ هذا البند. يجب تفعيل يوم العمل ذلك اليوم مع إدخال سعر الدولار مقابل الليرة.',
        })
        return
      }
      const amountUsdRaw = Number(body.amountUsd)
      if (!Number.isFinite(amountUsdRaw) || amountUsdRaw <= 0) {
        res.status(400).json({ error: 'مبلغ الدفع بالدولار غير صالح' })
        return
      }
      /** لا نستخدم round2 قبل الضرب — وإلا يضيعت مطابقة المستحق (مثال 110000÷15000) */
      receivedSyp = Math.round(amountUsdRaw * rate)
      receivedUsd = round6(amountUsdRaw)
      if (receivedSyp <= 0) {
        res.status(400).json({ error: 'المبلغ بالدولار صغير جداً بالنسبة لسعر الصرف.' })
        return
      }

      const refundCurRaw = String(body.refundCurrency || '').trim().toUpperCase()
      const refundCurrency = refundCurRaw === 'USD' ? 'USD' : refundCurRaw === 'SYP' ? 'SYP' : null
      if (refundCurrency === 'SYP') {
        const refSyp = Number(body.refundAmount)
        if (body.refundAmount != null && String(body.refundAmount).trim() !== '') {
          if (!Number.isFinite(refSyp) || refSyp < 0) {
            res.status(400).json({ error: 'مبلغ الترجيع بالليرة غير صالح' })
            return
          }
          patientRefundSyp = refSyp > 0 ? Math.round(refSyp) : 0
        }
      } else if (refundCurrency === 'USD') {
        const refUsd = Number(body.refundAmount)
        if (body.refundAmount != null && String(body.refundAmount).trim() !== '') {
          if (!Number.isFinite(refUsd) || refUsd < 0) {
            res.status(400).json({ error: 'مبلغ الترجيع بالدولار غير صالح' })
            return
          }
          patientRefundUsd = refUsd > 0 ? round6(refUsd) : 0
        }
      } else if (body.refundAmount != null && String(body.refundAmount).trim() !== '') {
        res.status(400).json({ error: 'حدد عملة الترجيع (ليرة أو دولار) عند إدخال مبلغ الترجيع' })
        return
      }
    } else {
      const amountSypRaw = Number(body.amountSyp)
      receivedSyp = Number.isFinite(amountSypRaw) && amountSypRaw > 0 ? Math.round(amountSypRaw) : 0
    }
    if (receivedSyp <= 0) {
      res.status(400).json({ error: 'مبلغ الدفع غير صالح' })
      return
    }

    const method = paymentChannel === 'bank' ? 'bank' : 'cash'
    const appliedAmountSyp = Math.min(receivedSyp, amountDueSyp)
    const settlementDeltaSyp = receivedSyp - amountDueSyp

    const existingPay = await BillingPayment.findOne({ billingItemId: bi._id })
    if (existingPay) {
      res.status(400).json({ error: 'تم تسجيل دفعة لهذا البند مسبقاً' })
      return
    }

    const payment = await BillingPayment.create({
      billingItemId: bi._id,
      amountSyp: appliedAmountSyp,
      receivedAmountSyp: receivedSyp,
      settlementDeltaSyp,
      payCurrency,
      receivedAmountUsd: payCurrency === 'USD' ? receivedUsd : 0,
      patientRefundSyp: payCurrency === 'USD' ? patientRefundSyp : 0,
      patientRefundUsd: payCurrency === 'USD' ? patientRefundUsd : 0,
      paymentChannel,
      bankName: paymentChannel === 'bank' ? bankName : '',
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
    let outstandingDebtSyp = 0
    let prepaidCreditSyp = 0
    if (patient) {
      let debt = Math.round(Number(patient.outstandingDebtSyp) || 0)
      let credit = Math.round(Number(patient.prepaidCreditSyp) || 0)
      if (settlementDeltaSyp < 0) {
        let need = Math.abs(settlementDeltaSyp)
        const useCredit = Math.min(credit, need)
        credit -= useCredit
        need -= useCredit
        debt += need
      } else if (settlementDeltaSyp > 0) {
        let extra = settlementDeltaSyp
        const settleDebt = Math.min(debt, extra)
        debt -= settleDebt
        extra -= settleDebt
        credit += extra
      }
      // Avoid full document validation on legacy patient records (e.g. missing newer required fields).
      await Patient.updateOne(
        { _id: bi.patientId },
        {
          $set: {
            outstandingDebtSyp: debt,
            prepaidCreditSyp: credit,
          },
        },
      )
      outstandingDebtSyp = debt
      prepaidCreditSyp = credit
    }

    let posting = { skipped: true, reason: 'unknown' }
    try {
      posting = await postBillingPayment(payment._id, req.user._id)
    } catch (postErr) {
      console.error('postBillingPayment:', postErr)
      try {
        await writeAudit({
          user: req.user,
          action: 'دفع مؤكد — فشل الترحيل المحاسبي',
          entityType: 'BillingPayment',
          entityId: payment._id,
          details: {
            error: String(postErr?.message || postErr),
            receivedSyp,
            receivedUsd,
            payCurrency,
            appliedAmountSyp,
            settlementDeltaSyp,
            patientRefundSyp,
            patientRefundUsd,
          },
        })
      } catch (auditErr) {
        console.error('writeAudit (posting failure):', auditErr)
      }
      res.status(201).json({
        payment: {
          id: String(payment._id),
          amountSyp: payment.amountSyp,
          receivedAmountSyp: payment.receivedAmountSyp,
          settlementDeltaSyp: payment.settlementDeltaSyp,
          payCurrency: payment.payCurrency,
          receivedAmountUsd: payment.receivedAmountUsd,
          patientRefundSyp: payment.patientRefundSyp,
          patientRefundUsd: payment.patientRefundUsd,
          method: payment.method,
        },
        billingItem: { id: String(bi._id), status: bi.status },
        patientSettlement: {
          outstandingDebtSyp,
          prepaidCreditSyp,
        },
        accountingWarning: String(postErr?.message || postErr),
      })
      return
    }

    try {
      await writeAudit({
        user: req.user,
        action: 'تأكيد دفع بند فوترة',
        entityType: 'BillingItem',
        entityId: bi._id,
        details: {
          paymentId: String(payment._id),
          receivedSyp,
          receivedUsd,
          payCurrency,
          appliedAmountSyp,
          settlementDeltaSyp,
          paymentChannel,
          bankName: paymentChannel === 'bank' ? bankName : undefined,
          accountingSkipped: posting.skipped,
          patientRefundSyp,
          patientRefundUsd,
        },
      })
    } catch (auditErr) {
      console.error('writeAudit (payment success):', auditErr)
    }

    const financialDocument = posting.document
      ? { id: String(posting.document._id), idempotencyKey: posting.document.idempotencyKey }
      : posting.documentId
        ? { id: posting.documentId, alreadyPosted: true }
        : null

    res.status(201).json({
      payment: {
        id: String(payment._id),
        amountSyp: payment.amountSyp,
        receivedAmountSyp: payment.receivedAmountSyp,
        settlementDeltaSyp: payment.settlementDeltaSyp,
        payCurrency: payment.payCurrency,
        receivedAmountUsd: payment.receivedAmountUsd,
        patientRefundSyp: payment.patientRefundSyp,
        patientRefundUsd: payment.patientRefundUsd,
        method: payment.method,
        paymentChannel: payment.paymentChannel,
        bankName: payment.bankName || undefined,
      },
      billingItem: { id: String(bi._id), status: bi.status },
      patientSettlement: {
        outstandingDebtSyp,
        prepaidCreditSyp,
      },
      financialDocument,
      accountingSkipped: posting.skipped,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
