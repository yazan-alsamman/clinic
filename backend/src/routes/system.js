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
    dayClosed: Boolean(d?.closedAt),
    room1MeterStart: d?.room1MeterStart ?? null,
    room2MeterStart: d?.room2MeterStart ?? null,
    room1MeterEnd: d?.room1MeterEnd ?? null,
    room2MeterEnd: d?.room2MeterEnd ?? null,
  })
})

systemRouter.post(
  '/start-day',
  authMiddleware,
  loadBusinessDay,
  requireRoles('super_admin'),
  async (req, res) => {
    try {
      const room1MeterStart = Number(req.body?.room1MeterStart)
      const room2MeterStart = Number(req.body?.room2MeterStart)
      if (!Number.isFinite(room1MeterStart) || room1MeterStart < 0) {
        res.status(400).json({ error: 'قراءة عداد غرفة 1 في بداية اليوم غير صالحة' })
        return
      }
      if (!Number.isFinite(room2MeterStart) || room2MeterStart < 0) {
        res.status(400).json({ error: 'قراءة عداد غرفة 2 في بداية اليوم غير صالحة' })
        return
      }
      const d = req.businessDay
      /** إعادة تفعيل اليوم نفسه (مثلاً بعد إغلاق بالخطأ): مسح الإغلاق ثم التفعيل */
      if (d.closedAt) {
        d.closedAt = null
        d.closedBy = null
        d.room1MeterEnd = null
        d.room2MeterEnd = null
      }
      d.active = true
      d.room1MeterStart = room1MeterStart
      d.room2MeterStart = room2MeterStart
      await d.save()
      await writeAudit({
        user: req.user,
        action: 'تفعيل يوم العمل والعدادات',
        entityType: 'BusinessDay',
        entityId: d.businessDate,
        details: { room1MeterStart, room2MeterStart },
      })
      res.json({
        businessDate: d.businessDate,
        dayActive: true,
        room1MeterStart: d.room1MeterStart,
        room2MeterStart: d.room2MeterStart,
      })
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
      const confirm = String(req.body?.confirm || '').trim().toLowerCase()
      if (confirm !== 'close') {
        res.status(400).json({ error: 'اكتب كلمة close للتأكيد' })
        return
      }
      const room1MeterEnd = Number(req.body?.room1MeterEnd)
      const room2MeterEnd = Number(req.body?.room2MeterEnd)
      if (!Number.isFinite(room1MeterEnd) || room1MeterEnd < 0) {
        res.status(400).json({ error: 'قراءة عداد غرفة 1 في نهاية اليوم غير صالحة' })
        return
      }
      if (!Number.isFinite(room2MeterEnd) || room2MeterEnd < 0) {
        res.status(400).json({ error: 'قراءة عداد غرفة 2 في نهاية اليوم غير صالحة' })
        return
      }
      const d = req.businessDay
      const s1 = d.room1MeterStart
      const s2 = d.room2MeterStart
      if (Number.isFinite(s1) && room1MeterEnd < s1) {
        res.status(400).json({ error: 'عداد غرفة 1 في النهاية يجب ألا يقل عن قراءة البداية' })
        return
      }
      if (Number.isFinite(s2) && room2MeterEnd < s2) {
        res.status(400).json({ error: 'عداد غرفة 2 في النهاية يجب ألا يقل عن قراءة البداية' })
        return
      }
      d.room1MeterEnd = room1MeterEnd
      d.room2MeterEnd = room2MeterEnd
      d.active = false
      d.closedAt = new Date()
      d.closedBy = req.user._id
      await d.save()
      await writeAudit({
        user: req.user,
        action: 'إغلاق وأرشفة اليوم',
        entityType: 'BusinessDay',
        entityId: d.businessDate,
        details: { room1MeterEnd, room2MeterEnd },
      })
      res.json({
        businessDate: d.businessDate,
        dayActive: false,
        dayClosed: true,
        room1MeterEnd: d.room1MeterEnd,
        room2MeterEnd: d.room2MeterEnd,
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
