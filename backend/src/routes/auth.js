import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { User } from '../models/User.js'
import { Patient } from '../models/Patient.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { authMiddleware, signToken } from '../middleware/auth.js'
import { signPatientToken } from '../middleware/patientAuth.js'
import { userToPublic } from '../utils/dto.js'
import { todayBusinessDate } from '../utils/date.js'

export const authRouter = Router()

/** دخول موحّد: بريد الموظف أو اسم مستخدم بوابة المريض + كلمة المرور */
authRouter.post('/login', async (req, res) => {
  try {
    const body = req.body ?? {}
    const identifier = String(body.login ?? body.email ?? '').trim()
    const password = String(body.password ?? '')
    if (!identifier || !password) {
      res.status(400).json({ error: 'اسم المستخدم أو البريد وكلمة المرور مطلوبان' })
      return
    }

    const emailKey = identifier.toLowerCase()
    const user = await User.findOne({ email: emailKey })
    if (user) {
      if (!user.active) {
        res.status(401).json({ error: 'بيانات الدخول غير صحيحة' })
        return
      }
      const staffOk = await bcrypt.compare(password, user.passwordHash)
      if (!staffOk) {
        res.status(401).json({ error: 'بيانات الدخول غير صحيحة' })
        return
      }
      // During Closed Day, only super admin can access staff app.
      if (user.role !== 'super_admin') {
        const businessDate = todayBusinessDate()
        const d = await BusinessDay.findOne({ businessDate }).lean()
        if (!d?.active) {
          res.status(403).json({
            errorCode: 'DAY_CLOSED',
            error: 'النظام مغلق حالياً. حاول لاحقاً بعد تفعيل اليوم.',
          })
          return
        }
      }
      const token = signToken(user)
      res.json({
        accountType: 'staff',
        token,
        user: userToPublic(user),
      })
      return
    }

    const patient = await Patient.findOne({ portalUsername: identifier })
    if (!patient || !patient.portalEnabled || !patient.portalPasswordHash) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة' })
      return
    }
    const patientOk = await bcrypt.compare(password, patient.portalPasswordHash)
    if (!patientOk) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة' })
      return
    }
    patient.portalLastLoginAt = new Date()
    await Patient.updateOne(
      { _id: patient._id },
      {
        $set: {
          portalLastLoginAt: patient.portalLastLoginAt,
        },
      },
    )
    const token = signPatientToken(patient)
    res.json({
      accountType: 'patient',
      token,
      mustChangePassword: patient.portalMustChangePassword === true,
      patient: {
        id: String(patient._id),
        name: patient.name,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

authRouter.get('/me', authMiddleware, (req, res) => {
  const exp = req.tokenExp ? req.tokenExp * 1000 : null
  const sessionMinutesLeft =
    exp != null ? Math.max(0, Math.round((exp - Date.now()) / 60000)) : null
  res.json({
    user: userToPublic(req.user),
    sessionMinutesLeft: req.user.role === 'reception' ? sessionMinutesLeft : null,
  })
})
