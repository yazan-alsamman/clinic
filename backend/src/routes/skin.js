import { Router } from 'express'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { SkinProcedureOption } from '../models/SkinProcedureOption.js'
import { writeAudit } from '../utils/audit.js'

export const skinRouter = Router()

skinRouter.use(authMiddleware)

const DEFAULT_SKIN_PROCEDURES = [
  { name: 'عادي', priceSyp: 0, sortOrder: 0 },
  { name: 'VIP', priceSyp: 0, sortOrder: 1 },
  { name: 'دلال', priceSyp: 0, sortOrder: 2 },
  { name: 'organic', priceSyp: 0, sortOrder: 3 },
  { name: 'كاربوكسي', priceSyp: 0, sortOrder: 4 },
]

function toDto(row) {
  const o = row?.toObject ? row.toObject() : row
  return {
    id: String(o._id),
    name: String(o.name || '').trim(),
    priceSyp: Math.max(0, Math.round(Number(o.priceSyp) || 0)),
    active: o.active !== false,
    sortOrder: Number(o.sortOrder) || 0,
  }
}

async function ensureDefaults() {
  for (const p of DEFAULT_SKIN_PROCEDURES) {
    await SkinProcedureOption.updateOne(
      { name: p.name },
      { $setOnInsert: { name: p.name, priceSyp: p.priceSyp, active: true, sortOrder: p.sortOrder } },
      { upsert: true },
    )
  }
}

skinRouter.get(
  '/procedure-options',
  requireRoles('super_admin', 'reception', 'skin_specialist'),
  async (_req, res) => {
    try {
      await ensureDefaults()
      const rows = await SkinProcedureOption.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean()
      res.json({ options: rows.map(toDto) })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

skinRouter.get('/procedure-options/admin', requireRoles('super_admin'), async (_req, res) => {
  try {
    await ensureDefaults()
    const rows = await SkinProcedureOption.find({}).sort({ sortOrder: 1, name: 1 }).lean()
    res.json({ options: rows.map(toDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

skinRouter.post('/procedure-options', requireRoles('super_admin'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120)
    const priceSyp = Math.max(0, Math.round(Number(req.body?.priceSyp) || 0))
    if (!name) {
      res.status(400).json({ error: 'اسم الإجراء مطلوب' })
      return
    }
    const row = await SkinProcedureOption.create({
      name,
      priceSyp,
      active: req.body?.active !== false,
      sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 999,
    })
    await writeAudit({
      user: req.user,
      action: 'إضافة إجراء لقسم البشرة',
      entityType: 'SkinProcedureOption',
      entityId: row._id,
      details: { name, priceSyp },
    })
    res.status(201).json({ option: toDto(row) })
  } catch (e) {
    if (e?.code === 11000) {
      res.status(400).json({ error: 'اسم الإجراء موجود مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

skinRouter.patch('/procedure-options/:id', requireRoles('super_admin'), async (req, res) => {
  try {
    const row = await SkinProcedureOption.findById(req.params.id)
    if (!row) {
      res.status(404).json({ error: 'الإجراء غير موجود' })
      return
    }
    if (req.body?.name != null) row.name = String(req.body.name).trim().slice(0, 120)
    if (req.body?.priceSyp != null) row.priceSyp = Math.max(0, Math.round(Number(req.body.priceSyp) || 0))
    if (req.body?.active != null) row.active = req.body.active !== false
    if (req.body?.sortOrder != null) row.sortOrder = Number(req.body.sortOrder) || 0
    if (!String(row.name || '').trim()) {
      res.status(400).json({ error: 'اسم الإجراء مطلوب' })
      return
    }
    await row.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل إجراء لقسم البشرة',
      entityType: 'SkinProcedureOption',
      entityId: row._id,
      details: { name: row.name, priceSyp: row.priceSyp, active: row.active },
    })
    res.json({ option: toDto(row) })
  } catch (e) {
    if (e?.code === 11000) {
      res.status(400).json({ error: 'اسم الإجراء موجود مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
