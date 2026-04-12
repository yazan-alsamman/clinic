import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { Patient } from '../models/Patient.js'

export function signPatientToken(patient) {
  return jwt.sign(
    {
      sub: String(patient._id),
      typ: 'patient',
      mcp: patient.portalMustChangePassword === true,
    },
    config.jwtSecret,
    { expiresIn: config.jwtPatientExpiresIn },
  )
}

export async function patientAuthMiddleware(req, res, next) {
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) {
    res.status(401).json({ error: 'مطلوب تسجيل الدخول' })
    return
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    if (payload.typ !== 'patient') {
      res.status(401).json({ error: 'جلسة غير صالحة لهذه البوابة' })
      return
    }
    const patient = await Patient.findById(payload.sub)
    if (!patient || !patient.portalEnabled) {
      res.status(401).json({ error: 'حساب غير مفعّل أو غير موجود' })
      return
    }
    if (!patient.portalUsername || !patient.portalPasswordHash) {
      res.status(401).json({ error: 'لم يُعدّ حساب البوابة لهذا الملف' })
      return
    }
    req.patient = patient
    req.patientJwt = payload
    next()
  } catch {
    res.status(401).json({ error: 'جلسة منتهية أو غير صالحة' })
  }
}
