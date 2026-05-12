import { Router } from 'express'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { SolariumSettings } from '../models/SolariumSettings.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'
import { recordBillingStraightCashSyp } from '../services/recordBillingStraightCashSyp.js'

export const solariumRouter = Router()

const PLACEHOLDER_FILE_NUMBER = 'SYS-SOL-WALKIN'
const ACCESS_READ = ['super_admin', 'reception']
const ACCESS_WRITE = ['super_admin', 'reception']

solariumRouter.use(authMiddleware, loadBusinessDay)

async function ensureSolariumWalkInPlaceholderPatient() {
  let p = await Patient.findOne({ fileNumber: PLACEHOLDER_FILE_NUMBER }).lean()
  if (p) return p
  try {
    p = await Patient.create({
      fileNumber: PLACEHOLDER_FILE_NUMBER,
      name: 'سولاريوم — زائر (داخلي)',
      departments: [],
      lastVisit: new Date(),
    })
    return p.toObject ? p.toObject() : p
  } catch (e) {
    if (e?.code === 11000) {
      return await Patient.findOne({ fileNumber: PLACEHOLDER_FILE_NUMBER }).lean()
    }
    throw e
  }
}

async function getOrCreateSettings() {
  let doc = await SolariumSettings.findById('default').lean()
  if (!doc) {
    await SolariumSettings.create({ _id: 'default', price6MinSyp: 0, price12MinSyp: 0 })
    doc = await SolariumSettings.findById('default').lean()
  }
  return doc
}

