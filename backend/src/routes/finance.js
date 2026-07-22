import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { ExpenseEntry, EXPENSE_CATEGORIES } from '../models/ExpenseEntry.js'
import { PatientDebtSettlement } from '../models/PatientDebtSettlement.js'
import { todayBusinessDate } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'
import {
  addDermatologyRevenueToTotals,
  applyDermatologyDebtSettlements,
  createEmptyDermatologyShareTotals,
  finalizeDermatologyShares,
  loadDermatologyDebtSettlementLookup,
} from '../services/dermatologyFinanceShares.js'
import { summarizeDentalChartFinance } from '../services/dentalFinanceShares.js'

export const financeRouter = Router()

financeRouter.use(authMiddleware, loadBusinessDay, requireRoles('super_admin'))

function parseYmd(raw) {
  const s = String(raw || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function parseRange(fromStr, toStr) {
  const today = todayBusinessDate()
  const to = parseYmd(toStr) || today
  let from = parseYmd(fromStr)
  if (!from) {
    const [y, m, d] = to.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    dt.setDate(dt.getDate() - 29)
    const yy = dt.getFullYear()
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    const dd = String(dt.getDate()).padStart(2, '0')
    from = `${yy}-${mm}-${dd}`
  }
  if (from > to) return null
  return { from, to }
}

function normalizeDeptFilter(raw) {
  const d = String(raw || '').trim().toLowerCase()
  if (!d || d === 'all') return null
  if (d === 'skincare') return 'skin'
  if (['laser', 'dermatology', 'skin', 'dental', 'solarium', 'general'].includes(d)) return d
  return null
}

function parseObjectId(raw) {
  const s = String(raw || '').trim()
  if (!mongoose.Types.ObjectId.isValid(s)) return null
  return new mongoose.Types.ObjectId(s)
}

async function sumExpensesByCategory({ from, to }) {
  const rows = await ExpenseEntry.aggregate([
    { $match: { businessDate: { $gte: from, $lte: to } } },
    { $group: { _id: '$category', totalSyp: { $sum: '$amountSyp' } } },
  ])
  const map = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0]))
  for (const r of rows) {
    const k = r._id
    if (k && map[k] != null) map[k] = Math.round(Number(r.totalSyp) || 0)
  }
  return map
}

async function loadPaidBillingItems({ from, to, department, providerUserId }) {
  const match = {
    status: 'paid',
    paymentId: { $ne: null },
    businessDate: { $gte: from, $lte: to },
  }
  if (department && department !== 'general') {
    match.department = department
  }
  if (providerUserId) match.providerUserId = providerUserId

  const items = await BillingItem.find(match)
    .sort({ businessDate: 1, paidAt: 1 })
    .populate('providerUserId', 'name')
    .populate('patientId', 'name')
    .lean()

  const sessionIds = [...new Set(items.map((i) => i.clinicalSessionId).filter(Boolean).map(String))]
  const sessions =
    sessionIds.length > 0
      ? await ClinicalSession.find({ _id: { $in: sessionIds } })
          .select('materials materialCostSypTotal businessDate department')
          .lean()
      : []
  const sessionById = new Map(sessions.map((s) => [String(s._id), s]))

  const payIds = [...new Set(items.map((i) => i.paymentId).filter(Boolean).map(String))]
  const payments =
    payIds.length > 0
      ? await BillingPayment.find({ _id: { $in: payIds } })
          .select('amountSyp discountPercent listAmountDueSyp effectiveAmountDueSyp receivedAt')
          .lean()
      : []
  const payById = new Map(payments.map((p) => [String(p._id), p]))

  return { items, sessionById, payById }
}

const DEPT_LABEL_AR = {
  laser: 'ليزر',
  dermatology: 'جلدية',
  skin: 'بشرة',
  dental: 'أسنان',
  solarium: 'سولاريوم',
}

/**
 * صفوف الخصومات من البنود المسدّدة (نسبة/قيمة > 0).
 * يفضّل لقطة الدفع إن وُجدت، وإلا حقول البند.
 */
