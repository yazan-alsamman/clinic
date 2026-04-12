import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { User, ROLES } from '../models/User.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { userToPublic } from '../utils/dto.js'
import { writeAudit } from '../utils/audit.js'

export const usersRouter = Router()

/** أي موظف مسجّل (بما فيه super_admin) يغيّر كلمة مرور حسابه فقط */
usersRouter.patch('/me/password', authMiddleware, async (req, res) => {
  try {
    const current = String(req.body?.currentPassword ?? '')
    const nextPwd = String(req.body?.newPassword ?? '')
    if (!current || !nextPwd) {
      res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبة' })
      return
    }
    if (nextPwd.length < 8) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن ٨ أحرف' })
      return
    }
    const u = await User.findById(req.user._id)
    if (!u || !u.active) {
      res.status(401).json({ error: 'حساب غير صالح أو مجمّد' })
      return
    }
    const ok = await bcrypt.compare(current, u.passwordHash)
    if (!ok) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' })
      return
    }
    u.passwordHash = await bcrypt.hash(nextPwd, 10)
    await u.save()
    await writeAudit({
      user: req.user,
      action: 'تغيير كلمة مرور الحساب الشخصي',
      entityType: 'User',
      entityId: u._id,
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

usersRouter.use(authMiddleware, requireRoles('super_admin'))

usersRouter.get('/', async (_req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 })
    res.json({ users: users.map(userToPublic) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

usersRouter.post('/', async (req, res) => {
  try {
    const body = req.body ?? {}
    const { email, password, name, role } = body
    if (!email || !password || !name || !role) {
      res.status(400).json({ error: 'بيانات ناقصة' })
      return
    }
    if (!ROLES.includes(role)) {
      res.status(400).json({ error: 'دور غير صالح' })
      return
    }
    const passwordHash = await bcrypt.hash(String(password), 10)
    const dsp = Number(body.doctorSharePercent)
    const u = await User.create({
      email: String(email).toLowerCase().trim(),
      passwordHash,
      name: String(name).trim(),
      role,
      active: true,
      doctorSharePercent:
        Number.isFinite(dsp) && dsp >= 0 && dsp <= 100 ? dsp : 0,
    })
    await writeAudit({
      user: req.user,
      action: 'إنشاء مستخدم',
      entityType: 'User',
      entityId: u._id,
    })
    res.status(201).json({ user: userToPublic(u) })
  } catch (e) {
    if (e.code === 11000) {
      res.status(400).json({ error: 'البريد مستخدم مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

usersRouter.patch('/:id', async (req, res) => {
  try {
    const u = await User.findById(req.params.id)
    if (!u) {
      res.status(404).json({ error: 'غير موجود' })
      return
    }
    const body = req.body ?? {}
    if (typeof body.active === 'boolean') {
      if (body.active === false && u._id.equals(req.user._id)) {
        res.status(400).json({ error: 'لا يمكنك تجميد حسابك الحالي' })
        return
      }
      u.active = body.active
      await writeAudit({
        user: req.user,
        action: body.active ? 'إلغاء تجميد مستخدم' : 'تجميد مستخدم',
        entityType: 'User',
        entityId: u._id,
      })
    }
    if (body.email != null) {
      const next = String(body.email).toLowerCase().trim()
      const taken = await User.findOne({ email: next, _id: { $ne: u._id } })
      if (taken) {
        res.status(400).json({ error: 'البريد مستخدم مسبقاً' })
        return
      }
      u.email = next
    }
    if (body.name != null) u.name = String(body.name).trim()
    if (body.role != null && ROLES.includes(body.role)) {
      if (u._id.equals(req.user._id) && body.role !== u.role) {
        res.status(400).json({ error: 'لا يمكنك تغيير دورك الحالي' })
        return
      }
      u.role = body.role
    }
    if (body.password) u.passwordHash = await bcrypt.hash(String(body.password), 10)
    if (body.doctorSharePercent != null) {
      const dsp = Number(body.doctorSharePercent)
      if (!Number.isFinite(dsp) || dsp < 0 || dsp > 100) {
        res.status(400).json({ error: 'نسبة الاستحقاق يجب أن تكون بين 0 و 100' })
        return
      }
      u.doctorSharePercent = dsp
    }
    await u.save()
    res.json({ user: userToPublic(u) })
  } catch (e) {
    if (e.code === 11000) {
      res.status(400).json({ error: 'البريد مستخدم مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
