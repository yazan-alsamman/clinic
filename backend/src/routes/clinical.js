import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { InventoryItem } from '../models/InventoryItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { LaserSession } from '../models/LaserSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate, isValidYmd } from '../utils/date.js'
import { round2, round6 } from '../utils/money.js'
import { resolveSolariumPatientDisplayName } from '../services/solariumWalkInDisplay.js'
import { normalizeHm, slotIntervalMinutes } from '../utils/scheduleTime.js'
import { wallMinutesAsiaDamascus } from '../utils/shiftTime.js'

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
]
const RECEPTION_CREATE_ROLES = ['super_admin', 'reception']
/** تعديل جلسة (وصف / مواد): استقبال أو المقدّم أو المدير */
const SESSION_EDIT_ROLES = ['super_admin', 'reception', 'laser', 'dermatology', 'dental_branch']
/** عرض جلسات المريض */
const PATIENT_SESSION_VIEW_ROLES = [...CLINICAL_ROLES, 'reception']

function parsePositiveSypInteger(raw) {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseNonNegativeSypInteger(raw) {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function parsePositiveUsd(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseNonNegativeUsd(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function parseDiscountPercent(raw) {
  if (raw == null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100) / 100
}

function userRoleForSessionDepartment(dept) {
  const m = {
    laser: 'laser',
    dermatology: 'dermatology',
    dental: 'dental_branch',
  }
  return m[dept] || null
}

async function assertActiveProviderForDepartment(providerUserId, department) {
  const u = await User.findById(providerUserId).lean()
  if (!u || !u.active) throw new Error('المقدّم غير موجود أو غير نشط')
  if (department === 'skin') {
    if (u.role === 'reception' || u.role === 'super_admin') return
    throw new Error('جلسة بشرة: يجب أن يكون المقدّم من الاستقبال أو مدير النظام')
  }
  const needRole = userRoleForSessionDepartment(department)
  if (!needRole) throw new Error('قسم غير صالح')
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

async function formatSessionMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) return []
  const ids = [
    ...new Set(
      materials
        .map((m) => String(m.inventoryItemId || ''))
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ]
  const invRows = ids.length
    ? await InventoryItem.find({ _id: { $in: ids } }).select('unit sku name').lean()
    : []
  const byId = new Map(invRows.map((i) => [String(i._id), i]))
  return materials.map((m) => {
    const inv = m.inventoryItemId ? byId.get(String(m.inventoryItemId)) : null
    const qty = Number(m.quantity) || 0
    return {
      inventoryItemId: m.inventoryItemId ? String(m.inventoryItemId) : '',
      sku: String(m.sku || inv?.sku || '').trim(),
      name: String(m.name || inv?.name || '').trim() || '—',
      quantity: qty,
      unit: String(m.unit || inv?.unit || 'وحدة').trim() || 'وحدة',
      unitCostSyp: Math.round(Number(m.unitCostSyp) || 0),
      lineCostSyp: Math.round(Number(m.lineCostSyp) || 0),
      chargedUnitPriceSyp: Math.round(Number(m.chargedUnitPriceSyp) || 0),
      lineChargeSyp: Math.round(Number(m.lineChargeSyp) || 0),
    }
  })
}

function mergeSessionNotes(clinicalNotes, laserNotes) {
  const parts = [String(clinicalNotes || '').trim(), String(laserNotes || '').trim()].filter(Boolean)
  return [...new Set(parts)].join(' — ')
}

async function sessionToPatientRow(r, laserNotesById = null) {
  const listAmountDueSyp = Math.round(Number(r.billingItemId?.listAmountDueSyp || r.billingItemId?.amountDueSyp || r.sessionFeeSyp || 0))
  const discountPercent = Number(r.billingItemId?.discountPercent) || 0
  const effectiveAmountDueSyp = Math.round(
    Number(r.billingItemId?.effectiveAmountDueSyp || r.billingItemId?.amountDueSyp || r.sessionFeeSyp || 0),
  )
  let notes = String(r.notes || '').trim()
  if (r.laserSessionId && laserNotesById) {
    const ln = laserNotesById.get(String(r.laserSessionId)) || ''
    notes = mergeSessionNotes(notes, ln)
  }
  return {
    id: String(r._id),
    businessDate: r.businessDate,
    department: r.department,
    procedureDescription: r.procedureDescription || '',
    sessionFeeSyp: r.sessionFeeSyp ?? 0,
    materialCostSypTotal: r.materialCostSypTotal ?? 0,
    materialChargeSypTotal: r.materialChargeSypTotal ?? 0,
    amountDueSyp: effectiveAmountDueSyp,
    listAmountDueSyp,
    discountPercent,
    effectiveAmountDueSyp,
    billingStatus: r.billingItemId?.status ?? 'pending_payment',
    isPackagePrepaid: r.billingItemId?.isPackagePrepaid === true,
    providerName: r.providerUserId?.name || '—',
    providerUserId: r.providerUserId?._id ? String(r.providerUserId._id) : String(r.providerUserId || ''),
    notes,
    materials: await formatSessionMaterials(r.materials),
    createdAt: r.createdAt,
    createdByReceptionUserId: r.createdByReceptionUserId ? String(r.createdByReceptionUserId) : null,
  }
}

async function mapSessionsToPatientRows(rows) {
  const list = rows || []
  const laserIds = [
    ...new Set(
      list
        .map((r) => r.laserSessionId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  const laserNotesById = new Map()
  if (laserIds.length > 0) {
    const lasers = await LaserSession.find({ _id: { $in: laserIds } })
      .select('notes')
      .lean()
    for (const l of lasers) {
      laserNotesById.set(String(l._id), String(l.notes || '').trim())
    }
  }
  return Promise.all(list.map((r) => sessionToPatientRow(r, laserNotesById)))
}

/**
 * خصم المواد مع إرجاع الكميات عند الفشل
 * @param {Array<{ inventoryItemId: string, quantity: number }>} rawLines
 */
async function consumeMaterials(rawLines, opts = {}) {
  const applied = []
  const snapshot = []
  const usdSypRate = Number(opts.usdSypRate)
  const rateOk = Number.isFinite(usdSypRate) && usdSypRate > 0
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
      const costSypStored = Math.round(Number(item.unitCost) || 0)
      const costUsd = Number(item.unitCostUsd) || 0
      let unitCostSyp = costSypStored
      if (unitCostSyp <= 0 && costUsd > 0) {
        if (!rateOk) {
          throw new Error(
            `المادة «${item.name}» مسعّرة بالدولار فقط — لا يوجد سعر صرف دولار لليوم. اطلب إدخال سعر الصرف أولاً.`,
          )
        }
        unitCostSyp = Math.round(costUsd * usdSypRate)
      }
      snapshot.push({
        inventoryItemId: item._id,
        sku: item.sku,
        name: item.name,
        unit: String(item.unit || 'وحدة').trim() || 'وحدة',
        quantity: qty,
        unitCostSyp,
        lineCostSyp: Math.round(unitCostSyp * qty),
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
    if (department === 'skin') {
      const users = await User.find({ role: { $in: ['reception', 'super_admin'] }, active: true })
        .select('name')
        .sort({ name: 1 })
        .lean()
      res.json({
        providers: users.map((u) => ({ id: String(u._id), name: u.name || '—' })),
      })
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

      const sessionFeeSyp = parseNonNegativeSypInteger(body.sessionFeeSyp)
      if (sessionFeeSyp == null) {
        res.status(400).json({ error: 'أدخل مبلغ التحصيل بالليرة (رقم صفر أو أكبر)' })
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
          listAmountDueSyp: amountDueSyp,
          discountPercent: 0,
          effectiveAmountDueSyp: amountDueSyp,
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

      let providerUserId = req.user._id
      let scheduleSlotIdToSave
      const scheduleSlotIdRaw = String(body.scheduleSlotId || '').trim()
      if (scheduleSlotIdRaw && mongoose.isValidObjectId(scheduleSlotIdRaw)) {
        if (department !== 'dermatology') {
          res.status(400).json({ error: 'ربط الموعد مسموح فقط لجلسات الجلدية' })
          return
        }
        const slot = await ScheduleSlot.findById(scheduleSlotIdRaw).lean()
        if (!slot || !slot.patientId || String(slot.patientId) !== String(patient._id)) {
          res.status(400).json({ error: 'الموعد غير موجود أو لا يخص هذا المريض' })
          return
        }
        const st = String(slot.serviceType || '').trim().toLowerCase()
        if (st !== 'dermatology') {
          res.status(400).json({ error: 'الموعد المحدد ليس موعد جلدية' })
          return
        }
        if (!slot.assignedSpecialistUserId) {
          res.status(400).json({ error: 'لا يوجد طبيب مُعرَّف لهذا الموعد — راجع ربط لوحة الجلدية' })
          return
        }
        const conflict = await ClinicalSession.findOne({ scheduleSlotId: slot._id }).lean()
        if (conflict) {
          res.status(409).json({ error: 'يوجد جلسة مرتبطة بهذا الموعد بالفعل' })
          return
        }
        scheduleSlotIdToSave = slot._id
        providerUserId = slot.assignedSpecialistUserId
      }

      let sessionFeeSyp = parseNonNegativeSypInteger(body.sessionFeeSyp)
      let sessionFeeUsd = 0
      let billingCurrency = 'SYP'
      const feeCurrency = String(body.feeCurrency || 'SYP').trim().toUpperCase()
      if (department === 'dermatology' && feeCurrency === 'USD') {
        const feeUsd = parseNonNegativeUsd(body.sessionFeeUsd)
        if (feeUsd == null) {
          res.status(400).json({ error: 'أدخل سعر الجلسة بالدولار (رقم صفر أو أكبر)' })
          return
        }
        const rate = Number(req.businessDay?.usdSypRate)
        if (feeUsd > 0 && (!Number.isFinite(rate) || rate <= 0)) {
          res.status(400).json({ error: 'لا يوجد سعر صرف لليوم. اطلب من المدير إدخال سعر الدولار أولاً.' })
          return
        }
        sessionFeeUsd = round6(feeUsd)
        sessionFeeSyp = feeUsd > 0 ? Math.round(feeUsd * rate) : 0
        billingCurrency = 'USD'
      }
      if (sessionFeeSyp == null) {
        res.status(400).json({ error: 'أدخل رسوم الجلسة بالليرة (رقم صفر أو أكبر)' })
        return
      }

      const procedureDescription = String(body.procedureDescription || '').trim().slice(0, 500)
      const notes = String(body.notes || '').trim().slice(0, 2000)
      const businessDate = String(body.businessDate || '').trim() || req.businessDate || todayBusinessDate()

      const materialsInput = Array.isArray(body.materials) ? body.materials : []
      let materialLines = []
      try {
        materialLines = await consumeMaterials(materialsInput, {
          usdSypRate: Number(req.businessDay?.usdSypRate),
        })
      } catch (invErr) {
        res.status(400).json({ error: String(invErr.message || invErr) })
        return
      }

      const materialCostSypTotal = Math.round(materialLines.reduce((s, m) => s + (m.lineCostSyp || 0), 0))
      const materialChargeSypTotal =
        department === 'dermatology'
          ? 0
          : Math.round(materialLines.reduce((s, m) => s + (m.lineChargeSyp || 0), 0))
      const listAmountDueSyp = sessionFeeSyp + materialChargeSypTotal
      const listAmountDueUsd =
        billingCurrency === 'USD' ? round6(sessionFeeUsd) : 0
      const discountPercent = department === 'dermatology' ? parseDiscountPercent(body.discountPercent) : 0
      if (discountPercent == null) {
        await restoreMaterialsFromSnapshot(materialLines)
        res.status(400).json({ error: 'نسبة الخصم يجب أن تكون بين 0 و 100.' })
        return
      }
      const amountDueSyp = Math.round(listAmountDueSyp * (1 - discountPercent / 100))
      const amountDueUsd =
        billingCurrency === 'USD' ? round6(listAmountDueUsd * (1 - discountPercent / 100)) : 0
      if (amountDueSyp < 0) {
        await restoreMaterialsFromSnapshot(materialLines)
        res.status(400).json({ error: 'المستحق بعد الخصم غير صالح.' })
        return
      }
      if (billingCurrency === 'USD' && amountDueUsd < 0) {
        await restoreMaterialsFromSnapshot(materialLines)
        res.status(400).json({ error: 'المستحق بعد الخصم بالدولار غير صالح.' })
        return
      }

      let cs = null
      try {
        cs = await ClinicalSession.create({
          patientId: patient._id,
          providerUserId,
          department,
          procedureDescription,
          sessionFeeSyp,
          ...(billingCurrency === 'USD'
            ? { sessionFeeUsd, feeCurrency: 'USD' }
            : { feeCurrency: 'SYP' }),
          businessDate,
          notes,
          materials: materialLines,
          materialCostSypTotal,
          materialChargeSypTotal,
          ...(scheduleSlotIdToSave ? { scheduleSlotId: scheduleSlotIdToSave } : {}),
        })

        const bi = await BillingItem.create({
          clinicalSessionId: cs._id,
          patientId: patient._id,
          providerUserId,
          department,
          procedureLabel: procedureDescription || 'إجراء',
          listAmountDueSyp,
          discountPercent,
          effectiveAmountDueSyp: amountDueSyp,
          amountDueSyp,
          listAmountDueUsd,
          effectiveAmountDueUsd: amountDueUsd,
          amountDueUsd,
          currency: billingCurrency,
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

const DAY_OVERVIEW_DEPARTMENTS = ['laser', 'dental', 'dermatology', 'skin', 'solarium']

const DEPARTMENT_LABEL_AR = {
  laser: 'ليزر',
  dental: 'أسنان',
  dermatology: 'جلدية',
  skin: 'بشرة',
  solarium: 'سولاريوم',
}

function formatDurationMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'
  const m = Math.round(minutes)
  if (m < 1) return 'أقل من دقيقة'
  if (m === 1) return '1 دقيقة'
  return `${m} دقيقة`
}

function bookedSlotDurationMinutes(slot) {
  if (!slot) return null
  const iv = slotIntervalMinutes(slot)
  if (!iv) return null
  return iv.end - iv.start
}

function departmentToServiceType(dept) {
  const map = {
    laser: 'laser',
    solarium: 'solarium',
    skin: 'skin',
    dental: 'dental',
    dermatology: 'dermatology',
  }
  return map[String(dept || '')] || null
}

/** استخراج 6 أو 12 من وصف جلسة سولاريوم مثل: سولاريوم — 12 دقيقة — الاسم */
function parseSolariumMinutesFromProcedure(proc) {
  const m = String(proc || '').match(/—\s*(\d+)\s*دقيقة/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function findBestSlotForClinical(clinicalRow, patientSlots) {
  if (!patientSlots?.length) return null
  if (patientSlots.length === 1) return patientSlots[0]
  const clinicalMinutes = wallMinutesAsiaDamascus(clinicalRow.createdAt)
  if (clinicalMinutes == null) return patientSlots[0]
  let best = patientSlots[0]
  let bestDiff = Infinity
  for (const slot of patientSlots) {
    const iv = slotIntervalMinutes(slot)
    if (!iv) continue
    const diff = Math.abs(iv.start - clinicalMinutes)
    if (diff < bestDiff) {
      bestDiff = diff
      best = slot
    }
  }
  return best
}

function resolveBookedScheduleSlot(clinicalRow, slotsById, slotsByLaserId, slotsByPatientService) {
  if (clinicalRow.scheduleSlotId) {
    const slot = slotsById.get(String(clinicalRow.scheduleSlotId))
    if (slot) return slot
  }
  if (clinicalRow.laserSessionId) {
    const slot = slotsByLaserId.get(String(clinicalRow.laserSessionId))
    if (slot) return slot
  }
  const serviceType = departmentToServiceType(clinicalRow.department)
  const pid = clinicalRow.patientId?._id
    ? String(clinicalRow.patientId._id)
    : clinicalRow.patientId
      ? String(clinicalRow.patientId)
      : ''
  if (serviceType && pid) {
    return findBestSlotForClinical(clinicalRow, slotsByPatientService.get(`${pid}|${serviceType}`) || [])
  }
  return null
}

function resolveBookedDurationMinutes(clinicalRow, slotsById, slotsByLaserId, slotsByPatientService) {
  const slot = resolveBookedScheduleSlot(clinicalRow, slotsById, slotsByLaserId, slotsByPatientService)
  const fromSlot = bookedSlotDurationMinutes(slot)
  if (fromSlot != null) return fromSlot
  if (clinicalRow.department === 'solarium') {
    const parsed = parseSolariumMinutesFromProcedure(clinicalRow.procedureDescription)
    if (parsed != null) return parsed
  }
  return null
}

/** وقت بداية الموعد المحجوز HH:mm → مثل 9:30 ص */
function formatBookedHmLabel(hm) {
  const n = normalizeHm(hm)
  if (!n) return null
  const [h24, min] = n.split(':').map((x) => parseInt(x, 10))
  if (!Number.isFinite(h24) || !Number.isFinite(min)) return null
  const period = h24 < 12 ? 'ص' : 'م'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  return `${h12}:${String(min).padStart(2, '0')} ${period}`
}

function formatSessionTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('ar-SY', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Damascus',
  })
}

function resolveSessionTimeLabel(clinicalRow, slotsById, slotsByLaserId, slotsByPatientService) {
  const slot = resolveBookedScheduleSlot(clinicalRow, slotsById, slotsByLaserId, slotsByPatientService)
  const fromSlot = formatBookedHmLabel(slot?.time)
  if (fromSlot) return fromSlot
  return formatSessionTime(clinicalRow.createdAt)
}

/** ملخص جلسات يوم عمل واحد — جميع الأقسام (لمدير النظام فقط) */
clinicalRouter.get('/sessions/day-overview', requireRoles('super_admin'), async (req, res) => {
  try {
    const qDate = String(req.query.date || '').trim()
    const businessDate = isValidYmd(qDate) ? qDate : req.businessDate || todayBusinessDate()
    const rows = await ClinicalSession.find({
      businessDate,
      department: { $in: DAY_OVERVIEW_DEPARTMENTS },
    })
      .sort({ createdAt: 1 })
      .populate('patientId', 'name')
      .populate('providerUserId', 'name')
      .lean()

    const laserSessionIds = [...new Set(rows.map((r) => r.laserSessionId).filter(Boolean).map(String))]
    const scheduleSlotIds = [...new Set(rows.map((r) => r.scheduleSlotId).filter(Boolean).map(String))]
    const patientIds = [
      ...new Set(
        rows
          .map((r) => (r.patientId?._id ? String(r.patientId._id) : r.patientId ? String(r.patientId) : ''))
          .filter(Boolean),
      ),
    ]

    const slotQueryOr = []
    if (laserSessionIds.length) slotQueryOr.push({ laserSessionId: { $in: laserSessionIds } })
    if (scheduleSlotIds.length) slotQueryOr.push({ _id: { $in: scheduleSlotIds } })
    if (patientIds.length) {
      slotQueryOr.push({
        patientId: { $in: patientIds },
        serviceType: { $in: ['laser', 'solarium', 'skin', 'dental', 'dermatology'] },
      })
    }

    const [lasers, scheduleSlots] = await Promise.all([
      laserSessionIds.length
        ? LaserSession.find({ _id: { $in: laserSessionIds } })
            .select('notes')
            .lean()
        : [],
      slotQueryOr.length
        ? ScheduleSlot.find({ businessDate, $or: slotQueryOr })
            .select('time endTime laserSessionId patientId serviceType')
            .lean()
        : [],
    ])

    const laserById = new Map(lasers.map((l) => [String(l._id), l]))
    const slotsById = new Map(scheduleSlots.map((s) => [String(s._id), s]))
    const slotsByLaserId = new Map(
      scheduleSlots.filter((s) => s.laserSessionId).map((s) => [String(s.laserSessionId), s]),
    )
    const slotsByPatientService = new Map()
    for (const s of scheduleSlots) {
      const pid = s.patientId ? String(s.patientId) : ''
      const st = String(s.serviceType || '')
      if (!pid || !st) continue
      const key = `${pid}|${st}`
      if (!slotsByPatientService.has(key)) slotsByPatientService.set(key, [])
      slotsByPatientService.get(key).push(s)
    }

    const sessions = rows.map((r) => {
      const laser = r.laserSessionId ? laserById.get(String(r.laserSessionId)) : null
      const durationMinutes = resolveBookedDurationMinutes(r, slotsById, slotsByLaserId, slotsByPatientService)
      const cn = String(r.notes || '').trim()
      const ln = laser ? String(laser.notes || '').trim() : ''
      const notesCombined = [cn, ln].filter(Boolean).join(' — ') || '—'
      const proc = String(r.procedureDescription || '').trim()
      const patientName =
        r.department === 'solarium'
          ? resolveSolariumPatientDisplayName(r.patientId, proc)
          : r.patientId?.name || '—'
      return {
        id: String(r._id),
        sessionType: DEPARTMENT_LABEL_AR[r.department] || String(r.department || '—'),
        patientName,
        providerName: r.providerUserId?.name || '—',
        timeLabel: resolveSessionTimeLabel(r, slotsById, slotsByLaserId, slotsByPatientService),
        durationLabel: durationMinutes != null ? formatDurationMinutes(durationMinutes) : '—',
        notes: notesCombined,
      }
    })

    res.json({ businessDate, sessions })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

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
        patientName:
          r.department === 'solarium'
            ? resolveSolariumPatientDisplayName(r.patientId, r.procedureDescription)
            : (r.patientId?.name ?? ''),
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
      .populate('billingItemId', 'status amountDueSyp listAmountDueSyp discountPercent effectiveAmountDueSyp isPackagePrepaid')
      .lean()
    res.json({
      sessions: await mapSessionsToPatientRows(rows),
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
      .populate('billingItemId', 'status amountDueSyp listAmountDueSyp discountPercent effectiveAmountDueSyp isPackagePrepaid')
      .lean()
    if (!r) {
      res.status(404).json({ error: 'الجلسة غير موجودة' })
      return
    }
    if (!canEditClinicalSession(req.user, r)) {
      res.status(403).json({ error: 'لا صلاحية لعرض هذه الجلسة' })
      return
    }
    res.json({ session: await sessionToPatientRow(r) })
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
        newLines = await consumeMaterials(appendInput, {
          usdSypRate: Number(req.businessDay?.usdSypRate),
        })
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
          .populate('billingItemId', 'status amountDueSyp listAmountDueSyp discountPercent effectiveAmountDueSyp isPackagePrepaid')
          .lean()

        res.json({ session: await sessionToPatientRow(populated) })
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
