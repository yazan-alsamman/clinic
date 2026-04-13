import { Router } from 'express'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { todayBusinessDate, addCalendarDaysYmd, isValidYmd } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'
import {
  normalizeHm,
  hmToMinutes,
  slotIntervalMinutes,
  intervalsOverlapHalfOpen,
} from '../utils/scheduleTime.js'

export const scheduleRouter = Router()

scheduleRouter.use(authMiddleware)

const providerRoles = ['laser', 'dermatology', 'dental_branch']

/**
 * مواعيد محجوزة: إما يوم واحد `?date=YYYY-MM-DD` أو نطاق `from` / `to` (للتوافق).
 * المدير والاستقبال: الكل — المقدّمون: حيث providerName = اسم المستخدم
 */
scheduleRouter.get(
  '/booked',
  loadBusinessDay,
  requireRoles('super_admin', 'reception', 'laser', 'dermatology', 'dental_branch'),
  async (req, res) => {
    try {
      const role = req.user.role
      const isProvider = providerRoles.includes(role)

      let from
      let to
      if (isProvider) {
        /** مقدّمو الخدمة: دائماً يوم العمل الحالي فقط — تجاهل أي تاريخ في الطلب */
        const day = req.businessDate || todayBusinessDate()
        from = day
        to = day
      } else {
        const single = String(req.query.date || '').trim()
        let fromQ = String(req.query.from || '').trim()
        let toQ = String(req.query.to || '').trim()

        if (isValidYmd(single)) {
          from = single
          to = single
        } else {
          if (!isValidYmd(fromQ)) fromQ = todayBusinessDate()
          if (!isValidYmd(toQ)) toQ = addCalendarDaysYmd(fromQ, 89)
          if (fromQ > toQ) {
            res.status(400).json({ error: 'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية' })
            return
          }
          from = fromQ
          to = toQ
        }
      }

      const filter = {
        patientId: { $ne: null },
        businessDate: { $gte: from, $lte: to },
      }
      let scopedToProvider = false
      if (isProvider) {
        const name = String(req.user.name || '').trim()
        if (!name) {
          res.json({
            from,
            to,
            scopedToProvider: true,
            slots: [],
          })
          return
        }
        filter.providerName = name
        scopedToProvider = true
      }

      const slots = await ScheduleSlot.find(filter)
        .sort({ businessDate: 1, providerName: 1, time: 1 })
        .lean()
      res.json({
        from,
        to,
        scopedToProvider,
        slots: slots.map(slotToDto),
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

scheduleRouter.use(requireRoles('super_admin', 'reception'))

function defaultEndFromStart(timeStr) {
  const s = hmToMinutes(timeStr)
  if (s == null) return ''
  const e = s + 30
  const h = Math.floor(e / 60)
  const m = e % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** أسماء الأطباء والأخصائيين (مستخدمون نشطون + أسماء مذكورة في مواعيد محجوزة) */
scheduleRouter.get('/providers', async (_req, res) => {
  try {
    const clinical = await User.find({
      role: { $in: ['laser', 'dermatology', 'dental_branch', 'solarium'] },
      active: true,
    })
      .select('name')
      .sort({ name: 1 })
      .lean()
    const fromUsers = clinical.map((u) => u.name).filter(Boolean)
    const fromSlots = await ScheduleSlot.distinct('providerName', { patientId: { $ne: null } })
    const fromSlotsClean = fromSlots.filter(Boolean)
    const merged = new Set([...fromUsers, ...fromSlotsClean])
    const providers = [...merged].sort((a, b) => a.localeCompare(b, 'ar'))
    res.json({ providers })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

function slotToDto(s) {
  const o = s.toObject ? s.toObject() : s
  const busy = Boolean(o.patientId)
  const startNorm = normalizeHm(o.time)
  let endTime = defaultEndFromStart(o.time)
  const rawEnd = o.endTime && String(o.endTime).trim()
  if (rawEnd) {
    const en = normalizeHm(rawEnd)
    const sm = hmToMinutes(startNorm)
    const em = hmToMinutes(en)
    if (en && sm != null && em != null && em > sm) endTime = en
  }
  return {
    id: String(o._id),
    businessDate: o.businessDate,
    time: o.time,
    endTime,
    providerName: o.providerName,
    procedureType: String(o.procedureType || '').trim(),
    status: busy ? 'busy' : 'free',
    patientId: o.patientId ? String(o.patientId) : null,
    patientName: o.patientName || '',
  }
}

/** مواعيد محجوزة فقط — لا قالب أوقات فراغ؛ الحجز بأي وقت عبر assign طالما لا تعارض */
scheduleRouter.get('/', async (req, res) => {
  try {
    const businessDate = String(req.query.date || '').trim() || todayBusinessDate()
    const slots = await ScheduleSlot.find({
      businessDate,
      patientId: { $ne: null },
    })
      .sort({ time: 1, providerName: 1 })
      .lean()
    res.json({ businessDate, slots: slots.map(slotToDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.post('/assign', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    const body = req.body ?? {}
    const businessDate = String(body.businessDate || '').trim() || todayBusinessDate()
    const time = normalizeHm(body.time)
    const endTime = normalizeHm(body.endTime)
    const providerName = String(body.providerName || '').trim()
    const procedureType = String(body.procedureType || '')
      .trim()
      .slice(0, 200)
    const patientId = body.patientId
    if (!time || !endTime || !providerName || !patientId) {
      res.status(400).json({ error: 'وقت البداية ووقت النهاية والمقدّم والمريض مطلوبان' })
      return
    }
    if (!procedureType) {
      res.status(400).json({ error: 'نوع الإجراء مطلوب' })
      return
    }
    const startMin = hmToMinutes(time)
    const endMin = hmToMinutes(endTime)
    if (startMin == null || endMin == null || endMin <= startMin) {
      res.status(400).json({ error: 'وقت النهاية يجب أن يكون بعد وقت البداية' })
      return
    }
    const patient = await Patient.findById(patientId)
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const sameProvSlots = await ScheduleSlot.find({ businessDate, providerName }).lean()
    const existing = sameProvSlots.find((o) => normalizeHm(o.time) === time) ?? null
    if (existing?.patientId && String(existing.patientId) !== String(patient._id)) {
      res.status(409).json({ error: 'هذه الخانة محجوزة لمريض آخر' })
      return
    }
    // عدة مواعيد لنفس المقدّم في اليوم مسموحة؛ يُرفض فقط التداخل الزمني بين [بداية، نهاية) الفترة الجديدة
    // وأي موعد آخر (باستثناء نفس سجل وقت البداية عند التحديث).
    for (const o of sameProvSlots) {
      if (!o.patientId) continue
      if (normalizeHm(o.time) === time) continue
      const iv = slotIntervalMinutes(o)
      if (!iv) continue
      if (intervalsOverlapHalfOpen(startMin, endMin, iv.start, iv.end)) {
        res.status(409).json({
          error:
            'فترة الموعد (من وقت البداية إلى النهاية) تتداخل مع موعد آخر لنفس المقدّم في هذا اليوم — اختر أوقاتاً لا تتقاطع مع المواعيد الحالية',
        })
        return
      }
    }
    const filter = existing ? { _id: existing._id } : { businessDate, time, providerName }
    const slot = await ScheduleSlot.findOneAndUpdate(
      filter,
      {
        $set: {
          businessDate,
          time,
          endTime,
          providerName,
          procedureType,
          patientId: patient._id,
          patientName: patient.name,
        },
      },
      { new: true, upsert: !existing },
    )
    patient.lastVisit = new Date()
    await patient.save()
    await writeAudit({
      user: req.user,
      action: 'تعيين موعد لمريض',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: {
        businessDate,
        time,
        endTime,
        providerName,
        procedureType,
        patientId: String(patient._id),
      },
    })
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    if (e.code === 11000) {
      res.status(400).json({ error: 'تعارض في بيانات الموعد' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.post('/clear', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    const body = req.body ?? {}
    const businessDate = String(body.businessDate || '').trim() || todayBusinessDate()
    const time = normalizeHm(body.time)
    const providerName = String(body.providerName || '').trim()
    if (!time || !providerName) {
      res.status(400).json({ error: 'الوقت والمقدّم مطلوبان' })
      return
    }
    const sameProvSlots = await ScheduleSlot.find({ businessDate, providerName }).lean()
    const hit = sameProvSlots.find((o) => normalizeHm(o.time) === time)
    if (!hit?._id) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    const slot = await ScheduleSlot.findByIdAndDelete(hit._id)
    if (!slot) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    await writeAudit({
      user: req.user,
      action: 'إلغاء موعد وحذف السجل',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate, time, providerName },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
