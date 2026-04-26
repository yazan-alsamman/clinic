import { Router } from 'express'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { Room } from '../models/Room.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { todayBusinessDate, addCalendarDaysYmd, isValidYmd } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'
import { notifyAppointmentCancelled } from '../services/scheduleCancelNotify.js'
import {
  normalizeHm,
  hmToMinutes,
  slotIntervalMinutes,
  intervalsOverlapHalfOpen,
} from '../utils/scheduleTime.js'

export const scheduleRouter = Router()

scheduleRouter.use(authMiddleware)

const providerRoles = ['laser', 'dermatology', 'dental_branch']
const SERVICE_TYPES = ['laser', 'dental', 'dermatology', 'solarium', 'other']

function normalizeServiceType(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
  if (s === 'laser' || s === 'ليزر') return 'laser'
  if (s === 'dental' || s === 'أسنان' || s === 'اسنان') return 'dental'
  if (s === 'dermatology' || s === 'جلدية' || s === 'بشرة') return 'dermatology'
  if (s === 'solarium' || s === 'سولاريوم') return 'solarium'
  return 'other'
}

function inferRoomNumber(providerNameRaw) {
  const m = String(providerNameRaw || '').match(/room\s*(\d+)/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function inShift(slotMin, startMin, endMin) {
  return slotMin >= startMin && slotMin < endMin
}

function roomShiftBounds(room) {
  const morningShiftStart = normalizeHm(room?.morningShiftStart) || '09:00'
  const morningShiftEnd = normalizeHm(room?.morningShiftEnd) || '15:00'
  const eveningShiftStart = normalizeHm(room?.eveningShiftStart) || '15:00'
  const eveningShiftEnd = normalizeHm(room?.eveningShiftEnd) || '21:00'
  return {
    morningShiftStart,
    morningShiftEnd,
    eveningShiftStart,
    eveningShiftEnd,
    morningStartMin: hmToMinutes(morningShiftStart),
    morningEndMin: hmToMinutes(morningShiftEnd),
    eveningStartMin: hmToMinutes(eveningShiftStart),
    eveningEndMin: hmToMinutes(eveningShiftEnd),
  }
}

function pickAssignedForTime(room, timeStr) {
  const slotMin = hmToMinutes(normalizeHm(timeStr))
  if (slotMin == null) return null
  const b = roomShiftBounds(room)
  if (
    b.morningStartMin == null ||
    b.morningEndMin == null ||
    b.eveningStartMin == null ||
    b.eveningEndMin == null
  ) {
    return room?.assignedUserId || null
  }
  if (inShift(slotMin, b.morningStartMin, b.morningEndMin)) {
    return room?.morningAssignedUserId || room?.assignedUserId || null
  }
  if (inShift(slotMin, b.eveningStartMin, b.eveningEndMin)) {
    return room?.eveningAssignedUserId || room?.assignedUserId || null
  }
  return null
}

async function resolveProviderAssignment({ serviceType, providerName, roomNumberRaw, timeStr }) {
  let effectiveProviderName = String(providerName || '').trim()
  let roomNumber = null
  let assignedSpecialistUserId = null
  let assignedSpecialistName = ''
  if (serviceType === 'laser') {
    const bodyRoom = Number(roomNumberRaw)
    roomNumber = Number.isFinite(bodyRoom) && bodyRoom > 0 ? Math.trunc(bodyRoom) : inferRoomNumber(providerName)
    if (!roomNumber) {
      return { error: 'رقم غرفة الليزر مطلوب للحجز' }
    }
    const room = await Room.findOne({ number: roomNumber })
      .populate('assignedUserId', 'name')
      .populate('morningAssignedUserId', 'name')
      .populate('eveningAssignedUserId', 'name')
    const assignedForShift = pickAssignedForTime(room, timeStr)
    if (!assignedForShift) {
      return { error: 'لا يوجد أخصائي مخصص لهذه الغرفة في وقت الموعد. عدّل الورديات من لوحة المدير.' }
    }
    effectiveProviderName = `Laser Room ${roomNumber}`
    assignedSpecialistUserId = assignedForShift._id
    assignedSpecialistName = assignedForShift.name || ''
  }
  return { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName }
}

async function assertNoOverlapForProvider({ businessDate, providerName, startTime, endTime, ignoreId = null }) {
  const startMin = hmToMinutes(startTime)
  const endMin = hmToMinutes(endTime)
  if (startMin == null || endMin == null || endMin <= startMin) {
    return { error: 'وقت النهاية يجب أن يكون بعد وقت البداية' }
  }
  const sameProvSlots = await ScheduleSlot.find({ businessDate, providerName }).lean()
  for (const o of sameProvSlots) {
    if (!o.patientId) continue
    if (ignoreId && String(o._id) === String(ignoreId)) continue
    const iv = slotIntervalMinutes(o)
    if (!iv) continue
    if (intervalsOverlapHalfOpen(startMin, endMin, iv.start, iv.end)) {
      return {
        error:
          'فترة الموعد (من وقت البداية إلى النهاية) تتداخل مع موعد آخر لنفس المقدّم في هذا اليوم — اختر أوقاتاً لا تتقاطع مع المواعيد الحالية',
      }
    }
  }
  return { ok: true }
}

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
        if (!name && req.user.role !== 'laser') {
          res.json({
            from,
            to,
            scopedToProvider: true,
            slots: [],
          })
          return
        }
        if (req.user.role === 'laser') {
          filter.$or = [{ assignedSpecialistUserId: req.user._id }, { providerName: name }]
        } else {
          filter.providerName = name
        }
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

/** خيارات أخصائيي الليزر المعيّنين على الغرف (للاستقبال/المدير) */
scheduleRouter.get('/laser-provider-options', async (_req, res) => {
  try {
    const slotTime = normalizeHm(_req.query.time) || '09:00'
    const rooms = await Room.find({
      $or: [{ morningAssignedUserId: { $ne: null } }, { eveningAssignedUserId: { $ne: null } }, { assignedUserId: { $ne: null } }],
    })
      .populate('morningAssignedUserId', 'name role')
      .populate('eveningAssignedUserId', 'name role')
      .populate('assignedUserId', 'name role')
      .sort({ number: 1 })
      .lean()
    const providers = rooms
      .map((r) => {
        const assigned = pickAssignedForTime(r, slotTime)
        if (!assigned?.name) return null
        return {
          roomNumber: r.number,
          userId: String(assigned._id),
          name: String(assigned.name || '').trim(),
        }
      })
      .filter(Boolean)
      .map((r) => ({
        roomNumber: r.roomNumber,
        userId: r.userId,
        name: r.name,
      }))
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
    serviceType: SERVICE_TYPES.includes(o.serviceType) ? o.serviceType : 'other',
    roomNumber: Number.isFinite(Number(o.roomNumber)) ? Number(o.roomNumber) : null,
    assignedSpecialistUserId: o.assignedSpecialistUserId ? String(o.assignedSpecialistUserId) : null,
    assignedSpecialistName: String(o.assignedSpecialistName || '').trim(),
    arrivedAt: o.arrivedAt || null,
    arrivedByUserId: o.arrivedByUserId ? String(o.arrivedByUserId) : null,
    arrivedByName: String(o.arrivedByName || '').trim(),
    laserSessionId: o.laserSessionId ? String(o.laserSessionId) : null,
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
    const serviceType = normalizeServiceType(body.serviceType)
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
    const resolved = await resolveProviderAssignment({
      serviceType,
      providerName,
      roomNumberRaw: body.roomNumber,
      timeStr: time,
    })
    if (resolved.error) {
      res.status(400).json({ error: resolved.error })
      return
    }
    const { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName } = resolved
    const sameProvSlots = await ScheduleSlot.find({ businessDate, providerName: effectiveProviderName }).lean()
    const existing = sameProvSlots.find((o) => normalizeHm(o.time) === time) ?? null
    if (existing?.patientId && String(existing.patientId) !== String(patient._id)) {
      res.status(409).json({ error: 'هذه الخانة محجوزة لمريض آخر' })
      return
    }
    const overlapCheck = await assertNoOverlapForProvider({
      businessDate,
      providerName: effectiveProviderName,
      startTime: time,
      endTime,
      ignoreId: existing?._id ?? null,
    })
    if (overlapCheck.error) {
      res.status(409).json({ error: overlapCheck.error })
      return
    }
    const filter = existing ? { _id: existing._id } : { businessDate, time, providerName: effectiveProviderName }
    const slot = await ScheduleSlot.findOneAndUpdate(
      filter,
      {
        $set: {
          businessDate,
          time,
          endTime,
          providerName: effectiveProviderName,
          serviceType,
          roomNumber,
          assignedSpecialistUserId,
          assignedSpecialistName,
          procedureType,
          patientId: patient._id,
          patientName: patient.name,
          arrivedAt: null,
          arrivedByUserId: null,
          arrivedByName: '',
          laserSessionId: null,
        },
      },
      { new: true, upsert: !existing },
    )
    // Avoid full-document validation on legacy records that may miss newly required fields
    // (e.g. fileNumber), while still updating "lastVisit" for appointment activity.
    await Patient.updateOne({ _id: patient._id }, { $set: { lastVisit: new Date() } })
    await writeAudit({
      user: req.user,
      action: 'تعيين موعد لمريض',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: {
        businessDate,
        time,
        endTime,
        providerName: effectiveProviderName,
        serviceType,
        roomNumber,
        assignedSpecialistName,
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

scheduleRouter.get('/arrived', async (req, res) => {
  try {
    const businessDate = String(req.query.date || '').trim() || todayBusinessDate()
    const slots = await ScheduleSlot.find({
      businessDate,
      patientId: { $ne: null },
      arrivedAt: { $ne: null },
    })
      .sort({ arrivedAt: -1, time: 1 })
      .lean()
    res.json({ businessDate, slots: slots.map(slotToDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.post('/arrive/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    const slot = await ScheduleSlot.findById(req.params.id)
    if (!slot || !slot.patientId) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    slot.arrivedAt = new Date()
    slot.arrivedByUserId = req.user._id
    slot.arrivedByName = String(req.user.name || '').trim()
    await slot.save()
    await writeAudit({
      user: req.user,
      action: 'تسجيل وصول مريض للعيادة',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate: slot.businessDate, time: slot.time, providerName: slot.providerName },
    })
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.patch('/reschedule/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    const slot = await ScheduleSlot.findById(req.params.id)
    if (!slot || !slot.patientId) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    const body = req.body ?? {}
    const businessDate = String(body.businessDate || slot.businessDate).trim() || slot.businessDate
    const time = normalizeHm(body.time || slot.time)
    const endTime = normalizeHm(body.endTime || slot.endTime)
    const serviceType = normalizeServiceType(body.serviceType || slot.serviceType)
    const requestedProvider = String(body.providerName || slot.providerName || '').trim()
    const procedureType = String(body.procedureType ?? slot.procedureType ?? '')
      .trim()
      .slice(0, 200)
    if (!time || !endTime || !requestedProvider || !procedureType) {
      res.status(400).json({ error: 'بيانات الموعد غير مكتملة' })
      return
    }
    const resolved = await resolveProviderAssignment({
      serviceType,
      providerName: requestedProvider,
      roomNumberRaw: body.roomNumber ?? slot.roomNumber,
      timeStr: time,
    })
    if (resolved.error) {
      res.status(400).json({ error: resolved.error })
      return
    }
    const { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName } = resolved
    const overlapCheck = await assertNoOverlapForProvider({
      businessDate,
      providerName: effectiveProviderName,
      startTime: time,
      endTime,
      ignoreId: slot._id,
    })
    if (overlapCheck.error) {
      res.status(409).json({ error: overlapCheck.error })
      return
    }
    slot.businessDate = businessDate
    slot.time = time
    slot.endTime = endTime
    slot.providerName = effectiveProviderName
    slot.serviceType = serviceType
    slot.roomNumber = roomNumber
    slot.assignedSpecialistUserId = assignedSpecialistUserId
    slot.assignedSpecialistName = assignedSpecialistName
    slot.procedureType = procedureType
    await slot.save()
    await writeAudit({
      user: req.user,
      action: 'تغيير وقت موعد',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate, time, endTime, providerName: effectiveProviderName, procedureType },
    })
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.patch('/provider/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    const slot = await ScheduleSlot.findById(req.params.id)
    if (!slot || !slot.patientId) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    const body = req.body ?? {}
    const serviceType = normalizeServiceType(body.serviceType || slot.serviceType)
    const requestedProvider = String(body.providerName || slot.providerName || '').trim()
    const resolved = await resolveProviderAssignment({
      serviceType,
      providerName: requestedProvider,
      roomNumberRaw: body.roomNumber ?? slot.roomNumber,
      timeStr: slot.time,
    })
    if (resolved.error) {
      res.status(400).json({ error: resolved.error })
      return
    }
    const { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName } = resolved
    const overlapCheck = await assertNoOverlapForProvider({
      businessDate: slot.businessDate,
      providerName: effectiveProviderName,
      startTime: slot.time,
      endTime: normalizeHm(slot.endTime || defaultEndFromStart(slot.time)),
      ignoreId: slot._id,
    })
    if (overlapCheck.error) {
      res.status(409).json({ error: overlapCheck.error })
      return
    }
    slot.providerName = effectiveProviderName
    slot.serviceType = serviceType
    slot.roomNumber = roomNumber
    slot.assignedSpecialistUserId = assignedSpecialistUserId
    slot.assignedSpecialistName = assignedSpecialistName
    await slot.save()
    await writeAudit({
      user: req.user,
      action: 'تغيير مقدم الموعد',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { providerName: effectiveProviderName, serviceType, roomNumber, assignedSpecialistName },
    })
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.delete('/cancel/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    const slot = await ScheduleSlot.findById(req.params.id).lean()
    if (!slot) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    if (slot.patientId) {
      try {
        await notifyAppointmentCancelled(slot, req.user)
      } catch (notifyErr) {
        console.error('notifyAppointmentCancelled:', notifyErr)
      }
    }
    await ScheduleSlot.deleteOne({ _id: slot._id })
    await writeAudit({
      user: req.user,
      action: 'إلغاء موعد',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate: slot.businessDate, time: slot.time, providerName: slot.providerName },
    })
    res.json({ ok: true })
  } catch (e) {
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
    if (slot.patientId) {
      try {
        await notifyAppointmentCancelled(slot.toObject ? slot.toObject() : slot, req.user)
      } catch (notifyErr) {
        console.error('notifyAppointmentCancelled:', notifyErr)
      }
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
