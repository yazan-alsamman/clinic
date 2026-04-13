import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { Patient } from '../models/Patient.js'
import { InventoryItem } from '../models/InventoryItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'
import { round2 } from '../utils/money.js'

export const clinicalRouter = Router()

clinicalRouter.use(authMiddleware, loadBusinessDay)

const CLINICAL_ROLES = ['super_admin', 'laser', 'dermatology', 'dental_branch']

function departmentFromRequest(req) {
  const role = req.user.role
  if (role === 'super_admin') {
    const d = String(req.body?.department || '').trim()
    if (['laser', 'dermatology', 'dental'].includes(d)) return d
    return null
  }
  if (role === 'laser') return 'laser'
  if (role === 'dermatology') return 'dermatology'
  if (role === 'dental_branch') return 'dental'
  return null
}

/**
 * خصم المواد مع إرجاع الكميات عند الفشل
 * @param {Array<{ inventoryItemId: string, quantity: number }>} rawLines
 */
async function consumeMaterials(rawLines) {
  const applied = []
  const snapshot = []
  try {
    for (const line of rawLines || []) {
      const qty = Math.max(0, Number(line.quantity) || 0)
      if (qty <= 0) continue
      if (!mongoose.isValidObjectId(line.inventoryItemId)) {
        throw new Error('معرّف مادة غير صالح')
      }
      const item = await InventoryItem.findById(line.inventoryItemId)
      if (!item) throw new Error('مادة غير موجودة في المستودع')
      if (item.quantity < qty) {
        throw new Error(`الكمية غير كافية لـ «${item.name}» (المتاح ${item.quantity})`)
      }
      item.quantity -= qty
      await item.save()
      applied.push({ id: item._id, qty })
      const unitCost = Number(item.unitCost) || 0
      snapshot.push({
        inventoryItemId: item._id,
        sku: item.sku,
        name: item.name,
        quantity: qty,
        unitCostUsd: unitCost,
        lineCostUsd: round2(unitCost * qty),
        chargedUnitPriceUsd: 0,
        lineChargeUsd: 0,
      })
    }
    return snapshot
  } catch (e) {
    for (const a of applied) {
      await InventoryItem.findByIdAndUpdate(a.id, { $inc: { quantity: a.qty } })
    }
    throw e
  }
}

async function restoreMaterialsFromSnapshot(snapshot) {
  for (const m of snapshot || []) {
    if (!m?.inventoryItemId || !m?.quantity) continue
    await InventoryItem.findByIdAndUpdate(m.inventoryItemId, { $inc: { quantity: m.quantity } })
  }
}

