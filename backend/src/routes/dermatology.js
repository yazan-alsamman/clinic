import { Router } from 'express'
import { Patient } from '../models/Patient.js'
import { InventoryItem } from '../models/InventoryItem.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { PatientDebtSettlement } from '../models/PatientDebtSettlement.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { patientToDto } from '../utils/dto.js'
import { todayBusinessDate } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'
import { postDermatologyVisit } from '../services/postingService.js'
import {
  addDermatologyRevenueToTotals,
  applyDermatologyDebtSettlements,
  createEmptyDermatologyShareTotals,
  finalizeDermatologyShares,
  loadDermatologyDebtSettlementLookup,
} from '../services/dermatologyFinanceShares.js'

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

/** تكلفة مواد السطر: جزء يُحسب كسعر ليرة، وجزء يُعرض بالدولار (إن وُجد سعر صرف) */
function splitMaterialLineCost(lineCostSyp, inv, usdSypRate) {
  const line = Math.round(Number(lineCostSyp) || 0)
  const ucSyp = Math.round(Number(inv?.unitCost) || 0)
  const ucUsd = Number(inv?.unitCostUsd) || 0
  const rate = Number(usdSypRate) || 0
  if (ucSyp > 0) return { sypPricedSyp: line, usdPricedUsd: 0 }
  if (ucUsd > 0 && rate > 0) return { sypPricedSyp: 0, usdPricedUsd: line / rate }
  if (ucUsd > 0) return { sypPricedSyp: line, usdPricedUsd: 0 }
  return { sypPricedSyp: line, usdPricedUsd: 0 }
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

    const items = await BillingItem.find({
      department: 'dermatology',
      status: 'paid',
      paymentId: { $ne: null },
      businessDate: { $gte: range.from, $lte: range.to },
    })
      .sort({ paidAt: 1, businessDate: 1 })
      .populate('patientId', 'name')
      .populate('providerUserId', 'name')
      .lean()

    const sessionIds = [...new Set(items.map((i) => i.clinicalSessionId).filter(Boolean).map(String))]
    const sessions =
      sessionIds.length > 0
        ? await ClinicalSession.find({ _id: { $in: sessionIds } })
            .select('materials materialCostSypTotal businessDate')
            .lean()
        : []
    const sessionById = new Map(sessions.map((s) => [String(s._id), s]))

    const payIds = [...new Set(items.map((i) => i.paymentId).filter(Boolean).map(String))]
    const payments =
      payIds.length > 0 ? await BillingPayment.find({ _id: { $in: payIds } }).select('amountSyp').lean() : []
    const payById = new Map(payments.map((p) => [String(p._id), p]))

    const datesForRate = [...new Set(items.map((i) => String(i.businessDate || '').trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))]
    const bdays =
      datesForRate.length > 0
        ? await BusinessDay.find({ businessDate: { $in: datesForRate } }).select('businessDate usdSypRate').lean()
        : []
    const rateByDate = new Map(bdays.map((b) => [b.businessDate, Number(b.usdSypRate) || 0]))

    const invIds = new Set()
    for (const s of sessions) {
      for (const m of s.materials || []) {
        if (m?.inventoryItemId) invIds.add(String(m.inventoryItemId))
      }
    }
    const invDocs =
      invIds.size > 0 ? await InventoryItem.find({ _id: { $in: [...invIds] } }).select('unitCost unitCostUsd name').lean() : []
    const invById = new Map(invDocs.map((i) => [String(i._id), i]))

    const sharePercent = 50
    let totalCollectedSyp = 0
    let totalMaterialSypPricedSyp = 0
    let totalMaterialUsdPricedUsd = 0

    const shareTotals = createEmptyDermatologyShareTotals()
    const rows = []

    for (const bi of items) {
      const pay = payById.get(String(bi.paymentId))
      const collected = Math.round(Number(pay?.amountSyp) || 0)
      const cs = sessionById.get(String(bi.clinicalSessionId))
      const matTotal = Math.round(Number(cs?.materialCostSypTotal) || 0)
      const providerName = String(bi.providerUserId?.name || '—').trim()
      const patientName = String(bi.patientId?.name || '—').trim()
      const bd = String(bi.businessDate || '').trim()
      const rate = rateByDate.get(bd) || 0

      let rowMatSyp = 0
      let rowMatUsd = 0
      for (const line of cs?.materials || []) {
        const inv = invById.get(String(line.inventoryItemId))
        const sp = splitMaterialLineCost(line.lineCostSyp, inv, rate)
        rowMatSyp += Math.round(sp.sypPricedSyp)
        rowMatUsd += Number.isFinite(sp.usdPricedUsd) ? sp.usdPricedUsd : 0
      }

      totalCollectedSyp += collected
      totalMaterialSypPricedSyp += rowMatSyp
      totalMaterialUsdPricedUsd += rowMatUsd
      addDermatologyRevenueToTotals(shareTotals, collected, matTotal, providerName)

      rows.push({
        id: String(bi._id),
        businessDate: bd,
        patientName,
        providerName,
        collectedSyp: collected,
        materialCostSypPriced: rowMatSyp,
        materialCostUsdPriced: Math.round(rowMatUsd * 10000) / 10000,
        materialCostSypTotal: matTotal,
      })
    }

    const debtSettlements = await PatientDebtSettlement.find({
      businessDate: { $gte: range.from, $lte: range.to },
    })
      .populate('patientId', 'name')
      .lean()

    const debtLookup = await loadDermatologyDebtSettlementLookup(debtSettlements)
    const debtRows = applyDermatologyDebtSettlements(shareTotals, debtSettlements, debtLookup, { buildRows: true })
    for (const dr of debtRows) {
      totalCollectedSyp += dr.collectedSyp
      rows.push(dr)
    }

    const shares = finalizeDermatologyShares(shareTotals, sharePercent)
    const {
      loraPayableSyp,
      samerPayableSyp,
      loraSessionRevenueSyp: loraRevenueSyp,
      loraMaterialSyp,
      samerSessionRevenueSyp: samerRevenueSyp,
      samerMaterialSyp,
      otherSessionRevenueSyp: otherRevenueSyp,
      otherMaterialSyp,
      clinicNetSyp,
      poolLora,
      poolSamer,
      otherNetSyp,
      loraClinicHalfSyp,
      samerClinicHalfSyp,
    } = shares

    res.json({
      period: range.period,
      from: range.from,
      to: range.to,
      label: range.label,
      sharePercent,
      totals: {
        collectedRevenueSyp: Math.round(totalCollectedSyp),
        materialExpenseSypFromSypPricedItems: Math.round(totalMaterialSypPricedSyp),
        materialExpenseUsdFromUsdPricedItems: Math.round(totalMaterialUsdPricedUsd * 10000) / 10000,
      },
      loraShare: {
        providerLabel: 'الدكتورة لورا',
        sessionRevenueSyp: Math.round(loraRevenueSyp),
        materialCostSyp: Math.round(loraMaterialSyp),
        netAfterMaterialSyp: Math.round(poolLora),
        payableShareSyp: loraPayableSyp,
        clinicShareSyp: loraClinicHalfSyp,
      },
      samerShare: {
        providerLabel: 'الدكتور سامر',
        sessionRevenueSyp: Math.round(samerRevenueSyp),
        materialCostSyp: Math.round(samerMaterialSyp),
        netAfterMaterialSyp: Math.round(poolSamer),
        payableShareSyp: samerPayableSyp,
        clinicShareSyp: samerClinicHalfSyp,
      },
      others: {
        sessionRevenueSyp: Math.round(otherRevenueSyp),
        materialCostSyp: Math.round(otherMaterialSyp),
        clinicKeepsSyp: Math.round(otherNetSyp),
      },
      clinicNetSyp,
      rows,
      notes: [
        'الإيراد = مجموع مبالغ التحصيل (دفعات الاستقبال) لبنود جلدية مسدّدة في النطاق — تاريخ السطر هو يوم التحصيل المخزّن على البند.',
        'تسديد ذمم مرتبطة بجلدية يُضاف للإيراد حسب الجلسة الأصلية ومقدّمها، مع خصم مواد الجلسة عند تسديد ذمة كاملة دون تحصيل سابق.',
        'تكلفة المواد: تُجمع من جلسات الجلدية المرتبطة؛ تُقسَّم للعرض بين مواد بسعر ليرة (unitCost) ومواد بسعر دولار (unitCostUsd) مع تحويل عرض الدولار باستخدام سعر الصرف المسجّل لذلك اليوم.',
        'حصة د.لورا ود.سامر = (مجموع تحصيل جلسات الطبيب − تكلفة المواد في جلساته) × 50%.',
        'صافي ربح المركز في البطاقة = 50% المتبقية من د.لورا + 50% المتبقية من د.سامر + صافي جلسات أطباء آخرين (كامل الصافي لصالح المركز).',
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
