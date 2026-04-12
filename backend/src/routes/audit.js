import { Router } from 'express'
import { AuditLog } from '../models/AuditLog.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'

export const auditRouter = Router()

auditRouter.use(authMiddleware, requireRoles('super_admin'))

auditRouter.get('/', async (req, res) => {
  try {
    const userFilter = String(req.query.user || '').trim()
    const q = {}
    if (userFilter) {
      q.userName = new RegExp(userFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }
    if (req.query.from || req.query.to) {
      q.createdAt = {}
      if (req.query.from) q.createdAt.$gte = new Date(String(req.query.from))
      if (req.query.to) q.createdAt.$lte = new Date(String(req.query.to))
    }
    const logs = await AuditLog.find(q).sort({ createdAt: -1 }).limit(500)
    res.json({
      logs: logs.map((l) => ({
        id: String(l._id),
        user: l.userName || '—',
        action: l.action,
        entity: l.entityType + (l.entityId ? ` #${l.entityId}` : ''),
        time: l.createdAt.toISOString().slice(0, 16).replace('T', ' '),
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
