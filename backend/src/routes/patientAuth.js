import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { Patient } from '../models/Patient.js'
import { signPatientToken, patientAuthMiddleware } from '../middleware/patientAuth.js'

export const patientAuthRouter = Router()

patientAuthRouter.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim()
    const password = String(req.body?.password ?? '')
    if (!username || !password) {
      res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' })
      return
    }
    const patient = await Patient.findOne({ portalUsername: username })
    if (!patient || !patient.portalEnabled || !patient.portalPasswordHash) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة' })
      return
    }
    const ok = await bcrypt.compare(password, patient.portalPasswordHash)
    if (!ok) {
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

patientAuthRouter.get('/me', patientAuthMiddleware, (req, res) => {
  const p = req.patient
  res.json({
    patient: {
      id: String(p._id),
      name: p.name,
      mustChangePassword: p.portalMustChangePassword === true,
    },
  })
})

patientAuthRouter.patch('/password', patientAuthMiddleware, async (req, res) => {
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
    const p = req.patient
    const ok = await bcrypt.compare(current, p.portalPasswordHash)
    if (!ok) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' })
      return
    }
    p.portalPasswordHash = await bcrypt.hash(nextPwd, 10)
    p.portalMustChangePassword = false
    await p.save()
    const token = signPatientToken(p)
    res.json({ token, ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
