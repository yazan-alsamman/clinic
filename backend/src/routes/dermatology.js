import { Router } from 'express'
import { Patient } from '../models/Patient.js'
import { InventoryItem } from '../models/InventoryItem.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { FinancialDocument } from '../models/FinancialDocument.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { patientToDto } from '../utils/dto.js'
import { todayBusinessDate } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'
import { postDermatologyVisit } from '../services/postingService.js'

export const dermatologyRouter = Router()

dermatologyRouter.use(
  authMiddleware,
  loadBusinessDay,
  requireRoles('super_admin', 'dermatology', 'dermatology_manager', 'dermatology_assistant_manager'),
)

function parseRange({ period, date, month }) {
  const p = String(period || '').trim().toLowerCase()
  if (p === 'monthly') {
    const m = String(month || '').trim()
    if (!/^\d{4}-\d{2}$/.test(m)) return null
    const from = `${m}-01`
    const [yy, mm] = m.split('-').map(Number)
    const last = new Date(yy, mm, 0).getDate()
    const to = `${m}-${String(last).padStart(2, '0')}`
    return { period: 'monthly', from, to, label: m }
  }
  const d = String(date || '').trim() || todayBusinessDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  return { period: 'daily', from: d, to: d, label: d }
}

function sumLineAmount(lines, lineType) {
  return Math.round(
    (Array.isArray(lines) ? lines : [])
      .filter((l) => String(l?.lineType || '') === lineType)
      .reduce((s, l) => s + (Number(l?.amountSyp) || 0), 0),
  )
}

dermatologyRouter.get('/finance-summary', async (req, res) => {
  try {
    if (!(req.user.role === 'super_admin' || req.user.role === 'dermatology_manager')) {
      res.status(403).json({ error: 'هذه الصفحة متاحة لمدير النظام ورئيس قسم الجلدية فقط' })
      return
    }
    const range = parseRange({
      period: req.query.period,
      date: req.query.date,
      month: req.query.month,
    })
    if (!range) {
      res.status(400).json({ error: 'نطاق التاريخ غير صالح' })
      return
    }

    const docs = await FinancialDocument.find({
      department: 'dermatology',
      status: 'posted',
      businessDate: { $gte: range.from, $lte: range.to },
    })
      .sort({ businessDate: 1, postedAt: 1 })
      .populate('patientId', 'name')
      .populate('providerUserId', 'name')
      .lean()

    const detailRows = docs.map((d) => {
      const netRevenueSyp = sumLineAmount(d.lines, 'net_revenue')
      const materialCostSyp = sumLineAmount(d.lines, 'material_cost')
      const doctorShareSyp = sumLineAmount(d.lines, 'doctor_share')
      const clinicNetSyp = sumLineAmount(d.lines, 'clinic_net')
      return {
        id: String(d._id),
        businessDate: String(d.businessDate || ''),
        patientName: String(d.patientId?.name || '—').trim(),
        providerName: String(d.providerUserId?.name || '—').trim(),
        sourceType: String(d.sourceType || ''),
        netRevenueSyp,
        materialCostSyp,
        doctorShareSyp,
        clinicNetSyp,
      }
    })

    const totals = detailRows.reduce(
      (acc, row) => ({
        netRevenueSyp: acc.netRevenueSyp + row.netRevenueSyp,
        materialCostSyp: acc.materialCostSyp + row.materialCostSyp,
        doctorShareSyp: acc.doctorShareSyp + row.doctorShareSyp,
        clinicNetSyp: acc.clinicNetSyp + row.clinicNetSyp,
      }),
      { netRevenueSyp: 0, materialCostSyp: 0, doctorShareSyp: 0, clinicNetSyp: 0 },
    )
    totals.netRevenueSyp = Math.round(totals.netRevenueSyp)
    totals.materialCostSyp = Math.round(totals.materialCostSyp)
    totals.doctorShareSyp = Math.round(totals.doctorShareSyp)
    totals.clinicNetSyp = Math.round(totals.clinicNetSyp)

    res.json({
      period: range.period,
      from: range.from,
      to: range.to,
      label: range.label,
      totals,
      rows: detailRows,
      notes: [
        'الإيراد = خط net_revenue من المستندات المرحلة لقسم الجلدية.',
        'المصاريف المعروضة = كلفة المواد + حصة الطبيب من نفس المستندات.',
        'صافي الربح = خط clinic_net.',
      ],
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

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
    const isDermatologyOnly =
      req.user?.role === 'dermatology' ||
      req.user?.role === 'dermatology_manager' ||
      req.user?.role === 'dermatology_assistant_manager'

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
