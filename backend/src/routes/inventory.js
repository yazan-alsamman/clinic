import { Router } from 'express'
import { InventoryItem } from '../models/InventoryItem.js'
import { nextSequence } from '../models/Counter.js'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { writeAudit } from '../utils/audit.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'

export const inventoryRouter = Router()

inventoryRouter.use(authMiddleware, loadBusinessDay)

const READ_ROLES = ['super_admin', 'reception', 'dermatology', 'dermatology_manager', 'dermatology_assistant_manager', 'laser', 'dental_branch', 'solarium']
const ALLOWED_DEPARTMENTS = ['laser', 'dermatology', 'dermatology_private', 'dental', 'skin', 'solarium']

function normalizeDepartment(raw, fallback = 'dermatology') {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
  return ALLOWED_DEPARTMENTS.includes(v) ? v : fallback
}

const DEPARTMENT_SKU_PREFIX = {
  laser: 'LAS',
  dermatology: 'DERM',
  dermatology_private: 'DPVT',
  dental: 'DEN',
  skin: 'SKIN',
  solarium: 'SOL',
}

function isDermWarehouseManagerRole(role) {
  return role === 'dermatology_manager'
}
function isDermWarehouseAssistantRole(role) {
  return role === 'dermatology_assistant_manager'
}
function isDermWarehouseStaffRole(role) {
  return isDermWarehouseManagerRole(role) || isDermWarehouseAssistantRole(role)
}
function canAccessSkinInventory(role) {
  return role === 'super_admin' || role === 'reception'
}

async function generateInventorySku(department) {
  const prefix = DEPARTMENT_SKU_PREFIX[department] || 'INV'
  for (let i = 0; i < 6; i += 1) {
    const seq = await nextSequence(`inventorySku:${prefix}`)
    const sku = `${prefix}-${String(seq).padStart(4, '0')}`
    const exists = await InventoryItem.exists({ sku })
    if (!exists) return sku
  }
  throw new Error('تعذر توليد SKU تلقائي فريد')
}
function parseNonNegativeUnitCostSyp(body) {
  if (body.unitCostSyp != null && body.unitCostSyp !== '') {
    const n = Math.round(Number(body.unitCostSyp))
    if (Number.isFinite(n) && n >= 0) return n
  }
  if (body.unitCost != null && body.unitCost !== '') {
    const n = Math.round(Number(body.unitCost))
    if (Number.isFinite(n) && n >= 0) return n
  }
  return 0
}

function parseNonNegativeUnitCostUsd(body) {
  if (body.unitCostUsd == null || body.unitCostUsd === '') return 0
  const n = Number(body.unitCostUsd)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

function itemDto(i) {
  const o = i.toObject ? i.toObject() : i
  return {
    id: String(o._id),
    sku: o.sku,
    name: o.name,
    active: o.active !== false,
    department: o.department || 'dermatology',
    unit: o.unit ?? 'unit',
    quantity: o.quantity ?? 0,
    safetyStockLevel: o.safetyStockLevel ?? 0,
    unitCost: o.unitCost ?? 0,
    unitCostUsd: o.unitCostUsd ?? 0,
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
    if (isDermWarehouseStaffRole(req.user.role)) {
      q.department = 'dermatology_private'
    } else {
      const deptsRaw = String(req.query.departments || '')
        .split(',')
        .map((x) => normalizeDepartment(x, ''))
        .filter(Boolean)
      if (deptsRaw.length) q.department = { $in: [...new Set(deptsRaw)] }
      else if (req.user.role !== 'super_admin') q.department = { $ne: 'dermatology_private' }
    }
    if (activeOnly) q.active = true
    if (inStockOnly) q.quantity = { $gt: 0 }
    const items = await InventoryItem.find(q).sort({ name: 1 })
    res.json({ items: items.map(itemDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

inventoryRouter.post('/items', requireRoles('super_admin', 'dermatology_manager', 'dermatology_assistant_manager', 'reception'), async (req, res) => {
  try {
    const body = req.body ?? {}
    const name = String(body.name || '').trim()
    if (!name) {
      res.status(400).json({ error: 'اسم المادة مطلوب' })
      return
    }
    const department = isDermWarehouseStaffRole(req.user.role)
      ? 'dermatology_private'
      : canAccessSkinInventory(req.user.role)
        ? 'skin'
        : normalizeDepartment(body.department)
    const sku = await generateInventorySku(department)
    let unitCostSyp = parseNonNegativeUnitCostSyp(body)
    let unitCostUsd = parseNonNegativeUnitCostUsd(body)
    if (isDermWarehouseAssistantRole(req.user.role)) {
      unitCostSyp = 0
      unitCostUsd = 0
    }
    const doc = await InventoryItem.create({
      sku,
      name,
      active: body.active !== false,
      department,
      unit: String(body.unit || 'unit').trim() || 'unit',
      quantity: Number(body.quantity) || 0,
      safetyStockLevel: Number(body.safetyStockLevel) || 0,
      unitCost: unitCostSyp,
      unitCostUsd,
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

inventoryRouter.patch('/items/:id', requireRoles('super_admin', 'dermatology_manager', 'dermatology_assistant_manager', 'reception'), async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id)
    if (!item) {
      res.status(404).json({ error: 'المادة غير موجودة' })
      return
    }
    if (isDermWarehouseStaffRole(req.user.role) && item.department !== 'dermatology_private') {
      res.status(403).json({ error: 'لا صلاحية لتعديل هذا الصنف' })
      return
    }
    if (canAccessSkinInventory(req.user.role) && item.department !== 'skin') {
      res.status(403).json({ error: 'لا صلاحية لتعديل هذا الصنف' })
      return
    }

    const body = req.body ?? {}

    if (isDermWarehouseAssistantRole(req.user.role)) {
      const forbidden = ['sku', 'name', 'active', 'unit', 'department', 'unitCost', 'unitCostSyp', 'unitCostUsd']
      for (const k of forbidden) {
        if (body[k] != null) {
          res.status(403).json({
            error: 'تعديل الاسم أو السعر أو SKU أو الوحدة أو حالة التفعيل متاح لمدير قسم الجلدية فقط',
          })
          return
        }
      }
    }

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
    if (body.department != null) {
      item.department = isDermWarehouseStaffRole(req.user.role)
        ? 'dermatology_private'
        : canAccessSkinInventory(req.user.role)
          ? 'skin'
          : normalizeDepartment(body.department, item.department)
    }
    if (body.unit != null) item.unit = String(body.unit).trim() || 'unit'
    if (body.quantity != null) item.quantity = Math.max(0, Number(body.quantity))
    if (body.safetyStockLevel != null)
      item.safetyStockLevel = Math.max(0, Number(body.safetyStockLevel))
    if (body.unitCost != null || body.unitCostSyp != null) {
      item.unitCost = parseNonNegativeUnitCostSyp(body)
    }
    if (body.unitCostUsd != null) {
      item.unitCostUsd = parseNonNegativeUnitCostUsd(body)
    }

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