function buildDiscountRows(items, payById) {
  const rows = []
  let totalDiscountSyp = 0
  for (const bi of items) {
    const pay = payById.get(String(bi.paymentId))
    const payPct = Number(pay?.discountPercent) || 0
    const biPct = Number(bi.discountPercent) || 0
    const discountPercent = payPct > 0 ? payPct : biPct
    const listAmountDueSyp = Math.round(
      Number(
        payPct > 0 && Number(pay?.listAmountDueSyp) > 0
          ? pay.listAmountDueSyp
          : bi.listAmountDueSyp || bi.amountDueSyp,
      ) || 0,
    )
    const effectiveAmountDueSyp = Math.round(
      Number(
        payPct > 0 && Number(pay?.effectiveAmountDueSyp) >= 0
          ? pay.effectiveAmountDueSyp
          : bi.effectiveAmountDueSyp || bi.amountDueSyp,
      ) || 0,
    )
    const discountValueSyp = Math.max(0, listAmountDueSyp - effectiveAmountDueSyp)
    if (!(discountPercent > 0) && !(discountValueSyp > 0)) continue

    const patientName =
      bi.patientId && typeof bi.patientId === 'object' && bi.patientId.name != null
        ? String(bi.patientId.name || '').trim()
        : ''
    const providerName =
      bi.providerUserId && typeof bi.providerUserId === 'object' && bi.providerUserId.name != null
        ? String(bi.providerUserId.name || '').trim()
        : ''
    const department = String(bi.department || '')
    rows.push({
      billingItemId: String(bi._id),
      paymentId: bi.paymentId ? String(bi.paymentId) : null,
      patientName: patientName || '—',
      procedureLabel: String(bi.procedureLabel || '—'),
      department,
      departmentLabel: DEPT_LABEL_AR[department] || department || '—',
      providerName: providerName || '—',
      listAmountDueSyp,
      discountPercent,
      effectiveAmountDueSyp,
      discountValueSyp,
      businessDate: String(bi.businessDate || ''),
      paidAt: bi.paidAt ? new Date(bi.paidAt).toISOString() : null,
    })
    totalDiscountSyp += discountValueSyp
  }
  rows.sort((a, b) => {
    const d = String(b.businessDate).localeCompare(String(a.businessDate), 'ar')
    if (d !== 0) return d
    return String(b.paidAt || '').localeCompare(String(a.paidAt || ''))
  })
  return { totalDiscountSyp: Math.round(totalDiscountSyp), rows }
}

function collectedForItem(bi, payById) {
  const pay = payById.get(String(bi.paymentId))
  return Math.round(Number(pay?.amountSyp) || 0)
}

function computeDermatologyShares(items, sessionById, payById, debtSettlements = [], debtLookup = null) {
  const sharePercent = 50
  const totals = createEmptyDermatologyShareTotals()

  for (const bi of items) {
    if (bi.department !== 'dermatology') continue
    const collected = collectedForItem(bi, payById)
    const cs = sessionById.get(String(bi.clinicalSessionId))
    const matTotal = Math.round(Number(cs?.materialCostSypTotal) || 0)
    const providerName = String(bi.providerUserId?.name || '').trim()
    addDermatologyRevenueToTotals(totals, collected, matTotal, providerName)
  }

  if (debtSettlements.length > 0 && debtLookup) {
    applyDermatologyDebtSettlements(totals, debtSettlements, debtLookup)
  }

  return finalizeDermatologyShares(totals, sharePercent)
}

function sumRevenueByDepartment(items, payById) {
  const rev = { laser: 0, dermatology: 0, skin: 0, dental: 0, solarium: 0 }
  for (const bi of items) {
    const dep = bi.department
    if (!Object.prototype.hasOwnProperty.call(rev, dep)) continue
    rev[dep] += collectedForItem(bi, payById)
  }
  for (const k of Object.keys(rev)) rev[k] = Math.round(rev[k])
  return rev
}

function sumDebtSettlementRevenueFromSettlements(settlements) {
  const rev = { laser: 0, dermatology: 0, skin: 0, dental: 0, solarium: 0 }
  for (const ds of settlements || []) {
    for (const alloc of ds.departmentAllocations || []) {
      const dep = alloc.department
      if (!Object.prototype.hasOwnProperty.call(rev, dep)) continue
      rev[dep] += Math.round(Number(alloc.amountSyp) || 0)
    }
  }
  for (const k of Object.keys(rev)) rev[k] = Math.round(rev[k])
  return rev
}

async function sumDebtSettlementRevenueByDepartment({ from, to }) {
  const settlements = await PatientDebtSettlement.find({
    businessDate: { $gte: from, $lte: to },
  }).lean()
  return sumDebtSettlementRevenueFromSettlements(settlements)
}

function laserSpecialistTop(items, payById) {
  const map = new Map()
  for (const bi of items) {
    if (bi.department !== 'laser') continue
    const id = String(bi.providerUserId?._id || bi.providerUserId || '')
    if (!id) continue
    const name = String(bi.providerUserId?.name || '—').trim()
    const prev = map.get(id) || { userId: id, name, revenueSyp: 0 }
    prev.revenueSyp += collectedForItem(bi, payById)
    prev.name = name || prev.name
    map.set(id, prev)
  }
  let best = null
  for (const v of map.values()) {
    if (!best || v.revenueSyp > best.revenueSyp) best = { ...v, revenueSyp: Math.round(v.revenueSyp) }
  }
  return best
}

