import { Router } from 'express'
import { patientAuthMiddleware } from '../middleware/patientAuth.js'
import { patientToDto } from '../utils/dto.js'
import { getClinicalBundleForPatientId } from '../services/patientClinicalBundle.js'
import { todayBusinessDate } from '../utils/date.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'

export const patientPortalRouter = Router()
patientPortalRouter.use(patientAuthMiddleware)

/** يمنع الوصول لبيانات البوابة حتى يغيّر المريض كلمة المرور الافتراضية/المُعاد إنشاؤها */
function blockUntilPasswordChanged(req, res, next) {
  if (req.patient?.portalMustChangePassword === true) {
    res.status(403).json({
      error: 'يجب تغيير كلمة مرور البوابة من صفحة الأمان قبل عرض بقية الصفحات.',
    })
    return
  }
  next()
}

patientPortalRouter.use(blockUntilPasswordChanged)

patientPortalRouter.get('/profile', async (req, res) => {
  try {
    res.json({ patient: patientToDto(req.patient) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientPortalRouter.get('/clinical', async (req, res) => {
  try {
    const bundle = await getClinicalBundleForPatientId(req.patient._id)
    res.json(bundle)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientPortalRouter.get('/dashboard', async (req, res) => {
  try {
    const p = req.patient
    const bundle = await getClinicalBundleForPatientId(p._id)
    const today = todayBusinessDate()
    const upcoming = bundle.appointments.filter((a) => String(a.businessDate) >= today)
    const recentLaser = bundle.laserSessions.slice(0, 5)
    const recentDerm = bundle.dermatologyVisits.slice(0, 5)

    const updates = []
    for (const s of bundle.laserSessions.slice(0, 3)) {
      updates.push({
        kind: 'laser',
        at: s.createdAt,
        label: `جلسة ليزر — ${s.laserType} — حالة: ${s.status}`,
      })
    }
    for (const v of bundle.dermatologyVisits.slice(0, 2)) {
      updates.push({
        kind: 'dermatology',
        at: v.createdAt,
        label: `زيارة جلدية — ${v.sessionType || 'إجراء'} — ${v.businessDate}`,
      })
    }
    updates.sort((a, b) => new Date(b.at) - new Date(a.at))

    res.json({
      patient: patientToDto(p),
      mustChangePassword: p.portalMustChangePassword === true,
      summary: {
        laserSessionsCount: bundle.laserSessions.length,
        dermatologyVisitsCount: bundle.dermatologyVisits.length,
        appointmentsTotal: bundle.appointments.length,
        upcomingAppointmentsCount: upcoming.length,
        dentalPlanStatus: bundle.dentalPlan?.status ?? null,
      },
      upcomingAppointments: upcoming.slice(0, 12),
      recentLaserSessions: recentLaser,
      recentDermatology: recentDerm,
      updates: updates.slice(0, 8),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientPortalRouter.get('/financial', async (req, res) => {
  try {
    const p = req.patient
    const items = await BillingItem.find({ patientId: p._id })
      .select('_id amountDueUsd businessDate procedureLabel')
      .lean()
    const byId = new Map(items.map((x) => [String(x._id), x]))
    const itemIds = [...byId.keys()]
    if (itemIds.length === 0) {
      res.json({
        summary: {
          outstandingDebtUsd: Number(p.outstandingDebtUsd) || 0,
          prepaidCreditUsd: Number(p.prepaidCreditUsd) || 0,
        },
        entries: [],
      })
      return
    }

    const payments = await BillingPayment.find({ billingItemId: { $in: itemIds } })
      .sort({ receivedAt: -1, createdAt: -1 })
      .lean()

    const entries = payments.map((pay) => {
      const key = String(pay.billingItemId)
      const bi = byId.get(key)
      const due = Number(bi?.amountDueUsd) || 0
      const applied = Number(pay.amountUsd) || 0
      const received = Number(pay.receivedAmountUsd ?? pay.amountUsd) || 0
      const delta = Number(pay.settlementDeltaUsd ?? received - due) || 0
      let settlementType = 'exact'
      if (delta < -0.0001) settlementType = 'debt'
      else if (delta > 0.0001) settlementType = 'credit'
      return {
        id: String(pay._id),
        billingItemId: key,
        businessDate: String(bi?.businessDate || '').trim(),
        procedureLabel: String(bi?.procedureLabel || '').trim(),
        amountDueUsd: due,
        appliedAmountUsd: applied,
        receivedAmountUsd: received,
        settlementDeltaUsd: Math.round(delta * 100) / 100,
        settlementType,
        method: pay.method,
        receivedAt: pay.receivedAt ? new Date(pay.receivedAt).toISOString() : null,
      }
    })

    res.json({
      summary: {
        outstandingDebtUsd: Number(p.outstandingDebtUsd) || 0,
        prepaidCreditUsd: Number(p.prepaidCreditUsd) || 0,
      },
      entries,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
