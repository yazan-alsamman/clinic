import { Router } from 'express'
import { BusinessDay } from '../models/BusinessDay.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'

export const systemRouter = Router()

systemRouter.get('/status', loadBusinessDay, (_req, res) => {
  const d = _req.businessDay
  res.json({
    businessDate: _req.businessDate,
    dayActive: Boolean(d?.active),
    usdSypRate: d?.exchangeRate ?? null,
    dayClosed: Boolean(d?.closedAt),
  })
})

systemRouter.post(
  '/start-day',
  authMiddleware,
  loadBusinessDay,
  requireRoles('super_admin'),
  async (req, res) => {
    try {
      const rate = Number(req.body?.rate)
      if (!Number.isFinite(rate) || rate <= 0) {
        res.status(400).json({ error: 'سعر صرف غير صالح' })
        return
      }
      const d = req.businessDay
      /** إعادة تفعيل اليوم نفسه (مثلاً بعد إغلاق بالخطأ): مسح الإغلاق ثم التفعيل */
      if (d.closedAt) {
        d.closedAt = null
        d.closedBy = null
      }
      d.active = true
      d.exchangeRate = rate
      d.rateSetBy = req.user._id
      d.rateSetAt = new Date()
      await d.save()
      await writeAudit({
        user: req.user,
        action: 'تفعيل يوم العمل وتحديد سعر الصرف',
        entityType: 'BusinessDay',
        entityId: d.businessDate,
        details: { rate },
      })
      res.json({
        businessDate: d.businessDate,
        dayActive: true,
        usdSypRate: d.exchangeRate,
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

systemRouter.patch(
  '/exchange-rate',
  authMiddleware,
  loadBusinessDay,
  requireRoles('super_admin'),
  async (req, res) => {
    try {
      const rate = Number(req.body?.rate)
      if (!Number.isFinite(rate) || rate <= 0) {
        res.status(400).json({ error: 'سعر صرف غير صالح' })
        return
      }
      const d = req.businessDay
      if (!d.active) {
        res.status(400).json({ error: 'فعّل اليوم أولاً' })
        return
      }
      d.exchangeRate = rate
      d.rateSetBy = req.user._id
      d.rateSetAt = new Date()
      await d.save()
      await writeAudit({
        user: req.user,
        action: 'تعديل سعر الصرف',
        entityType: 'BusinessDay',
        entityId: d.businessDate,
        details: { rate },
      })
      res.json({ usdSypRate: d.exchangeRate })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

systemRouter.post(
  '/close-day',
  authMiddleware,
  loadBusinessDay,
  requireRoles('super_admin'),
  async (req, res) => {
    try {
      if (String(req.body?.confirm || '').toUpperCase() !== 'CLOSE') {
        res.status(400).json({ error: 'تأكيد غير صالح' })
        return
      }
      const d = req.businessDay
      d.active = false
      d.closedAt = new Date()
      d.closedBy = req.user._id
      await d.save()
      await writeAudit({
        user: req.user,
        action: 'إغلاق وأرشفة اليوم',
        entityType: 'BusinessDay',
        entityId: d.businessDate,
      })
      res.json({
        businessDate: d.businessDate,
        dayActive: false,
        usdSypRate: d.exchangeRate,
        dayClosed: true,
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

/** Ensure today's row exists after midnight (optional cron); exposed for admin refresh */
systemRouter.post(
  '/ensure-today',
  authMiddleware,
  requireRoles('super_admin'),
  async (_req, res) => {
    const businessDate = todayBusinessDate()
    await BusinessDay.findOneAndUpdate(
      { businessDate },
      { $setOnInsert: { businessDate, active: false } },
      { upsert: true, new: true },
    )
    res.json({ ok: true, businessDate })
  },
)
