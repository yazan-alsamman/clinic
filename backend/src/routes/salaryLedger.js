import { Router } from 'express'
import mongoose from 'mongoose'
import { SalaryEmployee } from '../models/SalaryEmployee.js'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { expenseEffectiveAmountSyp } from '../models/ExpenseEntry.js'
import { todayBusinessDate } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'

export const salaryLedgerRouter = Router()

function parseYmd(raw) {
  const s = String(raw || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

function serializePayment(p) {
  const amountSyp = roundMoney(p.amountSyp)
  const amountUsd = round2(p.amountUsd)
  const usdSypRate = Math.max(0, Number(p.usdSypRate) || 0)
  return {
    id: String(p._id),
    employeeId: String(p.employeeId),
    amountSyp,
    amountUsd,
    usdSypRate,
    effectiveAmountSyp: expenseEffectiveAmountSyp({ amountSyp, amountUsd, usdSypRate }),
    businessDate: p.businessDate,
    note: String(p.note || ''),
    createdAt: p.createdAt,
  }
}

export async function sumSalaryPaymentsSyp({ from, to }) {
  const rows = await SalaryPayment.find({ businessDate: { $gte: from, $lte: to } })
    .select('amountSyp amountUsd usdSypRate')
    .lean()
  return roundMoney(rows.reduce((s, r) => s + expenseEffectiveAmountSyp(r), 0))
}

salaryLedgerRouter.get('/', async (req, res) => {
  try {
    const from = parseYmd(req.query.from)
    const to = parseYmd(req.query.to)
    if (!from || !to || from > to) {
      res.status(400).json({ error: 'نطاق التاريخ غير صالح' })
      return
    }

    const employees = await SalaryEmployee.find().sort({ sortOrder: 1, name: 1 }).lean()
    const payments = await SalaryPayment.find({ businessDate: { $gte: from, $lte: to } })
      .sort({ businessDate: -1, createdAt: -1 })
      .lean()

    const byEmp = new Map()
    for (const p of payments) {
      const k = String(p.employeeId)
      if (!byEmp.has(k)) byEmp.set(k, [])
      byEmp.get(k).push(serializePayment(p))
    }

    const rows = employees.map((e) => {
      const list = byEmp.get(String(e._id)) || []
      const paidSyp = roundMoney(list.reduce((s, p) => s + p.effectiveAmountSyp, 0))
      const monthly = roundMoney(e.monthlySalarySyp)
      return {
        id: String(e._id),
        name: String(e.name || ''),
        title: String(e.title || ''),
        monthlySalarySyp: monthly,
        active: e.active !== false,
        paymentCount: list.length,
        paidSyp,
        remainingSyp: monthly > 0 ? Math.max(0, monthly - paidSyp) : 0,
        lastPaymentDate: list[0]?.businessDate || '',
        payments: list,
      }
    })

    res.json({
      from,
      to,
      employees: rows,
      totals: {
        employeeCount: rows.filter((r) => r.active).length,
        paymentCount: payments.length,
        paidSyp: roundMoney(rows.reduce((s, r) => s + r.paidSyp, 0)),
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

salaryLedgerRouter.post('/employees', async (req, res) => {
  try {
    const body = req.body ?? {}
    const name = String(body.name || '').trim()
    if (!name) {
      res.status(400).json({ error: 'اسم الموظف مطلوب' })
      return
    }
    const doc = await SalaryEmployee.create({
      name: name.slice(0, 200),
      title: String(body.title || '').trim().slice(0, 200),
      monthlySalarySyp: Math.max(0, roundMoney(body.monthlySalarySyp)),
      active: body.active !== false,
    })
    await writeAudit({
      user: req.user,
      action: 'إضافة موظف للرواتب',
      entityType: 'SalaryEmployee',
      entityId: doc._id,
      details: { name: doc.name },
    })
    res.status(201).json({
      employee: {
        id: String(doc._id),
        name: doc.name,
        title: doc.title || '',
        monthlySalarySyp: roundMoney(doc.monthlySalarySyp),
        active: doc.active !== false,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

salaryLedgerRouter.patch('/employees/:id', async (req, res) => {
  try {
    const doc = await SalaryEmployee.findById(req.params.id)
    if (!doc) {
      res.status(404).json({ error: 'الموظف غير موجود' })
      return
    }
    const body = req.body ?? {}
    if (body.name != null) {
      const name = String(body.name).trim()
      if (!name) {
        res.status(400).json({ error: 'اسم الموظف مطلوب' })
        return
      }
      doc.name = name.slice(0, 200)
    }
    if (body.title != null) doc.title = String(body.title).trim().slice(0, 200)
    if (body.monthlySalarySyp != null) doc.monthlySalarySyp = Math.max(0, roundMoney(body.monthlySalarySyp))
    if (body.active != null) doc.active = Boolean(body.active)
    await doc.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل موظف رواتب',
      entityType: 'SalaryEmployee',
      entityId: doc._id,
    })
    res.json({
      employee: {
        id: String(doc._id),
        name: doc.name,
        title: doc.title || '',
        monthlySalarySyp: roundMoney(doc.monthlySalarySyp),
        active: doc.active !== false,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

salaryLedgerRouter.delete('/employees/:id', async (req, res) => {
  try {
    const id = req.params.id
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const payCount = await SalaryPayment.countDocuments({ employeeId: id })
    if (payCount > 0) {
      res.status(400).json({
        error: `لا يمكن حذف الموظف وفي سجله ${payCount} دفعة — احذف الدفعات أولاً أو أوقفه.`,
      })
      return
    }
    const doc = await SalaryEmployee.findByIdAndDelete(id)
    if (!doc) {
      res.status(404).json({ error: 'الموظف غير موجود' })
      return
    }
    await writeAudit({
      user: req.user,
      action: 'حذف موظف رواتب',
      entityType: 'SalaryEmployee',
      entityId: id,
      details: { name: doc.name },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

salaryLedgerRouter.post('/payments', async (req, res) => {
  try {
    const body = req.body ?? {}
    const employeeId = String(body.employeeId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      res.status(400).json({ error: 'الموظف غير صالح' })
      return
    }
    const emp = await SalaryEmployee.findById(employeeId)
    if (!emp) {
      res.status(404).json({ error: 'الموظف غير موجود' })
      return
    }
    const amountSyp = roundMoney(body.amountSyp)
    const amountUsd = round2(body.amountUsd)
    if (!(amountSyp > 0 || amountUsd > 0)) {
      res.status(400).json({ error: 'أدخل مبلغ دفعة بالليرة أو بالدولار' })
      return
    }
    const businessDate = parseYmd(body.businessDate) || req.businessDate || todayBusinessDate()
    let usdSypRate = 0
    if (amountUsd > 0) {
      const fromBody = Math.max(0, Number(body.usdSypRate) || 0)
      const fromDay = Math.max(0, Number(req.businessDay?.usdSypRate) || 0)
      usdSypRate = fromBody > 0 ? fromBody : fromDay
      if (!(usdSypRate > 0)) {
        res.status(400).json({ error: 'سعر صرف الدولار غير متوفر — أدخل السعر أو ابدأ يوم العمل' })
        return
      }
    }
    const doc = await SalaryPayment.create({
      employeeId,
      amountSyp,
      amountUsd,
      usdSypRate,
      businessDate,
      note: String(body.note || '').trim().slice(0, 2000),
      createdByUserId: req.user?._id || null,
    })
    await writeAudit({
      user: req.user,
      action: 'دفعة راتب',
      entityType: 'SalaryPayment',
      entityId: doc._id,
      details: { employeeId, employeeName: emp.name, amountSyp, amountUsd, businessDate },
    })
    res.status(201).json({ payment: serializePayment(doc) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

salaryLedgerRouter.patch('/payments/:id', async (req, res) => {
  try {
    const doc = await SalaryPayment.findById(req.params.id)
    if (!doc) {
      res.status(404).json({ error: 'الدفعة غير موجودة' })
      return
    }
    const body = req.body ?? {}
    if (body.amountSyp != null) doc.amountSyp = roundMoney(body.amountSyp)
    if (body.amountUsd != null) doc.amountUsd = round2(body.amountUsd)
    if (body.note != null) doc.note = String(body.note).trim().slice(0, 2000)
    if (body.businessDate != null) {
      const d = parseYmd(body.businessDate)
      if (!d) {
        res.status(400).json({ error: 'تاريخ غير صالح' })
        return
      }
      doc.businessDate = d
    }
    if (doc.amountUsd > 0) {
      const fromBody = Math.max(0, Number(body.usdSypRate) || 0)
      if (fromBody > 0) doc.usdSypRate = fromBody
      else if (!(doc.usdSypRate > 0)) {
        doc.usdSypRate = Math.max(0, Number(req.businessDay?.usdSypRate) || 0)
      }
      if (!(doc.usdSypRate > 0)) {
        res.status(400).json({ error: 'سعر صرف الدولار غير متوفر لهذه الدفعة' })
        return
      }
    } else {
      doc.usdSypRate = 0
    }
    if (!(roundMoney(doc.amountSyp) > 0 || round2(doc.amountUsd) > 0)) {
      res.status(400).json({ error: 'أدخل مبلغاً بالليرة أو بالدولار' })
      return
    }
    await doc.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل دفعة راتب',
      entityType: 'SalaryPayment',
      entityId: doc._id,
    })
    res.json({ payment: serializePayment(doc) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

salaryLedgerRouter.delete('/payments/:id', async (req, res) => {
  try {
    const doc = await SalaryPayment.findByIdAndDelete(req.params.id)
    if (!doc) {
      res.status(404).json({ error: 'الدفعة غير موجودة' })
      return
    }
    await writeAudit({
      user: req.user,
      action: 'حذف دفعة راتب',
      entityType: 'SalaryPayment',
      entityId: req.params.id,
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
