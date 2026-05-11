import { Router } from 'express'
import mongoose from 'mongoose'
import { UserNotification } from '../models/UserNotification.js'
import { User } from '../models/User.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { writeAudit } from '../utils/audit.js'

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

const MAX_ADMIN_BODY = 8000
const MAX_ADMIN_TITLE = 200
const MAX_RECIPIENTS = 200

/** إنشاء إشعارات يدوية — مدير النظام فقط */
notificationsRouter.post('/admin-send', requireRoles('super_admin'), async (req, res) => {
  try {
    const body = req.body ?? {}
    let title = String(body.title ?? '').trim()
    const text = String(body.body ?? body.message ?? '').trim()
    const userIdsRaw = body.userIds ?? body.recipientIds
    if (!text) {
      res.status(400).json({ error: 'نص الإشعار مطلوب.' })
      return
    }
    if (text.length > MAX_ADMIN_BODY) {
      res.status(400).json({ error: `نص الإشعار طويل جداً (الحد ${MAX_ADMIN_BODY} حرفاً).` })
      return
    }
    if (!title) title = 'إشعار من مدير النظام'
    if (title.length > MAX_ADMIN_TITLE) {
      res.status(400).json({ error: `العنوان طويل جداً (الحد ${MAX_ADMIN_TITLE} حرفاً).` })
      return
    }
    if (!Array.isArray(userIdsRaw) || userIdsRaw.length === 0) {
      res.status(400).json({ error: 'اختر مستخدماً واحداً على الأقل.' })
      return
    }
    const unique = [...new Set(userIdsRaw.map((x) => String(x).trim()).filter((id) => mongoose.isValidObjectId(id)))]
    if (unique.length === 0) {
      res.status(400).json({ error: 'معرّفات المستخدمين غير صالحة.' })
      return
    }
    if (unique.length > MAX_RECIPIENTS) {
      res.status(400).json({ error: `لا يمكن تجاوز ${MAX_RECIPIENTS} مستلم في عملية واحدة.` })
      return
    }
    const objectIds = unique.map((id) => new mongoose.Types.ObjectId(id))
    const found = await User.find({ _id: { $in: objectIds } })
      .select('_id')
      .lean()
    const validIds = found.map((u) => String(u._id))
    if (validIds.length === 0) {
      res.status(400).json({ error: 'لم يُعثر على أي مستخدم بالمعرّفات المحددة.' })
      return
    }
    const fromName = String(req.user.name || '').trim() || 'مدير النظام'
    const docs = validIds.map((userId) => ({
      userId: new mongoose.Types.ObjectId(userId),
      type: 'admin_message',
      read: false,
      title: title.slice(0, MAX_ADMIN_TITLE),
      body: text.slice(0, MAX_ADMIN_BODY),
      meta: { kind: 'admin_message', fromUserId: String(req.user._id), fromName },
    }))
    await UserNotification.insertMany(docs)
    await writeAudit({
      user: req.user,
      action: 'إرسال إشعار لمستخدمين',
      entityType: 'UserNotification',
      entityId: '',
      details: { recipientCount: docs.length, title: title.slice(0, MAX_ADMIN_TITLE) },
    })
    res.json({ ok: true, sent: docs.length })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
