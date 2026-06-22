import { Router } from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { Patient } from '../models/Patient.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { LaserSession } from '../models/LaserSession.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { LaserPackageTemplate } from '../models/LaserPackageTemplate.js'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { authMiddleware, requireActiveDay } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { patientToDto } from '../utils/dto.js'
import { writeAudit } from '../utils/audit.js'
import { todayBusinessDate } from '../utils/date.js'
import { completeBillingItemPayment } from '../services/billingPaymentCompletion.js'
import { getClinicalBundleForPatientId } from '../services/patientClinicalBundle.js'
import { getLaserBookingContextForPatient } from '../services/laserPackageBooking.js'
import { provisionPortalCredentials, randomPasswordPlain } from '../utils/patientPortalCredentials.js'
import { buildAdminOpenFinancialLines, buildLedgerEntriesFromBilling } from '../services/openFinancialBalanceLines.js'
import { buildDepartmentAllocationsForSettlement } from '../services/patientDebtSettlementAllocation.js'
import { PatientDebtSettlement } from '../models/PatientDebtSettlement.js'
import { resolvePaymentChannelFromBody } from '../services/paymentChannelSettings.js'

const CLINICAL_ROLES = [
  'super_admin',
  'reception',
  'laser',
  'dermatology',
  'dermatology_manager',
  'dermatology_assistant_manager',
  'dental_branch',
]

const FIN_BALANCE_FILTER_DEPTS = ['laser', 'dermatology', 'dental']

/** إنشاء ملف مريض جديد — استقبال، مدير النظام، مدير قسم الجلدية */
const PATIENT_CREATE_ROLES = ['super_admin', 'reception', 'dermatology_manager']

function parseFinancialBalanceDept(raw) {
  const v = String(raw || '').trim()
  return FIN_BALANCE_FILTER_DEPTS.includes(v) ? v : null
}

function canReadPatients(role) {
  return CLINICAL_ROLES.includes(role)
}

function canListPatients(role) {
  return role !== 'laser' && canReadPatients(role)
}

function normalizePaperLaserEntries(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => ({
      therapist: String(x?.therapist || '').trim().slice(0, 120),
      sessionDate: String(x?.sessionDate || '').trim().slice(0, 20),
      area: String(x?.area || '').trim().slice(0, 300),
      laserType: String(x?.laserType || '').trim().slice(0, 80),
      pw: String(x?.pw || '').trim().slice(0, 80),
      pulse: String(x?.pulse || '').trim().slice(0, 80),
      shots: String(x?.shots || '').trim().slice(0, 80),
      notes: String(x?.notes || '').trim().slice(0, 500),
    }))
    .filter((r) => r.therapist || r.sessionDate || r.area || r.laserType || r.pw || r.pulse || r.shots || r.notes)
    .slice(0, 300)
}

