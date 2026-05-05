import { Router } from 'express'
import { BusinessDay } from '../models/BusinessDay.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'

export const systemRouter = Router()

systemRouter.get('/status', loadBusinessDay, (_req, res) => {
  const d = _req.businessDay
  const rate = d?.usdSypRate
  res.json({
    businessDate: _req.businessDate,
    dayActive: Boolean(d?.active),
    dayClosed: Boolean(d?.closedAt),
    usdSypRate: rate != null && Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : null,
    room1MeterStart: d?.room1MeterStart ?? null,
    room2MeterStart: d?.room2MeterStart ?? null,
    room1MeterHalfDay: d?.room1MeterHalfDay ?? null,
    room2MeterHalfDay: d?.room2MeterHalfDay ?? null,
    room1HalfDayPending: Boolean(d?.room1HalfDayPending),
    room2HalfDayPending: Boolean(d?.room2HalfDayPending),
    room1MeterEnd: d?.room1MeterEnd ?? null,
    room2MeterEnd: d?.room2MeterEnd ?? null,
  })
})

systemRouter.post(
  '/start-day',
  authMiddleware,
  loadBusinessDay,
  requireRoles('super_admin', 'reception'),
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
      const usdSypRate = Number(req.body?.usdSypRate)
      if (!Number.isFinite(usdSypRate) || usdSypRate <= 0) {
        res.status(400).json({
          error: 'أدخل سعر صرف الدولار مقابل الليرة السورية (ليرة لكل 1 USD، رقم أكبر من صفر).',
        })
        return
      }
      const d = req.businessDay
      /** الاستقبال يبدأ اليوم فقط؛ إعادة فتح يوم أُغلق سابقاً للمدير فقط */
      if (d.closedAt && req.user?.role !== 'super_admin') {
        res.status(403).json({
          error: 'إعادة تفعيل يوم كان قد أُغلق متاحة لمدير النظام فقط. اطلب من المدير إن لزم.',
        })
        return
      }
      /** إعادة تفعيل اليوم نفسه (مثلاً بعد إغلاق بالخطأ): مسح الإغلاق ثم التفعيل */
      if (d.closedAt) {
        d.closedAt = null
        d.closedBy = null
        d.room1MeterEnd = null
        d.room2MeterEnd = null
      }
      d.room1MeterHalfDay = null
      d.room2MeterHalfDay = null
      d.room1HalfDayCapturedAt = null
      d.room2HalfDayCapturedAt = null
      d.room1HalfDayPending = false
      d.room2HalfDayPending = false
      d.active = true
      d.room1MeterStart = room1MeterStart
      d.room2MeterStart = room2MeterStart
      d.usdSypRate = usdSypRate
      await d.save()
      await writeAudit({
        user: req.user,
        action: 'تفعيل يوم العمل والعدادات',
        entityType: 'BusinessDay',
        entityId: d.businessDate,
        details: { room1MeterStart, room2MeterStart, usdSypRate },
      })
      res.json({
        businessDate: d.businessDate,
        dayActive: true,
        usdSypRate: d.usdSypRate,
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

/** تسجيل قراءة عدّاد نصف اليوم لغرفة ليزر — استقبال أو مدير النظام */
systemRouter.post(
  '/record-laser-half-day-meter',
  authMiddleware,
  loadBusinessDay,
  requireRoles('super_admin', 'reception'),
  async (req, res) => {
    try {
      const d = req.businessDay
      if (!d?.active) {
        res.status(423).json({ error: 'يوم العمل غير مفعّل.' })
        return
      }
      const room = Number(req.body?.room)
      if (room !== 1 && room !== 2) {
        res.status(400).json({ error: 'رقم الغرفة يجب أن يكون 1 أو 2' })
        return
      }
      const reading = Number(req.body?.meterReading)
      if (!Number.isFinite(reading) || reading < 0) {
        res.status(400).json({ error: 'قراءة العداد غير صالحة' })
        return
      }
      const start = room === 1 ? d.room1MeterStart : d.room2MeterStart
      const s = start != null ? Number(start) : NaN
      if (!Number.isFinite(s)) {
        res.status(400).json({ error: 'لا توجد قراءة بداية اليوم لهذه الغرفة' })
        return
      }
      if (reading < s) {
        res.status(400).json({ error: 'قراءة نصف اليوم يجب ألا تقل عن قراءة بداية اليوم' })
        return
      }
      const end = room === 1 ? d.room1MeterEnd : d.room2MeterEnd
      const e = end != null ? Number(end) : NaN
      if (Number.isFinite(e) && reading > e) {
        res.status(400).json({ error: 'قراءة نصف اليوم يجب ألا تتجاوز قراءة نهاية اليوم إن وُجدت' })
        return
      }
      const now = new Date()
      if (room === 1) {
        if (d.room1MeterHalfDay != null) {
          res.status(409).json({ error: 'تم تسجيل قراءة نصف اليوم لغرفة 1 مسبقاً' })
          return
        }
        d.room1MeterHalfDay = reading
        d.room1HalfDayCapturedAt = now
        d.room1HalfDayPending = false
      } else {
        if (d.room2MeterHalfDay != null) {
          res.status(409).json({ error: 'تم تسجيل قراءة نصف اليوم لغرفة 2 مسبقاً' })
          return
        }
        d.room2MeterHalfDay = reading
        d.room2HalfDayCapturedAt = now
        d.room2HalfDayPending = false
      }
      await d.save()
      await writeAudit({
        user: req.user,
        action: 'تسجيل قراءة عدّاد نصف اليوم — ليزر',
        entityType: 'BusinessDay',
        entityId: d.businessDate,
        details: { room, meterReading: reading },
      })
      res.json({
        businessDate: d.businessDate,
        room1MeterHalfDay: d.room1MeterHalfDay ?? null,
        room2MeterHalfDay: d.room2MeterHalfDay ?? null,
        room1HalfDayPending: Boolean(d.room1HalfDayPending),
        room2HalfDayPending: Boolean(d.room2HalfDayPending),
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