/** إضافة جلسة سريرية + بند فوترة معلّق — لا ترحيل محاسبي ولا «مدفوع» */
clinicalRouter.post(
  '/sessions',
  requireActiveDay,
  requireRoles(...CLINICAL_ROLES),
  async (req, res) => {
    try {
      const department = departmentFromRequest(req)
      if (!department) {
        res.status(400).json({ error: 'القسم غير محدد أو غير صالح (للمدير: أرسل department)' })
        return
      }

      const body = req.body ?? {}
      const patientId = body.patientId
      if (!mongoose.isValidObjectId(patientId)) {
        res.status(400).json({ error: 'معرّف المريض غير صالح' })
        return
      }
      const patient = await Patient.findById(patientId)
      if (!patient) {
        res.status(404).json({ error: 'المريض غير موجود' })
        return
      }

      const sessionFeeUsd = round2(Number(body.sessionFeeUsd) || 0)
      if (sessionFeeUsd <= 0) {
        res.status(400).json({ error: 'رسوم الجلسة يجب أن تكون أكبر من صفر' })
        return
      }

      const procedureDescription = String(body.procedureDescription || '').trim().slice(0, 500)
      const notes = String(body.notes || '').trim().slice(0, 2000)
      const businessDate = String(body.businessDate || '').trim() || req.businessDate || todayBusinessDate()

      const materialsInput = Array.isArray(body.materials) ? body.materials : []
      let materialLines = []
      try {
        materialLines = await consumeMaterials(materialsInput)
      } catch (invErr) {
        res.status(400).json({ error: String(invErr.message || invErr) })
        return
      }

      const materialCostUsdTotal = round2(materialLines.reduce((s, m) => s + (m.lineCostUsd || 0), 0))
      const materialChargeUsdTotal = round2(materialLines.reduce((s, m) => s + (m.lineChargeUsd || 0), 0))
      const amountDueUsd = round2(sessionFeeUsd + materialChargeUsdTotal)

      let cs = null
      try {
        cs = await ClinicalSession.create({
          patientId: patient._id,
          providerUserId: req.user._id,
          department,
          procedureDescription,
          sessionFeeUsd,
          businessDate,
          notes,
          materials: materialLines,
          materialCostUsdTotal,
          materialChargeUsdTotal,
        })

        const bi = await BillingItem.create({
          clinicalSessionId: cs._id,
          patientId: patient._id,
          providerUserId: req.user._id,
          department,
          procedureLabel: procedureDescription || 'إجراء',
          amountDueUsd,
          currency: 'USD',
          businessDate,
          status: 'pending_payment',
        })

        cs.billingItemId = bi._id
        await cs.save()
        if (!patient.departments.includes(department)) {
          patient.departments = [...new Set([...patient.departments, department])]
        }
        patient.lastVisit = new Date()
        await patient.save()

        await writeAudit({
          user: req.user,
          action: 'تسجيل جلسة سريرية وبند فوترة معلّق',
          entityType: 'ClinicalSession',
          entityId: cs._id,
          details: { billingItemId: String(bi._id), amountDueUsd, materialChargeUsdTotal },
        })

        res.status(201).json({
          clinicalSession: {
            id: String(cs._id),
            patientId: String(cs.patientId),
            department: cs.department,
            procedureDescription: cs.procedureDescription,
            sessionFeeUsd: cs.sessionFeeUsd,
            businessDate: cs.businessDate,
            materialCostUsdTotal: cs.materialCostUsdTotal,
            materialChargeUsdTotal: cs.materialChargeUsdTotal,
            materials: cs.materials,
          },
          billingItem: {
            id: String(bi._id),
            status: bi.status,
            amountDueUsd: bi.amountDueUsd,
            procedureLabel: bi.procedureLabel,
          },
        })
      } catch (inner) {
        if (cs?._id) {
          await BillingItem.deleteMany({ clinicalSessionId: cs._id })
          await ClinicalSession.findByIdAndDelete(cs._id)
        }
        await restoreMaterialsFromSnapshot(materialLines)
        console.error(inner)
        res.status(500).json({ error: 'تعذر إنشاء الجلسة أو بند الفوترة' })
      }
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

/** قائمة جلساتي (مقدّم الخدمة) أو الكل للمدير */
clinicalRouter.get('/sessions/mine', requireRoles(...CLINICAL_ROLES), async (req, res) => {
  try {
    const q = {}
    if (req.user.role !== 'super_admin') {
      q.providerUserId = req.user._id
    }
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30))
    const rows = await ClinicalSession.find(q).sort({ createdAt: -1 }).limit(limit).populate('patientId', 'name').lean()
    res.json({
      sessions: rows.map((r) => ({
        id: String(r._id),
        patientName: r.patientId?.name ?? '',
        department: r.department,
        procedureDescription: r.procedureDescription,
        sessionFeeUsd: r.sessionFeeUsd,
        businessDate: r.businessDate,
        createdAt: r.createdAt,
        billingItemId: r.billingItemId ? String(r.billingItemId) : null,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

clinicalRouter.get('/sessions/patient/:patientId', requireRoles(...CLINICAL_ROLES), async (req, res) => {
  try {
    const patientId = String(req.params.patientId || '').trim()
    if (!mongoose.isValidObjectId(patientId)) {
      res.status(400).json({ error: 'معرّف المريض غير صالح' })
      return
    }
    const q = { patientId }
    if (req.user.role !== 'super_admin') q.providerUserId = req.user._id
    const rows = await ClinicalSession.find(q)
      .sort({ createdAt: -1 })
      .limit(120)
      .populate('providerUserId', 'name')
      .populate('billingItemId', 'status amountDueUsd')
      .lean()
    res.json({
      sessions: rows.map((r) => ({
        id: String(r._id),
        businessDate: r.businessDate,
        department: r.department,
        procedureDescription: r.procedureDescription || '',
        sessionFeeUsd: r.sessionFeeUsd ?? 0,
        materialCostUsdTotal: r.materialCostUsdTotal ?? 0,
        materialChargeUsdTotal: r.materialChargeUsdTotal ?? 0,
        amountDueUsd: r.billingItemId?.amountDueUsd ?? r.sessionFeeUsd ?? 0,
        billingStatus: r.billingItemId?.status ?? 'pending_payment',
        providerName: r.providerUserId?.name || '—',
        notes: r.notes || '',
        materials: Array.isArray(r.materials) ? r.materials : [],
        createdAt: r.createdAt,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
