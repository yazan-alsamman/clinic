import { Router } from 'express'
import { Patient } from '../models/Patient.js'
import { InventoryItem } from '../models/InventoryItem.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { patientToDto } from '../utils/dto.js'
import { todayBusinessDate } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'
import { postDermatologyVisit } from '../services/postingService.js'

export const dermatologyRouter = Router()

dermatologyRouter.use(authMiddleware, loadBusinessDay, requireRoles('super_admin', 'dermatology'))

function parseNonNegativeSypInteger(raw) {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function startEndOfLocalDay(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

dermatologyRouter.get('/today', async (req, res) => {
  try {
    const businessDate = todayBusinessDate()
    const { start, end } = startEndOfLocalDay()
    const isDermatologyOnly = req.user?.role === 'dermatology'

    const todayPatients = await Patient.find({
      departments: 'dermatology',
      lastVisit: { $gte: start, $lt: end },
    })
      .sort({ lastVisit: -1 })
      .limit(50)
      .lean()

    const todayObjectIds = todayPatients.map((p) => p._id)
    const otherPatients = await Patient.find({
      departments: 'dermatology',
      ...(todayObjectIds.length ? { _id: { $nin: todayObjectIds } } : {}),
    })
      .sort({ lastVisit: -1 })
      .limit(15)
      .lean()

    let lowStockItems = []
    if (!isDermatologyOnly) {
      const lowStock = await InventoryItem.find({
        $expr: { $lte: ['$quantity', '$safetyStockLevel'] },
      })
        .sort({ quantity: 1 })
        .limit(8)
        .select('name sku quantity safetyStockLevel')
        .lean()
      lowStockItems = lowStock.map((i) => ({
        id: String(i._id),
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        safetyStockLevel: i.safetyStockLevel,
      }))
    }

    res.json({
      businessDate,
      todayPatients: todayPatients.map((p) => patientToDto(p)),
      otherPatients: otherPatients.map((p) => patientToDto(p)),
      lowStockItems,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تسجيل إجراء جلدية + ترحيل محاسبي فوري */
dermatologyRouter.post('/visits', requireActiveDay, async (req, res) => {
  try {
    const body = req.body ?? {}
    const patient = await Patient.findById(body.patientId)
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const businessDate = String(body.businessDate || '').trim() || todayBusinessDate()
    const costSyp = parseNonNegativeSypInteger(body.costSyp)
    const materialCostSyp = parseNonNegativeSypInteger(body.materialCostSyp)
    if (costSyp == null || materialCostSyp == null) {
      res.status(400).json({ error: 'أدخل المبالغ بالليرة (أرقام صحيحة غير سالبة)' })
      return
    }
    const v = await DermatologyVisit.create({
      businessDate,
      patientId: patient._id,
      areaTreatment: String(body.areaTreatment ?? ''),
      sessionType: String(body.sessionType ?? 'جلدية / تجميل'),
      costSyp,
      discountPercent: Math.min(100, Math.max(0, Number(body.discountPercent) || 0)),
      materialCostSyp,
      procedureClass: ['cosmetic', 'ortho', 'general'].includes(body.procedureClass)
        ? body.procedureClass
        : 'cosmetic',
      providerUserId: req.user._id,
      notes: String(body.notes ?? ''),
    })
    try {
      await postDermatologyVisit(v, req.user._id)
    } catch (postErr) {
      console.error('accounting post derm:', postErr)
    }
    await writeAudit({
      user: req.user,
      action: 'تسجيل زيارة جلدية / تجميل',
      entityType: 'DermatologyVisit',
      entityId: v._id,
    })
    if (!patient.departments.includes('dermatology')) {
      patient.departments = [...new Set([...patient.departments, 'dermatology'])]
      patient.lastVisit = new Date()
      await patient.save()
    }
    res.status(201).json({ visit: v })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
