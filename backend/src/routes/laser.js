import { Router } from 'express'
import { LaserAreaCatalog } from '../models/LaserAreaCatalog.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { nextSequence } from '../models/Counter.js'
import { writeAudit } from '../utils/audit.js'
import { postLaserSessionIfCompleted } from '../services/postingService.js'
import { todayBusinessDate } from '../utils/date.js'
import { round2 } from '../utils/money.js'

export const laserRouter = Router()
laserRouter.use(authMiddleware, loadBusinessDay)

/** استقبال: كتالوج وجلسات المريض من ملف المريض — وليس لوحة «جلسات اليوم» */
const LASER_READ = ['super_admin', 'laser', 'reception']
const LASER_TODAY_PAGE = ['super_admin', 'laser']
/** تسجيل جلسة من ملف المريض: ليزر + مدير (الاستقبال يعرض السجل فقط من نظرة عامة) */
const LASER_SESSION_CREATE = ['super_admin', 'laser']
const LASER_STATUS_VALUES = ['scheduled', 'in_progress', 'completed_pending_collection', 'completed']
function resolveUsdAmount({ usdRaw, sypRaw, exchangeRate, allowZero = false }) {
  const usd = Number(usdRaw)
  if (Number.isFinite(usd) && (allowZero ? usd >= 0 : usd > 0)) return round2(usd)
  const syp = Number(sypRaw)
  if (Number.isFinite(syp) && (allowZero ? syp >= 0 : syp > 0)) {
    const rate = Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) return null
    return round2(syp / rate)
  }
  return null
}

