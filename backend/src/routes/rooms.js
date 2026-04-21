import { Router } from 'express'
import { Room } from '../models/Room.js'
import { User } from '../models/User.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { writeAudit } from '../utils/audit.js'
import { normalizeHm, hmToMinutes } from '../utils/scheduleTime.js'

export const roomsRouter = Router()

roomsRouter.use(authMiddleware, requireRoles('super_admin'))
const DEFAULT_MORNING_START = '09:00'
const DEFAULT_MORNING_END = '15:00'
const DEFAULT_EVENING_START = '15:00'
const DEFAULT_EVENING_END = '21:00'

roomsRouter.get('/', async (_req, res) => {
  try {
    const rooms = await Room.find()
      .sort({ number: 1 })
      .populate('assignedUserId', 'name role')
      .populate('morningAssignedUserId', 'name role')
      .populate('eveningAssignedUserId', 'name role')
    res.json({
      rooms: rooms.map((r) => ({
        number: r.number,
        morningAssigned: r.morningAssignedUserId
          ? { id: String(r.morningAssignedUserId._id), name: r.morningAssignedUserId.name }
          : null,
        eveningAssigned: r.eveningAssignedUserId
          ? { id: String(r.eveningAssignedUserId._id), name: r.eveningAssignedUserId.name }
          : null,
        morningShiftStart: r.morningShiftStart || DEFAULT_MORNING_START,
        morningShiftEnd: r.morningShiftEnd || DEFAULT_MORNING_END,
        eveningShiftStart: r.eveningShiftStart || DEFAULT_EVENING_START,
        eveningShiftEnd: r.eveningShiftEnd || DEFAULT_EVENING_END,
        assigned: r.assignedUserId
          ? { id: String(r.assignedUserId._id), name: r.assignedUserId.name }
          : null,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

roomsRouter.patch('/:number/assign', async (req, res) => {
  try {
    const num = Number(req.params.number)
    if (!Number.isFinite(num)) {
      res.status(400).json({ error: 'رقم غرفة غير صالح' })
      return
    }
    const userId = req.body?.userId
    const morningUserId = req.body?.morningUserId
    const eveningUserId = req.body?.eveningUserId
    const current = await Room.findOne({ number: num }).lean()

    let assignedUserId = null
    let morningAssignedUserId = null
    let eveningAssignedUserId = null
    let morningShiftStart = normalizeHm(req.body?.morningShiftStart || current?.morningShiftStart || DEFAULT_MORNING_START)
    let morningShiftEnd = normalizeHm(req.body?.morningShiftEnd || current?.morningShiftEnd || DEFAULT_MORNING_END)
    let eveningShiftStart = normalizeHm(req.body?.eveningShiftStart || current?.eveningShiftStart || DEFAULT_EVENING_START)
    let eveningShiftEnd = normalizeHm(req.body?.eveningShiftEnd || current?.eveningShiftEnd || DEFAULT_EVENING_END)
    if (!morningShiftStart || !morningShiftEnd || !eveningShiftStart || !eveningShiftEnd) {
      res.status(400).json({ error: 'أوقات الورديات غير صالحة' })
      return
    }
    const morningStartMin = hmToMinutes(morningShiftStart)
    const morningEndMin = hmToMinutes(morningShiftEnd)
    const eveningStartMin = hmToMinutes(eveningShiftStart)
    const eveningEndMin = hmToMinutes(eveningShiftEnd)
    if (
      morningStartMin == null ||
      morningEndMin == null ||
      eveningStartMin == null ||
      eveningEndMin == null ||
      morningEndMin <= morningStartMin ||
      eveningEndMin <= eveningStartMin
    ) {
      res.status(400).json({ error: 'وقت نهاية الوردية يجب أن يكون بعد وقت بدايتها' })
      return
    }

    async function validateLaserUser(id) {
      if (!id) return null
      const u = await User.findById(id)
      if (!u || u.role !== 'laser') {
        throw new Error('INVALID_LASER_USER')
      }
      return u._id
    }

    try {
      // Legacy mode: assign a single user to all shifts
      if (userId != null) {
        assignedUserId = await validateLaserUser(userId)
        morningAssignedUserId = assignedUserId
        eveningAssignedUserId = assignedUserId
      } else {
        morningAssignedUserId = await validateLaserUser(morningUserId)
        eveningAssignedUserId = await validateLaserUser(eveningUserId)
        assignedUserId = morningAssignedUserId || eveningAssignedUserId || null
      }
    } catch (e) {
      if (String(e.message) === 'INVALID_LASER_USER') {
        res.status(400).json({ error: 'المستخدم يجب أن يكون من دور الليزر' })
        return
      }
      throw e
    }

    const r = await Room.findOneAndUpdate(
      { number: num },
      {
        assignedUserId,
        morningAssignedUserId,
        eveningAssignedUserId,
        morningShiftStart,
        morningShiftEnd,
        eveningShiftStart,
        eveningShiftEnd,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
      .populate('assignedUserId', 'name')
      .populate('morningAssignedUserId', 'name')
      .populate('eveningAssignedUserId', 'name')
    await writeAudit({
      user: req.user,
      action: 'إعادة تعيين غرفة ليزر',
      entityType: 'Room',
      entityId: String(num),
      details: {
        assignedUserId: assignedUserId ? String(assignedUserId) : null,
        morningAssignedUserId: morningAssignedUserId ? String(morningAssignedUserId) : null,
        eveningAssignedUserId: eveningAssignedUserId ? String(eveningAssignedUserId) : null,
        morningShiftStart,
        morningShiftEnd,
        eveningShiftStart,
        eveningShiftEnd,
      },
    })
    res.json({
      room: {
        number: r.number,
        morningAssigned: r.morningAssignedUserId
          ? { id: String(r.morningAssignedUserId._id), name: r.morningAssignedUserId.name }
          : null,
        eveningAssigned: r.eveningAssignedUserId
          ? { id: String(r.eveningAssignedUserId._id), name: r.eveningAssignedUserId.name }
          : null,
        morningShiftStart: r.morningShiftStart || DEFAULT_MORNING_START,
        morningShiftEnd: r.morningShiftEnd || DEFAULT_MORNING_END,
        eveningShiftStart: r.eveningShiftStart || DEFAULT_EVENING_START,
        eveningShiftEnd: r.eveningShiftEnd || DEFAULT_EVENING_END,
        assigned: r.assignedUserId
          ? { id: String(r.assignedUserId._id), name: r.assignedUserId.name }
          : null,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