financeRouter.get('/expenses', async (req, res) => {
  try {
    const range = parseRange(req.query.from, req.query.to)
    if (!range) {
      res.status(400).json({ error: 'نطاق التاريخ غير صالح' })
      return
    }
    const cat = String(req.query.category || '').trim().toLowerCase()
    const q = { businessDate: { $gte: range.from, $lte: range.to } }
    if (cat && EXPENSE_CATEGORIES.includes(cat)) q.category = cat

    const entries = await ExpenseEntry.find(q).sort({ businessDate: -1, createdAt: -1 }).lean()
    const totalSyp = entries.reduce((a, e) => a + Math.round(Number(e.amountSyp) || 0), 0)
    res.json({
      from: range.from,
      to: range.to,
      entries: entries.map((e) => ({
        id: String(e._id),
        category: e.category,
        reason: e.reason,
        amountSyp: Math.round(Number(e.amountSyp) || 0),
        businessDate: e.businessDate,
        createdAt: e.createdAt,
      })),
      totalSyp: Math.round(totalSyp),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

financeRouter.post('/expenses', async (req, res) => {
  try {
    const body = req.body ?? {}
    const category = String(body.category || '').trim().toLowerCase()
    if (!EXPENSE_CATEGORIES.includes(category)) {
      res.status(400).json({ error: 'تصنيف المصروف غير صالح' })
      return
    }
    const reason = String(body.reason ?? '').trim()
    if (!reason) {
      res.status(400).json({ error: 'سبب المصروف مطلوب' })
      return
    }
    const amountSyp = Math.round(Number(body.amountSyp))
    if (!Number.isFinite(amountSyp) || amountSyp < 0) {
      res.status(400).json({ error: 'المبلغ غير صالح' })
      return
    }
    const businessDate = parseYmd(body.businessDate) || req.businessDate || todayBusinessDate()

    const doc = await ExpenseEntry.create({
      category,
      reason: reason.slice(0, 2000),
      amountSyp,
      businessDate,
      createdByUserId: req.user._id,
    })
    await writeAudit({
      user: req.user,
      action: 'إضافة مصروف',
      entityType: 'ExpenseEntry',
      entityId: doc._id,
      details: { category, amountSyp, businessDate },
    })
    res.status(201).json({
      entry: {
        id: String(doc._id),
        category: doc.category,
        reason: doc.reason,
        amountSyp: Math.round(Number(doc.amountSyp) || 0),
        businessDate: doc.businessDate,
        createdAt: doc.createdAt,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

financeRouter.patch('/expenses/:id', async (req, res) => {
  try {
    const doc = await ExpenseEntry.findById(req.params.id)
    if (!doc) {
      res.status(404).json({ error: 'غير موجود' })
      return
    }
    const body = req.body ?? {}
    if (typeof body.reason === 'string') {
      const r = body.reason.trim()
      if (!r) {
        res.status(400).json({ error: 'سبب المصروف مطلوب' })
        return
      }
      doc.reason = r.slice(0, 2000)
    }
    if (body.amountSyp != null) {
      const amountSyp = Math.round(Number(body.amountSyp))
      if (!Number.isFinite(amountSyp) || amountSyp < 0) {
        res.status(400).json({ error: 'المبلغ غير صالح' })
        return
      }
      doc.amountSyp = amountSyp
    }
    if (body.businessDate != null) {
      const bd = parseYmd(body.businessDate)
      if (!bd) {
        res.status(400).json({ error: 'تاريخ غير صالح' })
        return
      }
      doc.businessDate = bd
    }
    if (body.category != null) {
      const category = String(body.category || '').trim().toLowerCase()
      if (!EXPENSE_CATEGORIES.includes(category)) {
        res.status(400).json({ error: 'تصنيف المصروف غير صالح' })
        return
      }
      doc.category = category
    }
    await doc.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل مصروف',
      entityType: 'ExpenseEntry',
      entityId: doc._id,
    })
    res.json({
      entry: {
        id: String(doc._id),
        category: doc.category,
        reason: doc.reason,
        amountSyp: Math.round(Number(doc.amountSyp) || 0),
        businessDate: doc.businessDate,
        createdAt: doc.createdAt,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

financeRouter.delete('/expenses/:id', async (req, res) => {
  try {
    const doc = await ExpenseEntry.findByIdAndDelete(req.params.id)
    if (!doc) {
      res.status(404).json({ error: 'غير موجود' })
      return
    }
    await writeAudit({
      user: req.user,
      action: 'حذف مصروف',
      entityType: 'ExpenseEntry',
      entityId: doc._id,
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

financeRouter.get('/dashboard', async (req, res) => {
  try {
    const range = parseRange(req.query.from, req.query.to)
    if (!range) {
      res.status(400).json({ error: 'نطاق التاريخ غير صالح' })
      return
    }
    const deptFilter = normalizeDeptFilter(req.query.department)
    const providerOid = parseObjectId(req.query.providerUserId)

    const expenseTotals = await sumExpensesByCategory(range)
    const totalExpensesTablesSyp = Math.round(
      EXPENSE_CATEGORIES.reduce((a, c) => a + (expenseTotals[c] || 0), 0),
    )

    let items = []
    let sessionById = new Map()
    let payById = new Map()
    if (deptFilter !== 'general') {
      const bundle = await loadPaidBillingItems({
        from: range.from,
        to: range.to,
        department: deptFilter || null,
        providerUserId: providerOid,
      })
      items = bundle.items
      sessionById = bundle.sessionById
      payById = bundle.payById
    }

    const debtSettlements = await PatientDebtSettlement.find({
      businessDate: { $gte: range.from, $lte: range.to },
    }).lean()
    const debtLookup = await loadDermatologyDebtSettlementLookup(debtSettlements)

    const revenueByDept = sumRevenueByDepartment(items, payById)
    const debtRevByDept = sumDebtSettlementRevenueFromSettlements(debtSettlements)
    for (const k of Object.keys(revenueByDept)) {
      if (deptFilter && deptFilter !== 'general' && k !== deptFilter) continue
      revenueByDept[k] = Math.round((revenueByDept[k] || 0) + (debtRevByDept[k] || 0))
    }
    let totalRevenueSyp = Math.round(Object.values(revenueByDept).reduce((a, n) => a + n, 0))
    let overallExpensesTablesSyp = totalExpensesTablesSyp
    if (deptFilter === 'general') {
      totalRevenueSyp = 0
      overallExpensesTablesSyp = Math.round(expenseTotals.general || 0)
    } else if (deptFilter) {
      overallExpensesTablesSyp = Math.round(expenseTotals[deptFilter] || 0)
    }

    const dermShares = computeDermatologyShares(items, sessionById, payById, debtSettlements, debtLookup)
    const discounts = buildDiscountRows(items, payById)

    const laserRev = revenueByDept.laser
    const laserExp = expenseTotals.laser || 0
    const laserProfit = Math.round(laserRev - laserExp)
    const laserTop = laserSpecialistTop(items, payById)

    const dermRev = revenueByDept.dermatology
    const dermTable = expenseTotals.dermatology || 0
    const dermMaterials = dermShares.totalMaterialSyp
    const dermExpensesTotal = Math.round(dermTable + dermMaterials)
    const dermProfit = Math.round(dermShares.clinicNetSyp - dermTable)

    const skinRev = revenueByDept.skin
    const skinExp = expenseTotals.skin || 0
    const skinProfit = Math.round(skinRev - skinExp)

    const dentalChart = await summarizeDentalChartFinance({ from: range.from, to: range.to })
    const billingDentalRev = revenueByDept.dental || 0
    /** إيراد قسم الأسنان من مخطط الإجراءات (مصدر الحصص والمخابر) */
    const dentalRev = dentalChart.totalRevenueSyp
    const dentalExp = expenseTotals.dental || 0
    const dentalLabs = dentalChart.labWorksTotalSyp
    const dentalSharesTotal = dentalChart.doctorSharesTotalSyp
    /** الربح الصافي = المتبقي بعد حصص الأطباء − المخابر − جدول مصاريف الأسنان */
    const dentalProfit = Math.round(dentalRev - dentalSharesTotal - dentalLabs - dentalExp)
    revenueByDept.dental = dentalRev
    totalRevenueSyp = Math.round(totalRevenueSyp - billingDentalRev + dentalRev)

    const solariumRev = revenueByDept.solarium
    const solariumExp = expenseTotals.solarium || 0
    const solariumProfit = Math.round(solariumRev - solariumExp)

    const generalExp = expenseTotals.general || 0
    const generalProfit = Math.round(-generalExp)

    let totalProfitSyp = laserProfit + dermProfit + skinProfit + dentalProfit + solariumProfit + generalProfit

    if (deptFilter === 'general') {
      totalProfitSyp = generalProfit
    } else if (deptFilter) {
      const parts = {
        laser: laserProfit,
        dermatology: dermProfit,
        skin: skinProfit,
        dental: dentalProfit,
        solarium: solariumProfit,
      }
      totalProfitSyp = parts[deptFilter] ?? totalProfitSyp
    }

    const chartRevenueByDepartment = [
      { key: 'laser', label: 'الليزر', revenueSyp: revenueByDept.laser },
      { key: 'dermatology', label: 'الجلدية', revenueSyp: revenueByDept.dermatology },
      { key: 'skin', label: 'العناية بالبشرة', revenueSyp: revenueByDept.skin },
      { key: 'dental', label: 'الأسنان', revenueSyp: dentalRev },
      { key: 'solarium', label: 'السولاريوم', revenueSyp: revenueByDept.solarium },
    ].filter((r) => r.revenueSyp > 0 || !deptFilter)

    const chartExpenseByCategory = EXPENSE_CATEGORIES.map((key) => ({
      key,
      label:
        key === 'laser'
          ? 'ليزر'
          : key === 'dermatology'
            ? 'جلدية'
            : key === 'skin'
              ? 'بشرة'
              : key === 'solarium'
                ? 'سولاريوم'
                : key === 'dental'
                  ? 'أسنان'
                  : 'عام',
      expensesSyp: expenseTotals[key] || 0,
    }))

    res.json({
      from: range.from,
      to: range.to,
      filters: {
        department: deptFilter || 'all',
        providerUserId: providerOid ? String(providerOid) : null,
      },
      overall: {
        totalRevenueSyp,
        totalExpensesSyp: overallExpensesTablesSyp,
        totalProfitSyp: Math.round(totalProfitSyp),
        totalDiscountsSyp: discounts.totalDiscountSyp,
      },
      discounts: {
        totalDiscountSyp: discounts.totalDiscountSyp,
        count: discounts.rows.length,
        rows: discounts.rows,
      },
      laser: {
        totalRevenueSyp: laserRev,
        totalExpensesSyp: laserExp,
        totalProfitSyp: laserProfit,
        highestRevenueSpecialist: laserTop,
      },
      dermatology: {
        totalRevenueSyp: dermRev,
        expensesTableSyp: dermTable,
        materialsTotalSyp: dermMaterials,
        totalExpensesSyp: dermExpensesTotal,
        lauraShareSyp: dermShares.loraPayableSyp,
        samerShareSyp: dermShares.samerPayableSyp,
        lauraSessionRevenueSyp: dermShares.loraSessionRevenueSyp,
        lauraMaterialSyp: dermShares.loraMaterialSyp,
        samerSessionRevenueSyp: dermShares.samerSessionRevenueSyp,
        samerMaterialSyp: dermShares.samerMaterialSyp,
        totalProfitSyp: dermProfit,
        clinicNetBeforeTableSyp: dermShares.clinicNetSyp,
        sharePercent: dermShares.sharePercent,
      },
      skincare: {
        totalRevenueSyp: skinRev,
        totalExpensesSyp: skinExp,
        totalProfitSyp: skinProfit,
      },
      dental: {
        totalRevenueSyp: dentalRev,
        expensesTableSyp: dentalExp,
        labWorksTotalSyp: dentalLabs,
        totalExpensesSyp: Math.round(dentalExp + dentalLabs),
        ayhamShareSyp: dentalChart.ayhamShareSyp,
        iyadShareSyp: dentalChart.iyadShareSyp,
        omarShareSyp: dentalChart.omarShareSyp,
        otherShareSyp: dentalChart.otherShareSyp,
        ayhamProceduresSyp: dentalChart.ayhamProceduresSyp,
        iyadProceduresSyp: dentalChart.iyadProceduresSyp,
        omarProceduresSyp: dentalChart.omarProceduresSyp,
        doctorSharesTotalSyp: dentalSharesTotal,
        clinicRemainderAfterSharesSyp: dentalChart.clinicRemainderAfterSharesSyp,
        totalProfitSyp: dentalProfit,
        sharePercent: dentalChart.sharePercent,
        doctors: dentalChart.doctors,
      },
      solarium: {
        totalRevenueSyp: solariumRev,
        totalExpensesSyp: solariumExp,
        totalProfitSyp: solariumProfit,
      },
      general: {
        totalExpensesSyp: generalExp,
        totalProfitSyp: generalProfit,
      },
      charts: {
        revenueByDepartment: chartRevenueByDepartment,
        expensesByCategory: chartExpenseByCategory,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