laserRouter.get('/catalog', async (req, res) => {
  try {
    if (!LASER_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const rows = await LaserAreaCatalog.find({ active: true }).sort({
      categoryId: 1,
      sortOrder: 1,
    })
    const byCat = new Map()
    for (const r of rows) {
      if (!byCat.has(r.categoryId)) {
        byCat.set(r.categoryId, { id: r.categoryId, title: r.categoryTitle, areas: [] })
      }
      byCat.get(r.categoryId).areas.push({
        id: r.areaId,
        label: r.label,
        minutes: r.minutes,
      })
    }
    res.json({ categories: [...byCat.values()] })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/sessions/today', async (req, res) => {
  try {
    if (!LASER_TODAY_PAGE.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const sessions = await LaserSession.find({
      createdAt: { $gte: start, $lt: end },
    })
      .populate('patientId', 'name')
      .populate('operatorUserId', 'name')
      .sort({ createdAt: -1 })
    res.json({
      sessions: sessions.map((s) => ({
        id: String(s._id),
        treatmentNumber: s.treatmentNumber,
        patientName: s.patientId?.name ?? '',
        patientId: String(s.patientId?._id ?? s.patientId),
        room: s.room,
        laserType: s.laserType,
        status: s.status,
        createdAt: s.createdAt,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.patch(
  '/sessions/:id/status',
  requireActiveDay,
  requireRoles('super_admin', 'laser'),
  async (req, res) => {
    try {
      const status = String(req.body?.status ?? '').trim()
      if (!LASER_STATUS_VALUES.includes(status)) {
        res.status(400).json({ error: 'حالة غير صالحة' })
        return
      }
      const s = await LaserSession.findById(req.params.id)
      if (!s) {
        res.status(404).json({ error: 'الجلسة غير موجودة' })
        return
      }
      if (status === 'completed_pending_collection' && !s.billingItemId) {
        res.status(400).json({ error: 'هذه الحالة مخصصة لجلسات لها بند تحصيل' })
        return
      }

      let nextStatus = status
      if (status === 'completed' && s.billingItemId) {
        const bi = await BillingItem.findById(s.billingItemId).lean()
        if (bi?.status === 'paid') {
          nextStatus = 'completed'
        } else {
          nextStatus = 'completed_pending_collection'
        }
      }

      const prev = s.status
      s.status = nextStatus
      await s.save()
      if (nextStatus === 'completed' && !s.billingItemId) {
        try {
          await postLaserSessionIfCompleted(s, req.user._id)
        } catch (postErr) {
          console.error('accounting post laser:', postErr)
        }
      }
      await writeAudit({
        user: req.user,
        action: 'تغيير حالة جلسة ليزر',
        entityType: 'LaserSession',
        entityId: s._id,
        details: { from: prev, to: nextStatus },
      })
      res.json({
        session: {
          id: String(s._id),
          status: s.status,
          treatmentNumber: s.treatmentNumber,
        },
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

laserRouter.get('/sessions', async (req, res) => {
  try {
    if (!LASER_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const patientId = req.query.patientId
    if (!patientId) {
      res.status(400).json({ error: 'patientId مطلوب' })
      return
    }
    const list = await LaserSession.find({ patientId }).sort({ createdAt: -1 })
    res.json({ sessions: list })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.post('/sessions', requireActiveDay, requireRoles(...LASER_SESSION_CREATE), async (req, res) => {
  try {
    const body = req.body ?? {}
    const patient = await Patient.findById(body.patientId)
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }

    const costGross = resolveUsdAmount({
      usdRaw: body.costUsd,
      sypRaw: body.costSyp,
      exchangeRate: req.businessDay?.exchangeRate,
    })
    const discountPercent = Math.min(100, Math.max(0, Number(body.discountPercent) || 0))
    if (!(costGross > 0)) {
      res.status(400).json({ error: 'أدخل المبلغ الإجمالي بالدولار أو الليرة (قيمة أكبر من صفر)' })
      return
    }
    const amountDueUsd = round2(costGross * (1 - discountPercent / 100))
    if (amountDueUsd <= 0) {
      res.status(400).json({ error: 'المبلغ بعد الحسم يجب أن يكون أكبر من صفر' })
      return
    }

    const areaIds = Array.isArray(body.areaIds) ? body.areaIds.map(String) : []
    const manualRaw = Array.isArray(body.manualAreaLabels) ? body.manualAreaLabels : []
    const manualAreaLabels = [
      ...new Set(
        manualRaw
          .map((x) => String(x ?? '').trim().slice(0, 120))
          .filter(Boolean),
      ),
    ].slice(0, 20)

    const laserType = body.laserType || 'Mix'
    const businessDate = String(body.businessDate || '').trim() || req.businessDate || todayBusinessDate()

    const catalogRows =
      areaIds.length > 0
        ? await LaserAreaCatalog.find({ areaId: { $in: areaIds } }).lean()
        : []
    const labelByArea = new Map(catalogRows.map((r) => [r.areaId, r.label]))
    const catalogPart = areaIds.length
      ? areaIds.map((id) => labelByArea.get(id) || id).join('، ')
      : ''
    const manualPart = manualAreaLabels.length ? manualAreaLabels.join('، ') : ''
    const areaPart = [catalogPart, manualPart].filter(Boolean).join(' — ') || 'بدون مناطق محددة'
    const procedureDescription = `ليزر ${laserType} — ${areaPart}`.slice(0, 500)

    const treatmentNumber = await nextSequence('laserTreatment')

    let s = null
    let cs = null
    let bi = null
    try {
      s = await LaserSession.create({
        treatmentNumber,
        patientId: patient._id,
        operatorUserId: req.user._id,
        room: String(body.room ?? '1'),
        laserType,
        pw: body.pw ?? '',
        pulse: body.pulse ?? '',
        shotCount: body.shotCount ?? '',
        notes: body.notes ?? '',
        areaIds,
        manualAreaLabels,
        status: body.status || 'scheduled',
        costUsd: costGross,
        discountPercent,
      })

      cs = await ClinicalSession.create({
        patientId: patient._id,
        providerUserId: req.user._id,
        department: 'laser',
        procedureDescription,
        sessionFeeUsd: amountDueUsd,
        businessDate,
        notes: String(body.notes ?? '').trim().slice(0, 2000),
        laserSessionId: s._id,
        materials: [],
        materialCostUsdTotal: 0,
      })

      bi = await BillingItem.create({
        clinicalSessionId: cs._id,
        patientId: patient._id,
        providerUserId: req.user._id,
        department: 'laser',
        procedureLabel: procedureDescription.slice(0, 200) || 'ليزر',
        amountDueUsd,
        currency: 'USD',
        businessDate,
        status: 'pending_payment',
      })

      cs.billingItemId = bi._id
      await cs.save()

      s.billingItemId = bi._id
      s.clinicalSessionId = cs._id
      await s.save()
    } catch (inner) {
      if (bi?._id) await BillingItem.deleteOne({ _id: bi._id })
      if (cs?._id) await ClinicalSession.deleteOne({ _id: cs._id })
      if (s?._id) await LaserSession.findByIdAndDelete(s._id)
      console.error(inner)
      res.status(500).json({ error: 'تعذر حفظ الجلسة أو إنشاء بند الفوترة' })
      return
    }

    await writeAudit({
      user: req.user,
      action: 'إنشاء جلسة ليزر وبند فوترة معلّق',
      entityType: 'LaserSession',
      entityId: s._id,
      details: { billingItemId: String(bi._id), amountDueUsd },
    })

    if (!patient.departments.includes('laser')) {
      patient.departments = [...new Set([...patient.departments, 'laser'])]
      patient.lastVisit = new Date()
      await patient.save()
    }

    res.status(201).json({
      session: s,
      billingItem: {
        id: String(bi._id),
        status: bi.status,
        amountDueUsd: bi.amountDueUsd,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