solariumRouter.get('/settings', requireRoles(...ACCESS_READ), async (_req, res) => {
  try {
    const doc = await getOrCreateSettings()
    res.json({
      price6MinSyp: Math.round(Number(doc.price6MinSyp) || 0),
      price12MinSyp: Math.round(Number(doc.price12MinSyp) || 0),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

function normalizeBusinessDateQuery(raw, fallback) {
  const s = String(raw || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return String(fallback || '').trim() || todayBusinessDate()
}

function classifySolariumRow(procedureDescription) {
  const p = String(procedureDescription || '')
  if (p.includes('باكج مسبق الدفع')) return 'package'
  if (/\d+\s*دقيقة/.test(p)) return 'walk_in'
  return 'other'
}

/**
 * سجل يومي لمدير النظام: جلسات سولاريوم (زائر) + باكجات مسبقة الدفع المحصّلة — حسب تاريخ العمل.
 */
solariumRouter.get('/daily-register', requireRoles('super_admin'), async (req, res) => {
  try {
    const businessDate = normalizeBusinessDateQuery(req.query.businessDate, req.businessDate)
    const sessions = await ClinicalSession.find({ department: 'solarium', businessDate })
      .sort({ createdAt: -1 })
      .lean()

    const biIds = sessions.map((s) => s.billingItemId).filter(Boolean)
    const patientIds = sessions.map((s) => s.patientId).filter(Boolean)

    const [billingItems, payments, patients] = await Promise.all([
      biIds.length ? BillingItem.find({ _id: { $in: biIds } }).lean() : [],
      biIds.length ? BillingPayment.find({ billingItemId: { $in: biIds } }).lean() : [],
      patientIds.length ? Patient.find({ _id: { $in: patientIds } }).select('name fileNumber').lean() : [],
    ])

    const biById = new Map(billingItems.map((b) => [String(b._id), b]))
    const payByBi = new Map(payments.map((p) => [String(p.billingItemId), p]))
    const receiverIds = [...new Set(payments.map((p) => p.receivedBy).filter(Boolean).map(String))]
    const receivers =
      receiverIds.length > 0 ? await User.find({ _id: { $in: receiverIds } }).select('name').lean() : []
    const userById = new Map(receivers.map((u) => [String(u._id), u]))
    const patById = new Map(patients.map((p) => [String(p._id), p]))

    const rows = sessions.map((cs) => {
      const bid = cs.billingItemId ? String(cs.billingItemId) : ''
      const bi = bid ? biById.get(bid) : null
      const pay = bid ? payByBi.get(bid) : null
      const pid = cs.patientId ? String(cs.patientId) : ''
      const patient = pid ? patById.get(pid) : null
      const receivedById = pay?.receivedBy ? String(pay.receivedBy) : ''
      const receiver = receivedById ? userById.get(receivedById) : null
      const proc = String(cs.procedureDescription || bi?.procedureLabel || '')
      const kind = classifySolariumRow(proc)
      const amountSyp = Math.round(Number(bi?.amountDueSyp ?? bi?.effectiveAmountDueSyp ?? cs.sessionFeeSyp) || 0)
      return {
        id: String(cs._id),
        businessDate: String(cs.businessDate || businessDate),
        createdAt: cs.createdAt ? new Date(cs.createdAt).toISOString() : null,
        kind,
        procedureDescription: proc,
        patientName: patient?.name ? String(patient.name) : '—',
        fileNumber: patient?.fileNumber ? String(patient.fileNumber) : '',
        amountSyp,
        billingStatus: bi?.status ? String(bi.status) : '',
        receivedByName: receiver?.name ? String(receiver.name).trim() : '—',
        receivedAt: pay?.receivedAt ? new Date(pay.receivedAt).toISOString() : null,
      }
    })

    res.json({ businessDate, rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'تعذر تحميل السجل اليومي' })
  }
})

solariumRouter.put('/settings', requireRoles('super_admin'), async (req, res) => {
  try {
    const body = req.body ?? {}
    const price6MinSyp = Math.max(0, Math.round(Number(body.price6MinSyp) || 0))
    const price12MinSyp = Math.max(0, Math.round(Number(body.price12MinSyp) || 0))
    await SolariumSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: { price6MinSyp, price12MinSyp } },
      { upsert: true, new: true },
    )
    await writeAudit({
      user: req.user,
      action: 'تحديث أسعار السولاريوم',
      entityType: 'SolariumSettings',
      entityId: 'default',
      details: { price6MinSyp, price12MinSyp },
    })
    res.json({ price6MinSyp, price12MinSyp })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/**
 * تسجيل جلسة سولاريوم باسم حرّ (غير مرتبط بملفات المرضى) + تحصيل فوري نقداً ل.س
 * يُحسب ضمن الجرد المالي اليومي مثل باقي التحصيلات (receivedBy = المستخدم الحالي).
 */
solariumRouter.post(
  '/sessions/confirm',
  requireActiveDay,
  requireRoles(...ACCESS_WRITE),
  async (req, res) => {
    let cs = null
    try {
      const body = req.body ?? {}
      const displayName = String(body.displayName || '').trim().slice(0, 120)
      if (displayName.length < 1) {
        res.status(400).json({ error: 'أدخل اسم المريض كما سيُعرض في السجل' })
        return
      }
      const minutesRaw = Number(body.sessionMinutes)
      const sessionMinutes = minutesRaw === 12 ? 12 : minutesRaw === 6 ? 6 : null
      if (!sessionMinutes) {
        res.status(400).json({ error: 'اختر نوع الجلسة: 6 أو 12 دقيقة' })
        return
      }

      const settings = await getOrCreateSettings()
      const fee =
        sessionMinutes === 12
          ? Math.round(Number(settings.price12MinSyp) || 0)
          : Math.round(Number(settings.price6MinSyp) || 0)
      if (!(fee > 0)) {
        res.status(400).json({
          error:
            sessionMinutes === 12
              ? 'سعر جلسة 12 دقيقة غير محدد أو صفر — يحدده مدير النظام من نفس الصفحة.'
              : 'سعر جلسة 6 دقائق غير محدد أو صفر — يحدده مدير النظام من نفس الصفحة.',
        })
        return
      }

      const businessDate = String(body.businessDate || '').trim() || req.businessDate || todayBusinessDate()
      const placeholder = await ensureSolariumWalkInPlaceholderPatient()
      const patientId = placeholder._id

      const procedureDescription = `سولاريوم — ${sessionMinutes} دقيقة — ${displayName}`
      const providerUserId = req.user._id

      cs = await ClinicalSession.create({
        patientId,
        providerUserId,
        department: 'solarium',
        procedureDescription,
        sessionFeeSyp: fee,
        businessDate,
        notes: '',
        materials: [],
        materialCostSypTotal: 0,
        materialChargeSypTotal: 0,
        createdByReceptionUserId: req.user._id,
      })

      const bi = await BillingItem.create({
        clinicalSessionId: cs._id,
        patientId,
        providerUserId,
        department: 'solarium',
        procedureLabel: procedureDescription,
        listAmountDueSyp: fee,
        discountPercent: 0,
        effectiveAmountDueSyp: fee,
        amountDueSyp: fee,
        currency: 'SYP',
        businessDate,
        status: 'pending_payment',
      })

      cs.billingItemId = bi._id
      await cs.save()

      const payResult = await recordBillingStraightCashSyp({
        billingItemId: bi._id,
        receivedByUser: req.user,
      })

      await writeAudit({
        user: req.user,
        action: 'سولاريوم: تسجيل جلسة وتحصيل فوري',
        entityType: 'ClinicalSession',
        entityId: cs._id,
        details: {
          displayName,
          sessionMinutes,
          feeSyp: fee,
          billingItemId: String(bi._id),
          paymentId: payResult.paymentId,
        },
      })

      res.status(201).json({
        ok: true,
        clinicalSessionId: String(cs._id),
        billingItemId: String(bi._id),
        paymentId: payResult.paymentId,
        amountSyp: fee,
        procedureLabel: procedureDescription,
      })
    } catch (e) {
      if (cs?._id) {
        await BillingItem.deleteMany({ clinicalSessionId: cs._id })
        await ClinicalSession.findByIdAndDelete(cs._id)
      }
      console.error(e)
      const msg = String(e?.message || e)
      if (msg.includes('البند') || msg.includes('دفعة')) {
        res.status(400).json({ error: msg })
        return
      }
      res.status(500).json({ error: 'تعذر تسجيل الجلسة أو التحصيل' })
    }
  },
)
