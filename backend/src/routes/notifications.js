import { Router } from 'express'
import mongoose from 'mongoose'
import { UserNotification } from '../models/UserNotification.js'
import { authMiddleware } from '../middleware/auth.js'

export const notificationsRouter = Router()
notificationsRouter.use(authMiddleware)

const STAFF_ROLES = ['super_admin', 'reception', 'laser', 'dermatology', 'dental_branch', 'solarium']

function requireStaff(req, res, next) {
  if (!STAFF_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' })
    return
  }
  next()
}

notificationsRouter.get('/', requireStaff, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '40'), 10) || 40))
    const userId = req.user._id
    const [items, unreadCount] = await Promise.all([
      UserNotification.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      UserNotification.countDocuments({ userId, read: false }),
    ])
    res.json({
      notifications: items.map((n) => ({
        id: String(n._id),
        type: n.type,
        read: Boolean(n.read),
        title: n.title,
        body: n.body,
        meta: n.meta && typeof n.meta === 'object' ? n.meta : {},
        createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : null,
      })),
      unreadCount,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

notificationsRouter.patch('/:id/read', requireStaff, async (req, res) => {
  try {
    const id = req.params.id
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const n = await UserNotification.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      { $set: { read: true } },
      { new: true },
    ).lean()
    if (!n) {
      res.status(404).json({ error: 'الإشعار غير موجود' })
      return
    }
    const unreadCount = await UserNotification.countDocuments({ userId: req.user._id, read: false })
    res.json({ ok: true, unreadCount })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

notificationsRouter.post('/read-all', requireStaff, async (req, res) => {
  try {
    await UserNotification.updateMany({ userId: req.user._id, read: false }, { $set: { read: true } })
    res.json({ ok: true, unreadCount: 0 })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
