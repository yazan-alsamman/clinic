import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { User } from '../models/User.js'

export function signToken(user) {
  const expiresIn =
    user.role === 'reception' ? config.jwtReceptionExpiresIn : config.jwtExpiresIn
  return jwt.sign(
    { sub: String(user._id), role: user.role, email: user.email },
    config.jwtSecret,
    { expiresIn },
  )
}

export async function authMiddleware(req, res, next) {
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) {
    res.status(401).json({ error: 'مطلوب تسجيل الدخول' })
    return
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const user = await User.findById(payload.sub)
    if (!user || !user.active) {
      res.status(401).json({ error: 'حساب غير صالح أو مجمّد' })
      return
    }
    req.user = user
    req.tokenExp = payload.exp
    next()
  } catch {
    res.status(401).json({ error: 'جلسة منتهية أو غير صالحة' })
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'غير مصرّح' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' })
      return
    }
    next()
  }
}

/** Blocks operational writes when day is not active (optional per route). */
export function requireActiveDay(req, res, next) {
  if (req.user?.role === 'super_admin') {
    next()
    return
  }
  if (!req.businessDay?.active) {
    res.status(423).json({ error: 'يوم العمل غير مفعّل. تواصل مع المدير.' })
    return
  }
  next()
}
