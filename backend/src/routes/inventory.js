import { Router } from 'express'
import { InventoryItem } from '../models/InventoryItem.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { writeAudit } from '../utils/audit.js'

export const inventoryRouter = Router()

inventoryRouter.use(authMiddleware)

const READ_ROLES = ['super_admin', 'reception', 'dermatology']

function itemDto(i) {
  const o = i.toObject ? i.toObject() : i
  return {
    id: String(o._id),
    sku: o.sku,
    name: o.name,
    active: o.active !== false,
    unit: o.unit ?? 'unit',
    quantity: o.quantity ?? 0,
    safetyStockLevel: o.safetyStockLevel ?? 0,
    unitCost: o.unitCost ?? 0,
    lowStock: (o.quantity ?? 0) <= (o.safetyStockLevel ?? 0),
  }
}

inventoryRouter.get('/items', async (req, res) => {
  try {
    if (!READ_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const activeOnly = String(req.query.activeOnly || '') === '1'
    const inStockOnly = String(req.query.inStockOnly || '') === '1'
    const q = {}
    if (activeOnly) q.active = true
    if (inStockOnly) q.quantity = { $gt: 0 }
    const items = await InventoryItem.find(q).sort({ name: 1 })
    res.json({ items: items.map(itemDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

inventoryRouter.post('/items', requireRoles('super_admin'), async (req, res) => {
  try {
    const body = req.body ?? {}
    const sku = String(body.sku || '').trim()
    const name = String(body.name || '').trim()
    if (!sku || !name) {
      res.status(400).json({ error: 'رمز SKU والاسم مطلوبان' })
      return
    }
    const doc = await InventoryItem.create({
      sku,
      name,
      active: body.active !== false,
      unit: String(body.unit || 'unit').trim() || 'unit',
      quantity: Number(body.quantity) || 0,
      safetyStockLevel: Number(body.safetyStockLevel) || 0,
      unitCost: Number(body.unitCost) || 0,
    })
    await writeAudit({
      user: req.user,
      action: 'إضافة مادة للمستودع',
      entityType: 'InventoryItem',
      entityId: doc._id,
      details: { sku, name },
    })
    res.status(201).json({ item: itemDto(doc) })
  } catch (e) {
    if (e.code === 11000) {
      res.status(400).json({ error: 'رمز SKU مستخدم مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

inventoryRouter.patch('/items/:id', requireRoles('super_admin'), async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id)
    if (!item) {
      res.status(404).json({ error: 'المادة غير موجودة' })
      return
    }

    const body = req.body ?? {}

    if (body.sku != null) {
      const next = String(body.sku).trim()
      const taken = await InventoryItem.findOne({ sku: next, _id: { $ne: item._id } })
      if (taken) {
        res.status(400).json({ error: 'رمز SKU مستخدم مسبقاً' })
        return
      }
      item.sku = next
    }
    if (body.name != null) item.name = String(body.name).trim()
    if (body.active != null) item.active = body.active !== false
    if (body.unit != null) item.unit = String(body.unit).trim() || 'unit'
    if (body.quantity != null) item.quantity = Math.max(0, Number(body.quantity))
    if (body.safetyStockLevel != null)
      item.safetyStockLevel = Math.max(0, Number(body.safetyStockLevel))
    if (body.unitCost != null) item.unitCost = Math.max(0, Number(body.unitCost))

    await item.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل مادة في المستودع',
      entityType: 'InventoryItem',
      entityId: item._id,
      details: { sku: item.sku },
    })
    res.json({ item: itemDto(item) })
  } catch (e) {
    if (e.code === 11000) {
      res.status(400).json({ error: 'رمز SKU مستخدم مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