/** مبلغ ليرة صحيح موجب */
function parsePositiveSypInteger(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function parseNonNegativeSypInteger(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function normalizeYesNo(raw) {
  const v = String(raw || '').trim()
  return v === 'yes' || v === 'no' ? v : ''
}

function normalizePregnancyStatus(raw) {
  const v = String(raw || '').trim()
  return ['pregnant', 'not_pregnant', 'planning_pregnancy', ''].includes(v) ? v : ''
}

function normalizeLactationStatus(raw) {
  const v = String(raw || '').trim()
  return ['lactating', 'not_lactating', ''].includes(v) ? v : ''
}

function normalizeGender(raw) {
  const v = String(raw || '').trim()
  return v === 'male' || v === 'female' ? v : ''
}

function normalizeString(raw, maxLen = 4000) {
  return String(raw ?? '')
    .trim()
    .slice(0, maxLen)
}

function normalizePatientProfilePayload(body) {
  const gender = normalizeGender(body.gender)
  const marital = normalizeString(body.marital, 120)
  const isFemaleMarried =
    gender === 'female' && (marital === 'متزوجة' || marital === 'متزوج')
  const payload = {
    name: normalizeString(body.name, 220) || 'مريض جديد',
    dob: normalizeString(body.dob, 40),
    marital,
    occupation: normalizeString(body.occupation, 220),
    medicalHistory: normalizeString(body.medicalHistory, 4000),
    surgicalHistory: normalizeString(body.surgicalHistory, 4000),
    allergies: normalizeString(body.allergies, 4000),
    drugHistory: normalizeString(body.drugHistory, 4000),
    phone: normalizeString(body.phone, 80),
    gender,
    previousTreatments: normalizeYesNo(body.previousTreatments),
    recentDermTreatments: normalizeYesNo(body.recentDermTreatments),
    isotretinoinHistory: normalizeYesNo(body.isotretinoinHistory),
    pregnancyStatus: '',
    lactationStatus: '',
  }
  if (isFemaleMarried) {
    payload.pregnancyStatus = normalizePregnancyStatus(body.pregnancyStatus)
    payload.lactationStatus = normalizeLactationStatus(body.lactationStatus)
  }
  return payload
}

async function nextSequentialFileNumber() {
  const top = await Patient.aggregate([
    { $match: { fileNumber: { $regex: '^[0-9]+$' } } },
    { $addFields: { fileNumberNum: { $toLong: '$fileNumber' } } },
    { $sort: { fileNumberNum: -1 } },
    { $limit: 1 },
    { $project: { fileNumberNum: 1 } },
  ])
  const maxNum = Number(top?.[0]?.fileNumberNum || 0)
  return String(maxNum + 1)
}

function canManagePackages(role) {
  return role === 'super_admin' || role === 'reception'
}

/** هل طلب الباكج يتضمن تحصيلاً نقدياً فعلياً (مبلغ مستلم > 0)؟ */
function hasPackagePaymentCollection(body) {
  const payCurrency = String(body?.payCurrency || 'SYP').trim().toUpperCase()
  if (payCurrency === 'USD') {
    const usd = Number(body?.amountUsd)
    return Number.isFinite(usd) && usd > 0
  }
  if (payCurrency === 'MIXED') {
    const syp = Number(body?.amountSyp)
    const usd = Number(body?.amountUsd)
    return (Number.isFinite(syp) && syp > 0) || (Number.isFinite(usd) && usd > 0)
  }
  const syp = Number(body?.amountSyp)
  return Number.isFinite(syp) && syp > 0
}

/** جلسة باكج مُستهلكة أو مربوطة بعلاج/تحصيل */
function packageSessionWasUsed(sess) {
  if (!sess) return false
  if (sess.completedByReception === true) return true
  if (sess.linkedLaserSessionId) return true
  if (sess.linkedBillingItemId) return true
  if (sess.areasAdjustedOnly === true) return true
  if (Math.max(0, Math.trunc(Number(sess.packagePartialAreasAcknowledgedByReception) || 0)) > 0) return true
  return false
}

function packageHasAnyUsedSession(pkg) {
  return (Array.isArray(pkg?.sessions) ? pkg.sessions : []).some(packageSessionWasUsed)
}

/** تسمية جلسات الباكج (ليزر / سولاريوم) للعرض في الملف */
function packageSessionLabelAr(zeroBasedIndex) {
  const n = zeroBasedIndex + 1
  const ord = [
    '',
    'الأولى',
    'الثانية',
    'الثالثة',
    'الرابعة',
    'الخامسة',
    'السادسة',
    'السابعة',
    'الثامنة',
    'التاسعة',
    'العاشرة',
  ]
  if (n >= 1 && n <= 10) return `الجلسة ${ord[n]}`
  return `الجلسة ${n.toLocaleString('ar-SY')}`
}

/** دمج قالب أو أكثر لباكج ليزر واحد (مناطق + أسعار قائمة) */
async function resolveLaserPackageTemplatesFromBody(body) {
  const rawIds = Array.isArray(body?.laserPackageTemplateIds)
    ? body.laserPackageTemplateIds
    : body?.laserPackageTemplateId
      ? [body.laserPackageTemplateId]
      : []
  const tplIds = [
    ...new Set(
      rawIds
        .map((x) => String(x || '').trim())
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ]
  if (!tplIds.length) {
    const err = new Error('يجب اختيار قالب باكج ليزر واحد على الأقل من القائمة المعرفة في النظام')
    err.status = 400
    throw err
  }
  const tplRows = await LaserPackageTemplate.find({ _id: { $in: tplIds } }).lean()
  const byId = new Map(tplRows.map((t) => [String(t._id), t]))
  if (byId.size !== tplIds.length) {
    const err = new Error('أحد قوالب الباكج غير موجود')
    err.status = 400
    throw err
  }
  const ordered = tplIds.map((id) => byId.get(id)).filter(Boolean)
  const inactive = ordered.find((t) => t.active === false)
  if (inactive) {
    const err = new Error(`قالب الباكج موقوف: ${String(inactive.name || '').trim() || '—'}`)
    err.status = 400
    throw err
  }

  const procedureOptionIdsSnap = []
  const seenOption = new Set()
  let areaCountSnap = 0
  let listPriceSum = 0
  const names = []
  for (const tpl of ordered) {
    const nm = String(tpl.name || '').trim()
    if (nm) names.push(nm)
    listPriceSum += Math.max(0, Math.round(Number(tpl.listPriceSyp) || 0))
    const tplAreas = Math.max(
      1,
      Math.trunc(Number(tpl.areaCount) || 0),
      Array.isArray(tpl.procedureOptionIds) ? tpl.procedureOptionIds.length : 0,
    )
    areaCountSnap += tplAreas
    for (const oid of Array.isArray(tpl.procedureOptionIds) ? tpl.procedureOptionIds : []) {
      const s = String(oid || '').trim()
      if (s && !seenOption.has(s)) {
        seenOption.add(s)
        procedureOptionIdsSnap.push(s)
      }
    }
  }
  areaCountSnap = Math.max(areaCountSnap, procedureOptionIdsSnap.length, 1)

  return {
    laserPackageTemplateIds: tplIds,
    laserPackageTemplateId: tplIds[0],
    procedureOptionIdsSnap,
    areaCountSnap,
    defaultTitle: names.join(' + '),
    listPriceSum,
  }
}

function serializePackage(pkg) {
  return {
    id: String(pkg?._id || ''),
    department: String(pkg?.department || 'laser'),
    title: String(pkg?.title || ''),
    sessionsCount: Number(pkg?.sessionsCount) || 0,
    packageTotalSyp: Number(pkg?.packageTotalSyp) || 0,
    paidAmountSyp: Number(pkg?.paidAmountSyp) || 0,
    settlementDeltaSyp: Number(pkg?.settlementDeltaSyp) || 0,
    notes: String(pkg?.notes || ''),
    createdAt: pkg?.createdAt ? new Date(pkg.createdAt).toISOString() : null,
    sessions: Array.isArray(pkg?.sessions)
      ? pkg.sessions.map((s) => ({
          id: String(s?._id || ''),
          label: String(s?.label || ''),
          completedByReception: s?.completedByReception === true,
          completedAt: s?.completedAt ? new Date(s.completedAt).toISOString() : null,
          completedByUserId: s?.completedByUserId ? String(s.completedByUserId) : null,
          linkedLaserSessionId: s?.linkedLaserSessionId ? String(s.linkedLaserSessionId) : null,
          linkedBillingItemId: s?.linkedBillingItemId ? String(s.linkedBillingItemId) : null,
          packagePartialAreasAcknowledgedByReception: Math.max(
            0,
            Math.trunc(Number(s?.packagePartialAreasAcknowledgedByReception) || 0),
          ),
          areasAdjustedOnly: s?.areasAdjustedOnly === true,
          receptionNote: String(s?.receptionNote || ''),
        }))
      : [],
    laserPackageTemplateId: String(pkg?.laserPackageTemplateId || ''),
    laserPackageTemplateIds: Array.isArray(pkg?.laserPackageTemplateIds)
      ? pkg.laserPackageTemplateIds.map(String).filter(Boolean)
      : pkg?.laserPackageTemplateId
        ? [String(pkg.laserPackageTemplateId)]
        : [],
    procedureOptionIds: Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds.map(String) : [],
    areaCount: Number(pkg?.areaCount) || 0,
    suspended: pkg?.suspended === true,
  }
}

export const patientsRouter = Router()

patientsRouter.use(authMiddleware, loadBusinessDay)

patientsRouter.get('/', async (req, res) => {
  try {
    if (!canListPatients(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const q = String(req.query.q || '').trim()
    let query = {}
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query = { $or: [{ name: new RegExp(safe, 'i') }, { fileNumber: new RegExp(safe, 'i') }] }
    }
    /** مع استعلام بحث `q` يُطبَّق الترقيم دائماً (افتراضي ١٠ لكل صفحة) لتجنّب إرجاع مئات المطابقين دفعة واحدة */
    const wantPagination =
      req.query.page != null || req.query.pageSize != null || q.length > 0
    if (!wantPagination) {
      const list = await Patient.find(query).sort({ updatedAt: -1 }).limit(200)
      res.json({ patients: list.map(patientToDto) })
      return
    }
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1)
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize), 10) || 10))
    const skip = (page - 1) * pageSize
    const [total, list] = await Promise.all([
      Patient.countDocuments(query),
      Patient.find(query).sort({ updatedAt: -1 }).skip(skip).limit(pageSize).lean(),
    ])
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
    res.json({
      patients: list.map(patientToDto),
      total,
      page,
      pageSize,
      totalPages,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** ذمم ورصيد إضافي — لوحة المدير: أسطر مفتوحة حسب بند التحصيل/القسم (يجب أن يسبق مسار /:id) */
patientsRouter.get('/financial-balances', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const debtDept = parseFinancialBalanceDept(req.query.debtDepartment)
    const creditDept = parseFinancialBalanceDept(req.query.creditDepartment)
    const select = 'fileNumber name outstandingDebtSyp prepaidCreditSyp sessionPackages'
    const [debtPatients, creditPatients] = await Promise.all([
      Patient.find({ outstandingDebtSyp: { $gt: 0 } })
        .select(select)
        .sort({ outstandingDebtSyp: -1, name: 1 })
        .limit(5000)
        .lean(),
      Patient.find({ prepaidCreditSyp: { $gt: 0 } })
        .select(select)
        .sort({ prepaidCreditSyp: -1, name: 1 })
        .limit(5000)
        .lean(),
    ])
    const [debtLinesRaw, creditLinesRaw] = await Promise.all([
      buildAdminOpenFinancialLines(debtPatients, 'debt'),
      buildAdminOpenFinancialLines(creditPatients, 'credit'),
    ])
    const debtLines = debtLinesRaw.filter((row) => {
      if (!debtDept) return true
      return row.department === debtDept
    })
    const creditLines = creditLinesRaw.filter((row) => {
      if (!creditDept) return true
      return row.department === creditDept
    })
    res.json({
      debtLines,
      creditLines,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** الرقم التالي لإضبارة جديدة — أكبر قيمة رقمية محضة بين أرقام الإضبارات الحالية + ١ */
patientsRouter.get('/next-file-number', async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const nextFileNumber = await nextSequentialFileNumber()
    res.json({ nextFileNumber })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** سياق حجز ليزر للاستقبال — باكج فعّال، جلسة جزئية، مناطق متبقية */
patientsRouter.get('/:id/laser-booking-context', async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id).select('sessionPackages').lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const ctx = await getLaserBookingContextForPatient(p)
    res.json(ctx)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** جلسات ليزر + معاينات جلدية + مواعيد محجوزة لهذا المريض */
patientsRouter.get('/:id/clinical-history', async (req, res) => {
  try {
    if (!canReadPatients(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id).lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const pid = p._id
    const role = req.user.role
    const myName = String(req.user.name || '').trim()
    const fullAccess = role === 'super_admin' || role === 'reception'

    const needLaser = fullAccess || role === 'laser'
    const needDerm =
      fullAccess ||
      role === 'dermatology' ||
      role === 'dermatology_manager' ||
      role === 'dermatology_assistant_manager'
    const needAppts =
      fullAccess ||
      role === 'dermatology' ||
      role === 'dermatology_manager' ||
      role === 'dermatology_assistant_manager' ||
      role === 'dental_branch'
    const needDentalPlan = fullAccess || role === 'dental_branch'

    const bundle = await getClinicalBundleForPatientId(pid)

    let laserSessions = bundle.laserSessions
    if (!needLaser) laserSessions = []

    let dermatologyVisits = bundle.dermatologyVisits
    if (!needDerm) dermatologyVisits = []
    else if (role === 'dermatology' && myName) {
      dermatologyVisits = dermatologyVisits.filter(
        (v) => String(v.providerName || '').trim() === myName,
      )
    }

    let appointments = bundle.appointments
    if (!needAppts) appointments = []
    else if (
      (role === 'dermatology' || role === 'dental_branch') &&
      myName
    ) {
      appointments = appointments.filter((o) => String(o.providerName || '').trim() === myName)
    }

    let dentalPlan = bundle.dentalPlan
    if (!needDentalPlan) dentalPlan = null

    res.json({
      laserSessions,
      dermatologyVisits,
      appointments,
      dentalPlan,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

function portalAccountPayload(p) {
  return {
    hasPortal: !!(p.portalUsername && p.portalPasswordHash),
    username: p.portalUsername || '',
    portalEnabled: p.portalEnabled !== false,
    mustChangePassword: p.portalMustChangePassword === true,
    lastLoginAt: p.portalLastLoginAt ? p.portalLastLoginAt.toISOString() : null,
  }
}

patientsRouter.get('/:id/portal-account', async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    res.json({ account: portalAccountPayload(p) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.post('/:id/portal/provision', requireActiveDay, async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    if (p.portalUsername && p.portalPasswordHash) {
      res.status(400).json({ error: 'يوجد حساب بوابة مُفعّل مسبقاً لهذا الملف' })
      return
    }
    const { username, plainPassword } = await provisionPortalCredentials(p)
    await writeAudit({
      user: req.user,
      action: 'تفعيل حساب بوابة مريض',
      entityType: 'Patient',
      entityId: p._id,
      details: { portalUsername: username },
    })
    res.status(201).json({
      account: portalAccountPayload(p),
      portalCredentials: { username, password: plainPassword },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.post('/:id/portal/regenerate-password', requireActiveDay, async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    if (!p.portalUsername || !p.portalPasswordHash) {
      res.status(400).json({ error: 'لا يوجد حساب بوابة — أنشئ الحساب أولاً' })
      return
    }
    const plain = randomPasswordPlain()
    const nextHash = await bcrypt.hash(plain, 10)
    p.portalPasswordHash = nextHash
    p.portalMustChangePassword = true
    await Patient.updateOne(
      { _id: p._id },
      {
        $set: {
          portalPasswordHash: nextHash,
          portalMustChangePassword: true,
        },
      },
    )
    await writeAudit({
      user: req.user,
      action: 'إعادة إنشاء كلمة مرور بوابة مريض',
      entityType: 'Patient',
      entityId: p._id,
    })
    res.json({
      username: p.portalUsername,
      password: plain,
      account: portalAccountPayload(p),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.get('/:id/financial-ledger', async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id).lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }

    const items = await BillingItem.find({ patientId: p._id })
      .select('_id amountDueSyp effectiveAmountDueSyp businessDate procedureLabel')
      .lean()
    const itemIds = items.map((x) => x._id)
    if (itemIds.length === 0) {
      res.json({
        summary: {
          outstandingDebtSyp: Number(p.outstandingDebtSyp) || 0,
          prepaidCreditSyp: Number(p.prepaidCreditSyp) || 0,
        },
        entries: [],
      })
      return
    }

    const payments = await BillingPayment.find({ billingItemId: { $in: itemIds } })
      .sort({ receivedAt: -1, createdAt: -1 })
      .populate('receivedBy', 'name')
      .lean()

    const entries = buildLedgerEntriesFromBilling(items, payments).map((entry, i) => {
      const pay = payments[i]
      return {
        ...entry,
        method: pay.method,
        paymentChannel: pay.paymentChannel === 'bank' ? 'bank' : 'cash',
        bankName: pay.bankName ? String(pay.bankName) : undefined,
        receivedAt: pay.receivedAt ? new Date(pay.receivedAt).toISOString() : null,
        receivedByName: String(pay.receivedBy?.name || '').trim(),
      }
    })

    res.json({
      summary: {
        outstandingDebtSyp: Number(p.outstandingDebtSyp) || 0,
        prepaidCreditSyp: Number(p.prepaidCreditSyp) || 0,
      },
      entries,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تفاصيل الجلسة المرتبطة ببند تحصيل — للمدير (صفحة الذمم المالية) */
patientsRouter.get('/:id/financial-billing-detail/:billingItemId', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const pid = req.params.id
    const bid = req.params.billingItemId
    if (!mongoose.isValidObjectId(pid) || !mongoose.isValidObjectId(bid)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const bi = await BillingItem.findOne({
      _id: new mongoose.Types.ObjectId(bid),
      patientId: new mongoose.Types.ObjectId(pid),
    }).lean()
    if (!bi) {
      res.status(404).json({ error: 'البند غير موجود' })
      return
    }
    const cs = bi.clinicalSessionId
      ? await ClinicalSession.findById(bi.clinicalSessionId).populate('providerUserId', 'name').lean()
      : null
    let laser = null
    if (cs?.laserSessionId) {
      laser = await LaserSession.findById(cs.laserSessionId).populate('operatorUserId', 'name').lean()
    }
    if (!laser) {
      laser = await LaserSession.findOne({ billingItemId: bi._id }).populate('operatorUserId', 'name').lean()
    }
    res.json({
      billingItem: {
        id: String(bi._id),
        department: bi.department,
        procedureLabel: String(bi.procedureLabel || ''),
        amountDueSyp: Number(bi.amountDueSyp) || 0,
        businessDate: String(bi.businessDate || ''),
        status: bi.status,
        paidAt: bi.paidAt ? new Date(bi.paidAt).toISOString() : null,
      },
      clinicalSession: cs
        ? {
            id: String(cs._id),
            procedureDescription: String(cs.procedureDescription || ''),
            sessionFeeSyp: Number(cs.sessionFeeSyp) || 0,
            businessDate: String(cs.businessDate || ''),
            notes: String(cs.notes || ''),
            materialCostSypTotal: Number(cs.materialCostSypTotal) || 0,
            materialChargeSypTotal: Number(cs.materialChargeSypTotal) || 0,
            materials: Array.isArray(cs.materials) ? cs.materials : [],
            providerName: String(cs.providerUserId?.name || '').trim(),
            isPackageSession: cs.isPackageSession === true,
          }
        : null,
      laserSession: laser
        ? {
            id: String(laser._id),
            laserType: laser.laserType,
            pw: String(laser.pw || ''),
            pulse: String(laser.pulse || ''),
            shotCount: String(laser.shotCount || ''),
            chargeByPulseCount: laser.chargeByPulseCount === true,
            notes: String(laser.notes || ''),
            areaIds: Array.isArray(laser.areaIds) ? laser.areaIds : [],
            manualAreaLabels: Array.isArray(laser.manualAreaLabels) ? laser.manualAreaLabels : [],
            room: String(laser.room || ''),
            sessionTypeLabel: String(laser.sessionTypeLabel || ''),
            discountPercent: Number(laser.discountPercent) || 0,
            costSyp: Number(laser.costSyp) || 0,
            status: laser.status,
            operatorName: String(laser.operatorUserId?.name || '').trim(),
            treatmentNumber: laser.treatmentNumber,
            laserCoverApplied: laser.laserCoverApplied === true,
            laserCoverSyp: Math.max(0, Math.round(Number(laser.laserCoverSyp) || 0)),
          }
        : null,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تفاصيل باكج جلسات (ليزر) — للمدير (صفحة الذمم المالية) */
patientsRouter.get('/:id/financial-package-detail/:packageId', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const pid = req.params.id
    const packageId = req.params.packageId
    if (!mongoose.isValidObjectId(pid) || !mongoose.isValidObjectId(packageId)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const p = await Patient.findById(pid).select('sessionPackages').lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const rows = Array.isArray(p.sessionPackages) ? p.sessionPackages : []
    const pkg = rows.find((x) => String(x?._id) === String(packageId))
    if (!pkg) {
      res.status(404).json({ error: 'الباكج غير موجود' })
      return
    }
    res.json({ package: serializePackage(pkg) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.post('/:id/financial-settlement', requireActiveDay, async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id).lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const enteredSyp = parsePositiveSypInteger(req.body?.amountSyp)
    if (enteredSyp == null) {
      res.status(400).json({ error: 'أدخل مبلغاً بالليرة أكبر من الصفر' })
      return
    }
    let paymentChannel = 'cash'
    let bankName = ''
    try {
      ;({ paymentChannel, bankName } = await resolvePaymentChannelFromBody(req.body))
    } catch (chErr) {
      res.status(400).json({ error: String(chErr?.message || chErr) })
      return
    }

    const debtBefore = Math.round(Number(p.outstandingDebtSyp) || 0)
    const creditBefore = Math.round(Number(p.prepaidCreditSyp) || 0)
    const appliedToDebtSyp = Math.min(debtBefore, enteredSyp)
    const extraToCreditSyp = enteredSyp - appliedToDebtSyp
    const debtAfter = debtBefore - appliedToDebtSyp
    const creditAfter = creditBefore + extraToCreditSyp

    await Patient.updateOne(
      { _id: p._id },
      {
        $set: {
          outstandingDebtSyp: debtAfter,
          prepaidCreditSyp: creditAfter,
        },
      },
    )

    const businessDate = todayBusinessDate()
    const receivedAt = new Date()
    const departmentAllocations = await buildDepartmentAllocationsForSettlement(p._id, appliedToDebtSyp)
    const debtSettlement = await PatientDebtSettlement.create({
      patientId: p._id,
      businessDate,
      enteredSyp,
      appliedToDebtSyp,
      extraToCreditSyp,
      debtBefore,
      debtAfter,
      paymentChannel,
      bankName,
      receivedBy: req.user._id,
      receivedAt,
      departmentAllocations,
    })

    const outcome =
      debtBefore <= 0
        ? 'credit_only'
        : enteredSyp < debtBefore
          ? 'partial'
          : enteredSyp === debtBefore
            ? 'exact'
            : 'overpay'

    await writeAudit({
      user: req.user,
      action: 'تسوية مالية يدوية لمريض',
      entityType: 'Patient',
      entityId: p._id,
      details: {
        enteredSyp,
        debtBefore,
        debtAfter,
        creditBefore,
        creditAfter,
        appliedToDebtSyp,
        extraToCreditSyp,
        outcome,
        departmentAllocations,
      },
    })

    res.status(201).json({
      settlement: {
        id: String(debtSettlement._id),
        enteredSyp,
        debtBefore,
        debtAfter,
        creditBefore,
        creditAfter,
        appliedToDebtSyp,
        extraToCreditSyp,
        outcome,
        businessDate,
        departmentAllocations: departmentAllocations.map((a) => ({
          department: a.department,
          amountSyp: a.amountSyp,
          procedureLabel: a.procedureLabel || '',
        })),
      },
      summary: {
        outstandingDebtSyp: debtAfter,
        prepaidCreditSyp: creditAfter,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/**
 * تصفية الحقل المخزّن على المريض فقط: outstandingDebtSyp أو prepaidCreditSyp (لا يعدّل بنود الفوترة).
 * للمدير فقط — يُستخدم لتصحيح أرشفة الذمم/الرصيد الظاهر في صفحة الذمم.
 */
patientsRouter.post('/:id/financial-clear-balance', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const patientId = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(patientId)) {
      res.status(400).json({ error: 'معرّف المريض غير صالح' })
      return
    }
    const kind = String(req.body?.kind || '').trim()
    if (kind !== 'debt' && kind !== 'credit') {
      res.status(400).json({ error: 'حدد النوع: debt أو credit' })
      return
    }
    const p = await Patient.findById(patientId).lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const debtBefore = Math.round(Number(p.outstandingDebtSyp) || 0)
    const creditBefore = Math.round(Number(p.prepaidCreditSyp) || 0)

    let debtAfter = debtBefore
    let creditAfter = creditBefore
    if (kind === 'debt') {
      debtAfter = 0
    } else {
      creditAfter = 0
    }

    await Patient.updateOne(
      { _id: p._id },
      {
        $set: {
          outstandingDebtSyp: debtAfter,
          prepaidCreditSyp: creditAfter,
        },
      },
    )

    await writeAudit({
      user: req.user,
      action: kind === 'debt' ? 'تصفية ذمة مخزّنة لمريض (مدير)' : 'تصفية رصيد إضافي مخزّن لمريض (مدير)',
      entityType: 'Patient',
      entityId: p._id,
      details: {
        kind,
        debtBefore,
        debtAfter,
        creditBefore,
        creditAfter,
        fileNumber: String(p.fileNumber || ''),
        name: String(p.name || ''),
      },
    })

    res.json({
      summary: {
        outstandingDebtSyp: debtAfter,
        prepaidCreditSyp: creditAfter,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.get('/:id/packages', async (req, res) => {
  try {
    if (!canReadPatients(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id).select('sessionPackages').lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const rows = Array.isArray(p.sessionPackages) ? p.sessionPackages.map(serializePackage) : []
    res.json({ packages: rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.post('/:id/packages', requireActiveDay, async (req, res) => {
  try {
    if (!canManagePackages(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id).lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const department = String(req.body?.department || 'laser').trim() || 'laser'
    const sessionsCount = Math.max(1, Math.min(200, Number.parseInt(String(req.body?.sessionsCount || '0'), 10) || 0))
    if (!sessionsCount) {
      res.status(400).json({ error: 'عدد الجلسات غير صالح' })
      return
    }

    if (department === 'solarium') {
      let packageTotalSyp = parsePositiveSypInteger(req.body?.packageTotalSyp)
      let paidAmountSyp = parseNonNegativeSypInteger(
        req.body?.paidAmountSyp ?? req.body?.collectedAmountSyp ?? req.body?.amountSyp,
      )
      if (packageTotalSyp == null) {
        const legacyCollected = parsePositiveSypInteger(
          req.body?.collectedAmountSyp ?? req.body?.paidAmountSyp ?? req.body?.amountSyp,
        )
        if (legacyCollected != null) {
          packageTotalSyp = legacyCollected
          if (paidAmountSyp == null) paidAmountSyp = legacyCollected
        }
      }
      if (packageTotalSyp == null) {
        res.status(400).json({ error: 'أدخل إجمالي سعر الباكج بالليرة' })
        return
      }
      if (paidAmountSyp == null) {
        res.status(400).json({ error: 'مبلغ المدفوع غير صالح' })
        return
      }

      const debtBefore = Math.round(Number(p.outstandingDebtSyp) || 0)
      const creditBefore = Math.round(Number(p.prepaidCreditSyp) || 0)
      const settlementDeltaSyp = paidAmountSyp - packageTotalSyp
      const debtAfter = debtBefore + Math.max(0, packageTotalSyp - paidAmountSyp)
      const creditAfter = creditBefore + Math.max(0, paidAmountSyp - packageTotalSyp)

      const title =
        String(req.body?.title || '').trim().slice(0, 160) || `باكج سولاريوم (${sessionsCount} جلسة)`
      const notes = String(req.body?.notes || '').trim().slice(0, 1200)
      const businessDate = String(req.body?.businessDate || '').trim() || req.businessDate || todayBusinessDate()
      const patientName = String(p.name || '').trim()
      const packageId = new mongoose.Types.ObjectId()
      const sessions = Array.from({ length: sessionsCount }, (_, idx) => ({
        _id: new mongoose.Types.ObjectId(),
        label: packageSessionLabelAr(idx),
        completedByReception: false,
        completedAt: null,
        completedByUserId: null,
        linkedLaserSessionId: null,
        linkedBillingItemId: null,
      }))
      const packageDoc = {
        _id: packageId,
        department: 'solarium',
        title,
        sessionsCount,
        packageTotalSyp,
        paidAmountSyp,
        settlementDeltaSyp,
        notes,
        createdByUserId: req.user._id,
        sessions,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      let cs = null
      let bi = null
      let billingPaid = false
      let payResult = null
      try {
        if (paidAmountSyp > 0 && hasPackagePaymentCollection(req.body)) {
          const procedureDescription = `سولاريوم — باكج مسبق الدفع (${sessionsCount} جلسة)${patientName ? ` — ${patientName}` : ''}`
          cs = await ClinicalSession.create({
            patientId: p._id,
            providerUserId: req.user._id,
            department: 'solarium',
            procedureDescription,
            sessionFeeSyp: paidAmountSyp,
            businessDate,
            notes: notes ? notes.slice(0, 500) : '',
            materials: [],
            materialCostSypTotal: 0,
            materialChargeSypTotal: 0,
            createdByReceptionUserId: req.user._id,
          })

          bi = await BillingItem.create({
            clinicalSessionId: cs._id,
            patientId: p._id,
            providerUserId: req.user._id,
            department: 'solarium',
            procedureLabel: procedureDescription,
            listAmountDueSyp: paidAmountSyp,
            discountPercent: 0,
            effectiveAmountDueSyp: paidAmountSyp,
            amountDueSyp: paidAmountSyp,
            currency: 'SYP',
            businessDate,
            status: 'pending_payment',
          })
          cs.billingItemId = bi._id
          await cs.save()

          try {
            payResult = await completeBillingItemPayment(bi, req.body, req.user, {
              skipPatientDebtUpdate: true,
            })
          } catch (payErr) {
            res.status(400).json({ error: String(payErr?.message || payErr) })
            return
          }
          billingPaid = true
        }

        await Patient.updateOne(
          { _id: p._id },
          {
            $push: { sessionPackages: packageDoc },
            $set: {
              outstandingDebtSyp: debtAfter,
              prepaidCreditSyp: creditAfter,
            },
            $addToSet: { departments: 'solarium' },
          },
        )

        const freshDebtCredit = await Patient.findById(p._id).select('outstandingDebtSyp prepaidCreditSyp').lean()

        await writeAudit({
          user: req.user,
          action: paidAmountSyp > 0 ? 'إنشاء باكج سولاريوم وتحصيل' : 'إنشاء باكج سولاريوم',
          entityType: 'Patient',
          entityId: p._id,
          details: {
            packageId: String(packageId),
            department: 'solarium',
            sessionsCount,
            packageTotalSyp,
            paidAmountSyp,
            settlementDeltaSyp,
            clinicalSessionId: cs?._id ? String(cs._id) : undefined,
            billingItemId: bi?._id ? String(bi._id) : undefined,
            paymentId: payResult?.paymentId,
          },
        })

        res.status(201).json({
          package: serializePackage(packageDoc),
          summary: {
            outstandingDebtSyp: Math.round(Number(freshDebtCredit?.outstandingDebtSyp) || 0),
            prepaidCreditSyp: Math.round(Number(freshDebtCredit?.prepaidCreditSyp) || 0),
          },
        })
      } catch (inner) {
        if (cs?._id && !billingPaid) {
          try {
            const biRows = await BillingItem.find({ clinicalSessionId: cs._id }).select('_id').lean()
            for (const row of biRows) {
              await BillingPayment.deleteMany({ billingItemId: row._id })
            }
            await BillingItem.deleteMany({ clinicalSessionId: cs._id })
            await ClinicalSession.findByIdAndDelete(cs._id)
          } catch (cleanErr) {
            console.error('solarium package rollback:', cleanErr)
          }
        } else if (cs?._id && billingPaid) {
          console.error('Solarium package: cash collected but patient package save failed', inner)
          try {
            await writeAudit({
              user: req.user,
              action: 'تحذير: تحصيل باكج سولاريوم دون حفظ الباكج في ملف المريض',
              entityType: 'Patient',
              entityId: p._id,
              details: { clinicalSessionId: String(cs._id), error: String(inner?.message || inner) },
            })
          } catch (auditErr) {
            console.error(auditErr)
          }
        }
        console.error(inner)
        const msg = String(inner?.message || inner)
        const clientMsg =
          msg.includes('البند') ||
          msg.includes('دفعة') ||
          msg.includes('ملف حساب') ||
          msg.includes('لا يوجد مبلغ') ||
          msg.includes('ParseError') ||
          msg.includes('تعبير')
        if (clientMsg) {
          res.status(400).json({ error: msg })
          return
        }
        res.status(500).json({ error: msg.trim() ? msg : 'تعذر إنشاء باكج السولاريوم أو التحصيل' })
      }
      return
    }

    if (department !== 'laser') {
      res.status(400).json({ error: 'نوع الباكج غير مدعوم' })
      return
    }

    const packageTotalSyp = parsePositiveSypInteger(req.body?.packageTotalSyp)
    if (packageTotalSyp == null) {
      res.status(400).json({ error: 'أدخل إجمالي سعر الباكج بالليرة' })
      return
    }
    const paidAmountSyp = parseNonNegativeSypInteger(req.body?.paidAmountSyp)
    if (paidAmountSyp == null) {
      res.status(400).json({ error: 'مبلغ المدفوع غير صالح' })
      return
    }

    const debtBefore = Math.round(Number(p.outstandingDebtSyp) || 0)
    const creditBefore = Math.round(Number(p.prepaidCreditSyp) || 0)
    const settlementDeltaSyp = paidAmountSyp - packageTotalSyp
    const debtAfter = debtBefore + Math.max(0, packageTotalSyp - paidAmountSyp)
    const creditAfter = creditBefore + Math.max(0, paidAmountSyp - packageTotalSyp)

    const packageId = new mongoose.Types.ObjectId()
    let laserTplResolved
    try {
      laserTplResolved = await resolveLaserPackageTemplatesFromBody(req.body)
    } catch (tplErr) {
      res.status(tplErr.status || 400).json({ error: String(tplErr.message || tplErr) })
      return
    }
    const {
      laserPackageTemplateIds,
      laserPackageTemplateId,
      procedureOptionIdsSnap,
      areaCountSnap,
      defaultTitle,
    } = laserTplResolved
    let title = String(req.body?.title || '').trim().slice(0, 160)
    if (!title) title = String(defaultTitle || '').trim().slice(0, 160)
    if (!title) title = `باكج ليزر (${sessionsCount} جلسة)`
    const notes = String(req.body?.notes || '').trim().slice(0, 1200)
    const sessions = Array.from({ length: sessionsCount }, (_, idx) => ({
      _id: new mongoose.Types.ObjectId(),
      label: packageSessionLabelAr(idx),
      completedByReception: false,
      completedAt: null,
      completedByUserId: null,
      linkedLaserSessionId: null,
      linkedBillingItemId: null,
      areasAdjustedOnly: false,
      receptionNote: '',
    }))
    const packageDoc = {
      _id: packageId,
      department: 'laser',
      laserPackageTemplateId,
      laserPackageTemplateIds,
      procedureOptionIds: procedureOptionIdsSnap,
      areaCount: areaCountSnap,
      suspended: false,
      title,
      sessionsCount,
      packageTotalSyp,
      paidAmountSyp,
      settlementDeltaSyp,
      notes,
      createdByUserId: req.user._id,
      sessions,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const businessDate = String(req.body?.businessDate || '').trim() || req.businessDate || todayBusinessDate()
    let purchaseCs = null
    let purchaseBi = null
    let billingPaid = false
    try {
      if (paidAmountSyp > 0 && hasPackagePaymentCollection(req.body)) {
        const patientName = String(p.name || '').trim()
        const procedureDescription = `ليزر — باكج مسبق الدفع (${sessionsCount} جلسة)${title ? ` — ${title}` : ''}${
          patientName ? ` — ${patientName}` : ''
        }`
        purchaseCs = await ClinicalSession.create({
          patientId: p._id,
          providerUserId: req.user._id,
          department: 'laser',
          procedureDescription: procedureDescription.slice(0, 500),
          sessionFeeSyp: paidAmountSyp,
          businessDate,
          notes: notes ? notes.slice(0, 500) : '',
          materials: [],
          materialCostSypTotal: 0,
          materialChargeSypTotal: 0,
          createdByReceptionUserId: req.user._id,
        })
        purchaseBi = await BillingItem.create({
          clinicalSessionId: purchaseCs._id,
          patientId: p._id,
          providerUserId: req.user._id,
          department: 'laser',
          procedureLabel: procedureDescription.slice(0, 200),
          listAmountDueSyp: paidAmountSyp,
          discountPercent: 0,
          effectiveAmountDueSyp: paidAmountSyp,
          amountDueSyp: paidAmountSyp,
          currency: 'SYP',
          businessDate,
          status: 'pending_payment',
        })
        purchaseCs.billingItemId = purchaseBi._id
        await purchaseCs.save()
        try {
          await completeBillingItemPayment(purchaseBi, req.body, req.user, {
            skipPatientDebtUpdate: true,
          })
        } catch (payErr) {
          res.status(400).json({ error: String(payErr?.message || payErr) })
          return
        }
        billingPaid = true
      }

      await Patient.updateOne(
        { _id: p._id },
        {
          $push: { sessionPackages: packageDoc },
          $set: {
            outstandingDebtSyp: debtAfter,
            prepaidCreditSyp: creditAfter,
          },
          $addToSet: { departments: 'laser' },
        },
      )

      const fresh = await Patient.findById(p._id).select('outstandingDebtSyp prepaidCreditSyp').lean()

      await writeAudit({
        user: req.user,
        action: 'إنشاء باكج جلسات لمريض',
        entityType: 'Patient',
        entityId: p._id,
        details: {
          packageId: String(packageId),
          department: 'laser',
          sessionsCount,
          packageTotalSyp,
          paidAmountSyp,
          settlementDeltaSyp,
          laserPackageTemplateId: laserPackageTemplateId || undefined,
          laserPackageTemplateIds: laserPackageTemplateIds.length ? laserPackageTemplateIds : undefined,
          purchaseClinicalSessionId: purchaseCs?._id ? String(purchaseCs._id) : undefined,
          purchaseBillingItemId: purchaseBi?._id ? String(purchaseBi._id) : undefined,
        },
      })

      res.status(201).json({
        package: serializePackage(packageDoc),
        summary: {
          outstandingDebtSyp: Math.round(Number(fresh?.outstandingDebtSyp) || 0),
          prepaidCreditSyp: Math.round(Number(fresh?.prepaidCreditSyp) || 0),
        },
      })
    } catch (inner) {
      if (purchaseCs?._id && !billingPaid) {
        try {
          const biRows = await BillingItem.find({ clinicalSessionId: purchaseCs._id }).select('_id').lean()
          for (const row of biRows) {
            await BillingPayment.deleteMany({ billingItemId: row._id })
          }
          await BillingItem.deleteMany({ clinicalSessionId: purchaseCs._id })
          await ClinicalSession.findByIdAndDelete(purchaseCs._id)
        } catch (cleanErr) {
          console.error('laser package purchase rollback:', cleanErr)
        }
      } else if (purchaseCs?._id && billingPaid) {
        console.error('Laser package: cash collected but patient package save failed', inner)
      }
      console.error(inner)
      const msg = String(inner?.message || inner)
      const clientMsg =
        msg.includes('البند') ||
        msg.includes('دفعة') ||
        msg.includes('ملف حساب') ||
        msg.includes('لا يوجد مبلغ') ||
        msg.includes('ParseError') ||
        msg.includes('تعبير')
      if (clientMsg) {
        res.status(400).json({ error: msg })
        return
      }
      res.status(500).json({ error: msg.trim() ? msg : 'تعذر إنشاء باكج الليزر' })
    }
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.patch('/:id/packages/:packageId', requireActiveDay, async (req, res) => {
  try {
    if (!canManagePackages(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const patientId = String(req.params.id || '').trim()
    const packageId = String(req.params.packageId || '').trim()
    if (!mongoose.isValidObjectId(patientId) || !mongoose.isValidObjectId(packageId)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const p = await Patient.findById(patientId)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const rows = Array.isArray(p.sessionPackages) ? p.sessionPackages : []
    const pkgIndex = rows.findIndex((x) => String(x?._id) === packageId)
    if (pkgIndex < 0) {
      res.status(404).json({ error: 'الباكج غير موجود' })
      return
    }
    if (String(rows[pkgIndex]?.department || '') !== 'laser') {
      res.status(400).json({ error: 'إيقاف الباكج يخص باكج الليزر فقط من هذا المسار' })
      return
    }
    const suspended = req.body?.suspended === true
    await Patient.updateOne(
      { _id: p._id },
      { $set: { [`sessionPackages.${pkgIndex}.suspended`]: suspended } },
    )
    const fresh = await Patient.findById(p._id).lean()
    const pkg = Array.isArray(fresh?.sessionPackages)
      ? fresh.sessionPackages.find((x) => String(x?._id) === packageId)
      : null
    await writeAudit({
      user: req.user,
      action: suspended ? 'إيقاف باكج ليزر لمريض' : 'تفعيل باكج ليزر لمريض',
      entityType: 'Patient',
      entityId: p._id,
      details: { packageId, suspended },
    })
    res.json({ package: pkg ? serializePackage(pkg) : null })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** حذف باكج لم يُستهلك منه أي جلسة — مدير النظام فقط */
patientsRouter.delete('/:id/packages/:packageId', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      res.status(403).json({ error: 'حذف الباكج متاح لمدير النظام فقط' })
      return
    }
    const patientId = String(req.params.id || '').trim()
    const packageId = String(req.params.packageId || '').trim()
    if (!mongoose.isValidObjectId(patientId) || !mongoose.isValidObjectId(packageId)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const p = await Patient.findById(patientId)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const rows = Array.isArray(p.sessionPackages) ? p.sessionPackages : []
    const pkg = rows.find((x) => String(x?._id) === packageId)
    if (!pkg) {
      res.status(404).json({ error: 'الباكج غير موجود' })
      return
    }
    if (packageHasAnyUsedSession(pkg)) {
      res.status(400).json({
        error:
          'لا يمكن حذف الباكج: وُجدت جلسة مُستهلكة أو مرتبطة بجلسة علاجية. أوقف الباكج مؤقتاً إن لزم.',
      })
      return
    }

    const packageTotalSyp = Math.max(0, Math.round(Number(pkg.packageTotalSyp) || 0))
    const paidAmountSyp = Math.max(0, Math.round(Number(pkg.paidAmountSyp) || 0))
    const debtNow = Math.round(Number(p.outstandingDebtSyp) || 0)
    const creditNow = Math.round(Number(p.prepaidCreditSyp) || 0)
    const newDebt = Math.max(0, debtNow - Math.max(0, packageTotalSyp - paidAmountSyp))
    const newCredit = Math.max(0, creditNow - Math.max(0, paidAmountSyp - packageTotalSyp))

    await Patient.updateOne(
      { _id: p._id },
      {
        $pull: { sessionPackages: { _id: pkg._id } },
        $set: {
          outstandingDebtSyp: newDebt,
          prepaidCreditSyp: newCredit,
        },
      },
    )

    const fresh = await Patient.findById(p._id).select('outstandingDebtSyp prepaidCreditSyp').lean()

    await writeAudit({
      user: req.user,
      action: 'حذف باكج جلسات لمريض',
      entityType: 'Patient',
      entityId: p._id,
      details: {
        packageId,
        department: String(pkg.department || ''),
        title: String(pkg.title || ''),
        packageTotalSyp,
        paidAmountSyp,
        debtAfter: Math.round(Number(fresh?.outstandingDebtSyp) || 0),
        creditAfter: Math.round(Number(fresh?.prepaidCreditSyp) || 0),
      },
    })

    res.json({
      ok: true,
      summary: {
        outstandingDebtSyp: Math.round(Number(fresh?.outstandingDebtSyp) || 0),
        prepaidCreditSyp: Math.round(Number(fresh?.prepaidCreditSyp) || 0),
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.patch('/:id/packages/:packageId/sessions/:sessionId', requireActiveDay, async (req, res) => {
  try {
    if (!canManagePackages(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const patientId = String(req.params.id || '').trim()
    const packageId = String(req.params.packageId || '').trim()
    const sessionId = String(req.params.sessionId || '').trim()
    if (!mongoose.isValidObjectId(patientId) || !mongoose.isValidObjectId(packageId) || !mongoose.isValidObjectId(sessionId)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const p = await Patient.findById(patientId)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const packageRows = Array.isArray(p.sessionPackages) ? p.sessionPackages : []
    const pkgIndex = packageRows.findIndex((x) => String(x?._id) === packageId)
    const pkg = pkgIndex >= 0 ? packageRows[pkgIndex] : null
    if (!pkg) {
      res.status(404).json({ error: 'الباكج غير موجود' })
      return
    }
    const packageSessions = Array.isArray(pkg.sessions) ? pkg.sessions : []
    const sessIndex = packageSessions.findIndex((x) => String(x?._id) === sessionId)
    const sess = sessIndex >= 0 ? packageSessions[sessIndex] : null
    if (!sess) {
      res.status(404).json({ error: 'جلسة الباكج غير موجودة' })
      return
    }

    if (req.body?.acknowledgePartialPackageArea === true) {
      if (sess.completedByReception === true) {
        res.status(400).json({ error: 'جلسة الباكج مُثبَّتة مسبقاً.' })
        return
      }
      if (!sess.linkedLaserSessionId || !mongoose.isValidObjectId(sess.linkedLaserSessionId)) {
        res.status(400).json({ error: 'لا توجد جلسة ليزر مرتبطة بهذا البند.' })
        return
      }
      const ls = await LaserSession.findById(sess.linkedLaserSessionId).lean()
      if (!ls) {
        res.status(400).json({ error: 'جلسة الليزر المرتبطة غير موجودة.' })
        return
      }
      const recorded = (Array.isArray(ls.lineItems) ? ls.lineItems : []).filter((r) => !r.isAddon).length
      const expected = Math.max(1, Math.trunc(Number(pkg.areaCount) || 0))
      const currentAck = Math.max(0, Math.trunc(Number(sess.packagePartialAreasAcknowledgedByReception) || 0))
      if (!(recorded < expected)) {
        res.status(400).json({
          error: 'عند إكمال كل مناطق الباكج لهذه الزيارة استخدم «إنقاص جلسة» من التحصيل.',
        })
        return
      }
      if (currentAck >= recorded) {
        res.status(400).json({
          error:
            'تم إنقاص كل المناطق المسجّلة حالياً. يُكمِل الأخصائي المناطق المتبقية في ملف المريض ثم يُعاد الحفظ.',
        })
        return
      }
      await Patient.updateOne(
        { _id: p._id },
        {
          $set: {
            [`sessionPackages.${pkgIndex}.sessions.${sessIndex}.packagePartialAreasAcknowledgedByReception`]:
              currentAck + 1,
            [`sessionPackages.${pkgIndex}.sessions.${sessIndex}.areasAdjustedOnly`]: true,
          },
        },
      )
      await writeAudit({
        user: req.user,
        action: 'إنقاص منطقة من جلسة باكج ليزر (استقبال)',
        entityType: 'Patient',
        entityId: p._id,
        details: { packageId: String(pkg._id), sessionId: String(sess._id), nextAck: currentAck + 1 },
      })
      const freshPartial = await Patient.findById(p._id).select('sessionPackages').lean()
      const freshPkgPartial = (Array.isArray(freshPartial?.sessionPackages) ? freshPartial.sessionPackages : []).find(
        (x) => String(x?._id) === String(pkg._id),
      )
      res.json({
        package: freshPkgPartial ? serializePackage(freshPkgPartial) : serializePackage(pkg),
      })
      return
    }

    const completed = req.body?.completed !== false
    if (sess.completedByReception === true && !completed) {
      res.status(400).json({ error: 'لا يمكن إلغاء إتمام جلسة باكج بعد تثبيتها' })
      return
    }
    const completedAt = completed ? new Date() : null
    await Patient.updateOne(
      { _id: p._id },
      {
        $set: {
          [`sessionPackages.${pkgIndex}.sessions.${sessIndex}.completedByReception`]: completed,
          [`sessionPackages.${pkgIndex}.sessions.${sessIndex}.completedAt`]: completedAt,
          [`sessionPackages.${pkgIndex}.sessions.${sessIndex}.completedByUserId`]: completed ? req.user._id : null,
        },
      },
    )

    if (completed && sess.linkedBillingItemId && mongoose.isValidObjectId(sess.linkedBillingItemId)) {
      const bi = await BillingItem.findById(sess.linkedBillingItemId).lean()
      if (bi && bi.isPackagePrepaid && bi.status === 'pending_payment') {
        await BillingItem.updateOne(
          { _id: bi._id },
          {
            $set: {
              status: 'paid',
              paidAt: new Date(),
            },
          },
        )
      }
    }
    if (completed && sess.linkedLaserSessionId && mongoose.isValidObjectId(sess.linkedLaserSessionId)) {
      await LaserSession.updateOne({ _id: sess.linkedLaserSessionId }, { $set: { status: 'completed' } })
    }

    await writeAudit({
      user: req.user,
      action: 'تثبيت إتمام جلسة من باكج مريض',
      entityType: 'Patient',
      entityId: p._id,
      details: {
        packageId: String(pkg._id),
        sessionId: String(sess._id),
        completed,
      },
    })

    const fresh = await Patient.findById(p._id).select('sessionPackages').lean()
    const freshPkg = (Array.isArray(fresh?.sessionPackages) ? fresh.sessionPackages : []).find(
      (x) => String(x?._id) === String(pkg._id),
    )
    res.json({
      package: freshPkg ? serializePackage(freshPkg) : serializePackage(pkg),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.get('/:id', async (req, res) => {
  try {
    if (!canReadPatients(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const p = await Patient.findById(req.params.id)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    res.json({ patient: patientToDto(p) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ error: 'معرّف المريض غير صالح' })
      return
    }
    const p = await Patient.findById(req.params.id).select('_id name fileNumber').lean()
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }

    const [appointmentsCount, clinicalSessionsCount, laserSessionsCount, billingItemsCount, billingPaymentsCount] =
      await Promise.all([
        ScheduleSlot.countDocuments({ patientId: p._id }),
        ClinicalSession.countDocuments({ patientId: p._id }),
        LaserSession.countDocuments({ patientId: p._id }),
        BillingItem.countDocuments({ patientId: p._id }),
        BillingPayment.countDocuments({ patientId: p._id }),
      ])

    const linkedTotal =
      appointmentsCount + clinicalSessionsCount + laserSessionsCount + billingItemsCount + billingPaymentsCount
    if (linkedTotal > 0) {
      res.status(400).json({
        error:
          'لا يمكن حذف هذا المريض لأنه مرتبط بسجلات (مواعيد/جلسات/فواتير). احذف فقط المرضى بدون أي سجلات مرتبطة.',
      })
      return
    }

    await Patient.deleteOne({ _id: p._id })
    await writeAudit({
      user: req.user,
      action: 'حذف ملف مريض',
      entityType: 'Patient',
      entityId: p._id,
      details: { name: String(p.name || ''), fileNumber: String(p.fileNumber || '') },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.post('/', requireActiveDay, async (req, res) => {
  try {
    if (!PATIENT_CREATE_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية لإنشاء مريض جديد' })
      return
    }
    const body = req.body ?? {}
    const requestedFileNumber = String(body.fileNumber || '').trim()
    const shouldAutoAssignFileNumber =
      !requestedFileNumber || /^tmp[-_]/i.test(requestedFileNumber)
    const normalized = normalizePatientProfilePayload(body)
    const paperLaserEntries = normalizePaperLaserEntries(body.paperLaserEntries)
    let p = null
    const attempts = shouldAutoAssignFileNumber ? 6 : 1
    let currentFileNumber = requestedFileNumber
    for (let i = 0; i < attempts; i += 1) {
      if (shouldAutoAssignFileNumber) {
        currentFileNumber = await nextSequentialFileNumber()
      }
      if (!currentFileNumber) {
        res.status(400).json({ error: 'رقم الإضبارة مطلوب' })
        return
      }
      try {
        let departments = Array.isArray(body.departments) ? body.departments : []
        if (req.user.role === 'dermatology_manager' && !departments.includes('dermatology')) {
          departments = [...departments, 'dermatology']
        }
        p = await Patient.create({
          fileNumber: currentFileNumber,
          ...normalized,
          departments,
          paperLaserEntries,
          lastVisit: new Date(),
        })
        break
      } catch (createErr) {
        if (createErr?.code === 11000 && shouldAutoAssignFileNumber) continue
        throw createErr
      }
    }
    if (!p) {
      res.status(409).json({ error: 'تعذر توليد رقم إضبارة تلقائي حالياً — أعد المحاولة' })
      return
    }
    let portalCredentials = null
    try {
      portalCredentials = await provisionPortalCredentials(p)
    } catch (pe) {
      console.error('provisionPortalCredentials:', pe)
      await Patient.findByIdAndDelete(p._id)
      res.status(500).json({ error: 'تعذر إنشاء بيانات دخول البوابة — أعد المحاولة' })
      return
    }
    await writeAudit({
      user: req.user,
      action:
        req.user.role === 'dermatology_manager'
          ? 'إنشاء مريض جديد (مدير جلدية) وحساب بوابة'
          : 'إنشاء مريض وحساب بوابة',
      entityType: 'Patient',
      entityId: p._id,
      details: { portalUsername: portalCredentials.username },
    })
    res.status(201).json({
      patient: patientToDto(p),
      portalCredentials: {
        username: portalCredentials.username,
        password: portalCredentials.plainPassword,
      },
    })
  } catch (e) {
    if (e?.code === 11000) {
      res.status(400).json({ error: 'رقم الإضبارة مستخدم مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientsRouter.patch('/:id', requireActiveDay, async (req, res) => {
  try {
    const p = await Patient.findById(req.params.id)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const body = req.body ?? {}

    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const fields = [
      'name',
      'fileNumber',
      'dob',
      'marital',
      'occupation',
      'medicalHistory',
      'surgicalHistory',
      'allergies',
      'drugHistory',
      'pregnancyStatus',
      'lactationStatus',
      'previousTreatments',
      'recentDermTreatments',
      'isotretinoinHistory',
      'departments',
      'phone',
      'gender',
      'paperLaserEntries',
    ]
    const profileNormalized = normalizePatientProfilePayload({
      ...p.toObject(),
      ...body,
      gender: body.gender === undefined ? p.gender : body.gender,
      marital: body.marital === undefined ? p.marital : body.marital,
    })
    for (const f of fields) {
      if (body[f] === undefined) continue
      if (f === 'fileNumber') {
        const next = String(body.fileNumber || '').trim()
        if (!next) continue
        p.fileNumber = next
        continue
      }
      if (f === 'paperLaserEntries') {
        p.paperLaserEntries = normalizePaperLaserEntries(body.paperLaserEntries)
        continue
      }
      if (
        [
          'name',
          'dob',
          'marital',
          'occupation',
          'medicalHistory',
          'surgicalHistory',
          'allergies',
          'drugHistory',
          'pregnancyStatus',
          'lactationStatus',
          'previousTreatments',
          'recentDermTreatments',
          'isotretinoinHistory',
          'phone',
          'gender',
        ].includes(f)
      ) {
        p[f] = profileNormalized[f]
        continue
      }
      p[f] = body[f]
    }
    if (body.touchLastVisit) p.lastVisit = new Date()
    await p.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل ملف مريض',
      entityType: 'Patient',
      entityId: p._id,
    })
    res.json({ patient: patientToDto(p) })
  } catch (e) {
    if (e?.code === 11000) {
      res.status(400).json({ error: 'رقم الإضبارة مستخدم مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
