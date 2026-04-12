import { Router } from 'express'
import { Room } from '../models/Room.js'
import { User } from '../models/User.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { writeAudit } from '../utils/audit.js'

export const roomsRouter = Router()

roomsRouter.use(authMiddleware, requireRoles('super_admin'))

roomsRouter.get('/', async (_req, res) => {
  try {
    const rooms = await Room.find().sort({ number: 1 }).populate('assignedUserId', 'name role')
    res.json({
      rooms: rooms.map((r) => ({
        number: r.number,
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
    let assignedUserId = null
    if (userId) {
      const u = await User.findById(userId)
      if (!u || u.role !== 'laser') {
        res.status(400).json({ error: 'المستخدم يجب أن يكون من دور الليزر' })
        return
      }
      assignedUserId = u._id
    }
    const r = await Room.findOneAndUpdate(
      { number: num },
      { assignedUserId },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).populate('assignedUserId', 'name')
    await writeAudit({
      user: req.user,
      action: 'إعادة تعيين غرفة ليزر',
      entityType: 'Room',
      entityId: String(num),
      details: { assignedUserId: assignedUserId ? String(assignedUserId) : null },
    })
    res.json({
      room: {
        number: r.number,
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
