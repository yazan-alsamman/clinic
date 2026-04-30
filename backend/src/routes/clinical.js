import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { InventoryItem } from '../models/InventoryItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'
import { round2 } from '../utils/money.js'

export const clinicalRouter = Router()

clinicalRouter.use(authMiddleware, loadBusinessDay)

/** أقسام الجلسة السريرية + الفوترة */
const SESSION_DEPARTMENTS = ['laser', 'dermatology', 'dental', 'solarium', 'skin']
const PATIENT_DEPARTMENT_ENUM = SESSION_DEPARTMENTS
const CLINICAL_ROLES = [
  'super_admin',
  'laser',
  'dermatology',
  'dermatology_manager',
  'dermatology_assistant_manager',
  'dental_branch',
  'solarium',
  'skin_specialist',
]
const RECEPTION_CREATE_ROLES = ['super_admin', 'reception']
/** تعديل جلسة (وصف / مواد): استقبال أو المقدّم أو المدير */
const SESSION_EDIT_ROLES = ['super_admin', 'reception', 'laser', 'dermatology', 'dental_branch', 'solarium', 'skin_specialist']
/** عرض جلسات المريض */
const PATIENT_SESSION_VIEW_ROLES = [...CLINICAL_ROLES, 'reception']

function parsePositiveSypInteger(raw) {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

function userRoleForSessionDepartment(dept) {
  const m = {
    laser: 'laser',
    dermatology: 'dermatology',
    dental: 'dental_branch',
    solarium: 'solarium',
    skin: 'skin_specialist',
  }
  return m[dept] || null
}

async function assertActiveProviderForDepartment(providerUserId, department) {
  const needRole = userRoleForSessionDepartment(department)
  if (!needRole) throw new Error('قسم غير صالح')
  const u = await User.findById(providerUserId).lean()
  if (!u || !u.active) throw new Error('المقدّم غير موجود أو غير نشط')
  if (u.role !== needRole) throw new Error('المستخدم المختار لا يطابق دور القسم المطلوب')
}

function departmentFromRequest(req) {
  const role = req.user.role
  if (role === 'super_admin') {
    const d = String(req.body?.department || '').trim()
    if (SESSION_DEPARTMENTS.includes(d)) return d
    return null
  }
  if (role === 'laser') return 'laser'
  if (
    role === 'dermatology' ||
    role === 'dermatology_manager' ||
    role === 'dermatology_assistant_manager'
  ) {
    return 'dermatology'
  }
  if (role === 'dental_branch') return 'dental'
  if (role === 'solarium') return 'solarium'
  if (role === 'skin_specialist') return 'skin'
  return null
}

function canEditClinicalSession(user, sessionLean) {
  if (!user || !sessionLean) return false
  if (user.role === 'super_admin' || user.role === 'reception') return true
  return String(sessionLean.providerUserId) === String(user._id)
}

function defaultProcedurePlaceholder(department) {
  const m = {
    laser: 'ليزر — بانتظار التفاصيل',
    dermatology: 'جلدية — بانتظار التفاصيل',
    dental: 'أسنان — بانتظار التفاصيل',
    solarium: 'سولاريوم — بانتظار التفاصيل',
    skin: 'بشرة — بانتظار التفاصيل',
  }
  return m[department] || 'جلسة — بانتظار التفاصيل'
}

function sessionToPatientRow(r) {
  return {
    id: String(r._id),
    businessDate: r.businessDate,
    department: r.department,
    procedureDescription: r.procedureDescription || '',
    sessionFeeSyp: r.sessionFeeSyp ?? 0,
    materialCostSypTotal: r.materialCostSypTotal ?? 0,
    materialChargeSypTotal: r.materialChargeSypTotal ?? 0,
    amountDueSyp: r.billingItemId?.amountDueSyp ?? r.sessionFeeSyp ?? 0,
    billingStatus: r.billingItemId?.status ?? 'pending_payment',
    isPackagePrepaid: r.billingItemId?.isPackagePrepaid === true,
    providerName: r.providerUserId?.name || '—',
    providerUserId: r.providerUserId?._id ? String(r.providerUserId._id) : String(r.providerUserId || ''),
    notes: r.notes || '',
    materials: Array.isArray(r.materials) ? r.materials : [],
    createdAt: r.createdAt,
    createdByReceptionUserId: r.createdByReceptionUserId ? String(r.createdByReceptionUserId) : null,
  }
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
        unitCostSyp: unitCost,
        lineCostSyp: Math.round(unitCost * qty),
        chargedUnitPriceSyp: 0,
        lineChargeSyp: 0,
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

/** قائمة مقدّمي الخدمة حسب القسم — للاستقبال */
clinicalRouter.get('/provider-options', requireRoles(...RECEPTION_CREATE_ROLES), async (req, res) => {
  try {
    const department = String(req.query.department || '').trim()
    if (!SESSION_DEPARTMENTS.includes(department)) {
      res.status(400).json({ error: 'قسم غير صالح' })
      return
    }
    const role = userRoleForSessionDepartment(department)
    const users = await User.find({ role, active: true }).select('name').sort({ name: 1 }).lean()
    res.json({
      providers: users.map((u) => ({ id: String(u._id), name: u.name || '—' })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** إنشاء جلسة + بند تحصيل من الاستقبال: مبلغ + قسم + مقدّم فقط */
clinicalRouter.post(
  '/sessions/reception',
  requireActiveDay,
  requireRoles(...RECEPTION_CREATE_ROLES),
  async (req, res) => {
    try {
      const body = req.body ?? {}
      const department = String(body.department || '').trim()
      if (!SESSION_DEPARTMENTS.includes(department)) {
        res.status(400).json({ error: 'القسم غير صالح' })
        return
      }
      const patientId = body.patientId
      if (!mongoose.isValidObjectId(patientId)) {
        res.status(400).json({ error: 'معرّف المريض غير صالح' })
        return
      }
      const providerUserId = body.providerUserId
      if (!mongoose.isValidObjectId(providerUserId)) {
        res.status(400).json({ error: 'معرّف المقدّم غير صالح' })
        return
      }
      try {
        await assertActiveProviderForDepartment(providerUserId, department)
      } catch (pe) {
        res.status(400).json({ error: String(pe.message || pe) })
        return
      }

      const patient = await Patient.findById(patientId)
      if (!patient) {
        res.status(404).json({ error: 'المريض غير موجود' })
        return
      }

      const sessionFeeSyp = parsePositiveSypInteger(body.sessionFeeSyp)
      if (sessionFeeSyp == null) {
        res.status(400).json({ error: 'أدخل مبلغ التحصيل بالليرة (قيمة أكبر من صفر)' })
        return
      }

      const rawProc = String(body.procedureDescription || '').trim().slice(0, 500)
      const procedureDescription = rawProc || defaultProcedurePlaceholder(department)
      const notes = String(body.notes || '').trim().slice(0, 2000)
      const businessDate = String(body.businessDate || '').trim() || req.businessDate || todayBusinessDate()

      const materialLines = []
      const materialCostSypTotal = 0
      const materialChargeSypTotal = 0
      const amountDueSyp = sessionFeeSyp + materialChargeSypTotal

      let cs = null
      try {
        cs = await ClinicalSession.create({
          patientId: patient._id,
          providerUserId,
          department,
          procedureDescription,
          sessionFeeSyp,
          businessDate,
          notes,
          materials: materialLines,
          materialCostSypTotal,
          materialChargeSypTotal,
          createdByReceptionUserId: req.user._id,
        })

        const bi = await BillingItem.create({
          clinicalSessionId: cs._id,
          patientId: patient._id,
          providerUserId,
          department,
          procedureLabel: procedureDescription,
          amountDueSyp,
          currency: 'SYP',
          businessDate,
          status: 'pending_payment',
        })

        cs.billingItemId = bi._id
        await cs.save()
        const prevDeps = Array.isArray(patient.departments) ? patient.departments : []
        const cleaned = prevDeps.filter((d) => PATIENT_DEPARTMENT_ENUM.includes(d))
        patient.departments = [...new Set([...cleaned, department])]
        patient.lastVisit = new Date()
        await patient.save()

        await writeAudit({
          user: req.user,
          action: 'استقبال: إنشاء جلسة وبند تحصيل (بدون تفاصيل طبية)',
          entityType: 'ClinicalSession',
          entityId: cs._id,
          details: {
            billingItemId: String(bi._id),
            amountDueSyp,
            department,
            providerUserId: String(providerUserId),
          },
        })

        res.status(201).json({
          clinicalSession: {
            id: String(cs._id),
            patientId: String(cs.patientId),
            department: cs.department,
            procedureDescription: cs.procedureDescription,
            sessionFeeSyp: cs.sessionFeeSyp,
            businessDate: cs.businessDate,
            materialCostSypTotal: cs.materialCostSypTotal,
            materialChargeSypTotal: cs.materialChargeSypTotal,
            materials: cs.materials,
            providerUserId: String(providerUserId),
            createdByReceptionUserId: String(req.user._id),
          },
          billingItem: {
            id: String(bi._id),
            status: bi.status,
            amountDueSyp: bi.amountDueSyp,
            procedureLabel: bi.procedureLabel,
          },
        })
      } catch (inner) {
        if (cs?._id) {
          await BillingItem.deleteMany({ clinicalSessionId: cs._id })
          await ClinicalSession.findByIdAndDelete(cs._id)
        }
        console.error(inner)
        if (inner && inner.code === 11000) {
          res.status(409).json({
            error:
              'تعارض في قاعدة البيانات (مفتاح مكرر). إن استمرّ الخطأ بعد التحديث، أبلغ المدير لإعادة بناء فهارس الجلسات.',
          })
          return
        }
        res.status(500).json({ error: 'تعذر إنشاء الجلسة أو بند الفوترة' })
      }
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

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

      const sessionFeeSyp = parsePositiveSypInteger(body.sessionFeeSyp)
      if (sessionFeeSyp == null) {
        res.status(400).json({ error: 'أدخل رسوم الجلسة بالليرة (قيمة أكبر من صفر)' })
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

      const materialCostSypTotal = Math.round(materialLines.reduce((s, m) => s + (m.lineCostSyp || 0), 0))
      const materialChargeSypTotal =
        department === 'dermatology'
          ? 0
          : Math.round(materialLines.reduce((s, m) => s + (m.lineChargeSyp || 0), 0))
      const amountDueSyp = sessionFeeSyp + materialChargeSypTotal

      let cs = null
      try {
        cs = await ClinicalSession.create({
          patientId: patient._id,
          providerUserId: req.user._id,
          department,
          procedureDescription,
          sessionFeeSyp,
          businessDate,
          notes,
          materials: materialLines,
          materialCostSypTotal,
          materialChargeSypTotal,
        })

        const bi = await BillingItem.create({
          clinicalSessionId: cs._id,
          patientId: patient._id,
          providerUserId: req.user._id,
          department,
          procedureLabel: procedureDescription || 'إجراء',
          amountDueSyp,
          currency: 'SYP',
          businessDate,
          status: 'pending_payment',
        })

        cs.billingItemId = bi._id
        await cs.save()
        const prevDeps = Array.isArray(patient.departments) ? patient.departments : []
        const cleaned = prevDeps.filter((d) => PATIENT_DEPARTMENT_ENUM.includes(d))
        patient.departments = [...new Set([...cleaned, department])]
        patient.lastVisit = new Date()
        await patient.save()

        await writeAudit({
          user: req.user,
          action: 'تسجيل جلسة سريرية وبند فوترة معلّق',
          entityType: 'ClinicalSession',
          entityId: cs._id,
          details: { billingItemId: String(bi._id), amountDueSyp, materialChargeSypTotal },
        })

        res.status(201).json({
          clinicalSession: {
            id: String(cs._id),
            patientId: String(cs.patientId),
            department: cs.department,
            procedureDescription: cs.procedureDescription,
            sessionFeeSyp: cs.sessionFeeSyp,
            businessDate: cs.businessDate,
            materialCostSypTotal: cs.materialCostSypTotal,
            materialChargeSypTotal: cs.materialChargeSypTotal,
            materials: cs.materials,
          },
          billingItem: {
            id: String(bi._id),
            status: bi.status,
            amountDueSyp: bi.amountDueSyp,
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
        if (inner && inner.code === 11000) {
          res.status(409).json({
            error:
              'تعارض في قاعدة البيانات (مفتاح مكرر). إن استمرّ الخطأ بعد التحديث، أبلغ المدير لإعادة بناء فهارس الجلسات.',
          })
          return
        }
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
        sessionFeeSyp: r.sessionFeeSyp,
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

clinicalRouter.get('/sessions/patient/:patientId', requireRoles(...PATIENT_SESSION_VIEW_ROLES), async (req, res) => {
  try {
    const patientId = String(req.params.patientId || '').trim()
    if (!mongoose.isValidObjectId(patientId)) {
      res.status(400).json({ error: 'معرّف المريض غير صالح' })
      return
    }
    const q = { patientId }
    if (req.user.role !== 'super_admin' && req.user.role !== 'reception') {
      q.providerUserId = req.user._id
    }
    const rows = await ClinicalSession.find(q)
      .sort({ createdAt: -1 })
      .limit(120)
      .populate('providerUserId', 'name')
      .populate('billingItemId', 'status amountDueSyp isPackagePrepaid')
      .lean()
    res.json({
      sessions: rows.map((r) => sessionToPatientRow(r)),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تفاصيل جلسة واحدة (للتعديل) */
clinicalRouter.get('/sessions/:sessionId', requireRoles(...SESSION_EDIT_ROLES), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim()
    if (!mongoose.isValidObjectId(sessionId)) {
      res.status(400).json({ error: 'معرّف الجلسة غير صالح' })
      return
    }
    const r = await ClinicalSession.findById(sessionId)
      .populate('providerUserId', 'name')
      .populate('billingItemId', 'status amountDueSyp isPackagePrepaid')
      .lean()
    if (!r) {
      res.status(404).json({ error: 'الجلسة غير موجودة' })
      return
    }
    if (!canEditClinicalSession(req.user, r)) {
      res.status(403).json({ error: 'لا صلاحية لعرض هذه الجلسة' })
      return
    }
    res.json({ session: sessionToPatientRow(r) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تكميل الوصف الطبي وإضافة مواد (خصم مخزون) — لا يغيّر مبلغ التحصيل */
clinicalRouter.patch(
  '/sessions/:sessionId',
  requireActiveDay,
  requireRoles(...SESSION_EDIT_ROLES),
  async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId || '').trim()
      if (!mongoose.isValidObjectId(sessionId)) {
        res.status(400).json({ error: 'معرّف الجلسة غير صالح' })
        return
      }
      const cs = await ClinicalSession.findById(sessionId)
      if (!cs) {
        res.status(404).json({ error: 'الجلسة غير موجودة' })
        return
      }
      if (!canEditClinicalSession(req.user, cs)) {
        res.status(403).json({ error: 'لا صلاحية لتعديل هذه الجلسة' })
        return
      }

      const body = req.body ?? {}
      const appendInput = Array.isArray(body.appendMaterials) ? body.appendMaterials : []
      let newLines = []
      try {
        newLines = await consumeMaterials(appendInput)
      } catch (invErr) {
        res.status(400).json({ error: String(invErr.message || invErr) })
        return
      }

      const addCost = Math.round(newLines.reduce((s, m) => s + (m.lineCostSyp || 0), 0))

      if (body.procedureDescription != null) {
        const next = String(body.procedureDescription).trim().slice(0, 500)
        if (next) cs.procedureDescription = next
      }
      if (body.notes != null) {
        cs.notes = String(body.notes).trim().slice(0, 2000)
      }

      if (newLines.length) {
        cs.materials = [...(cs.materials || []), ...newLines]
        cs.materialCostSypTotal = Math.round(Number(cs.materialCostSypTotal || 0) + addCost)
      }

      try {
        await cs.save()

        const bi = cs.billingItemId ? await BillingItem.findById(cs.billingItemId) : null
        if (bi) {
          if (body.procedureDescription != null) {
            const lbl = String(body.procedureDescription).trim().slice(0, 200)
            if (lbl) bi.procedureLabel = lbl
          }
          await bi.save()
        }

        await writeAudit({
          user: req.user,
          action: 'تعديل جلسة سريرية (وصف / مواد)',
          entityType: 'ClinicalSession',
          entityId: cs._id,
          details: {
            appendedMaterials: newLines.length,
            addCostSyp: addCost,
          },
        })

        const populated = await ClinicalSession.findById(cs._id)
          .populate('providerUserId', 'name')
          .populate('billingItemId', 'status amountDueSyp isPackagePrepaid')
          .lean()

        res.json({ session: sessionToPatientRow(populated) })
      } catch (saveErr) {
        await restoreMaterialsFromSnapshot(newLines)
        console.error(saveErr)
        res.status(500).json({ error: 'تعذر حفظ التعديل — أُعيدت كميات المخزون' })
      }
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)
