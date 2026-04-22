import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { Patient } from '../models/Patient.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { authMiddleware, requireActiveDay } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { patientToDto } from '../utils/dto.js'
import { writeAudit } from '../utils/audit.js'
import { getClinicalBundleForPatientId } from '../services/patientClinicalBundle.js'
import { provisionPortalCredentials, randomPasswordPlain } from '../utils/patientPortalCredentials.js'

const CLINICAL_ROLES = ['super_admin', 'reception', 'laser', 'dermatology', 'dental_branch', 'solarium']

function canReadPatients(role) {
  return CLINICAL_ROLES.includes(role)
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

function resolveUsdAmount({ usdRaw, sypRaw, exchangeRate, allowZero = false }) {
  const usd = Number(usdRaw)
  if (Number.isFinite(usd) && (allowZero ? usd >= 0 : usd > 0)) return usd
  const syp = Number(sypRaw)
  if (Number.isFinite(syp) && (allowZero ? syp >= 0 : syp > 0)) {
    const rate = Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('سعر الصرف غير متاح')
    return syp / rate
  }
  throw new Error('المبلغ غير صالح')
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
  const isFemaleMarried = gender === 'female' && marital === 'متزوجة'
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

export const patientsRouter = Router()

patientsRouter.use(authMiddleware, loadBusinessDay)

patientsRouter.get('/', async (req, res) => {
  try {
    if (!canReadPatients(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const q = String(req.query.q || '').trim()
    let query = {}
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query = { $or: [{ name: new RegExp(safe, 'i') }, { fileNumber: new RegExp(safe, 'i') }] }
    }
    const list = await Patient.find(query).sort({ updatedAt: -1 }).limit(200)
    res.json({ patients: list.map(patientToDto) })
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
    const p = await Patient.findById(req.params.id)
    if (!p) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const pid = p._id
    const role = req.user.role
    const myName = String(req.user.name || '').trim()
    const fullAccess = role === 'super_admin' || role === 'reception'

    const needLaser = fullAccess || role === 'laser'
    const needDerm = fullAccess || role === 'dermatology'
    const needAppts = fullAccess || role === 'dermatology' || role === 'dental_branch'
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
    else if ((role === 'dermatology' || role === 'dental_branch') && myName) {
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
    p.portalPasswordHash = await bcrypt.hash(plain, 10)
    p.portalMustChangePassword = true
    await p.save()
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
      .select('_id amountDueUsd businessDate procedureLabel')
      .lean()
    const byId = new Map(items.map((x) => [String(x._id), x]))
    const itemIds = [...byId.keys()]
    if (itemIds.length === 0) {
      res.json({
        summary: {
          outstandingDebtUsd: Number(p.outstandingDebtUsd) || 0,
          prepaidCreditUsd: Number(p.prepaidCreditUsd) || 0,
        },
        entries: [],
      })
      return
    }

    const payments = await BillingPayment.find({ billingItemId: { $in: itemIds } })
      .sort({ receivedAt: -1, createdAt: -1 })
      .populate('receivedBy', 'name')
      .lean()

    const entries = payments.map((pay) => {
      const key = String(pay.billingItemId)
      const bi = byId.get(key)
      const due = Number(bi?.amountDueUsd) || 0
      const applied = Number(pay.amountUsd) || 0
      const received = Number(pay.receivedAmountUsd ?? pay.amountUsd) || 0
      const delta = Number(pay.settlementDeltaUsd ?? received - due) || 0
      let settlementType = 'exact'
      if (delta < -0.0001) settlementType = 'debt'
      else if (delta > 0.0001) settlementType = 'credit'
      return {
        id: String(pay._id),
        billingItemId: key,
        businessDate: String(bi?.businessDate || '').trim(),
        procedureLabel: String(bi?.procedureLabel || '').trim(),
        amountDueUsd: due,
        appliedAmountUsd: applied,
        receivedAmountUsd: received,
        settlementDeltaUsd: Math.round(delta * 100) / 100,
        settlementType,
        method: pay.method,
        receivedAt: pay.receivedAt ? new Date(pay.receivedAt).toISOString() : null,
        receivedByName: String(pay.receivedBy?.name || '').trim(),
      }
    })

    res.json({
      summary: {
        outstandingDebtUsd: Number(p.outstandingDebtUsd) || 0,
        prepaidCreditUsd: Number(p.prepaidCreditUsd) || 0,
      },
      entries,
    })
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
    let enteredUsd = 0
    try {
      enteredUsd = resolveUsdAmount({
        usdRaw: req.body?.amountUsd,
        sypRaw: req.body?.amountSyp,
        exchangeRate: req.businessDay?.exchangeRate,
      })
    } catch (err) {
      res.status(400).json({ error: String(err?.message || 'المبلغ غير صالح') })
      return
    }
    enteredUsd = Math.round(enteredUsd * 100) / 100
    if (!(enteredUsd > 0)) {
      res.status(400).json({ error: 'أدخل مبلغاً أكبر من الصفر' })
      return
    }

    const debtBefore = Math.round((Number(p.outstandingDebtUsd) || 0) * 100) / 100
    const creditBefore = Math.round((Number(p.prepaidCreditUsd) || 0) * 100) / 100
    const appliedToDebtUsd = Math.round(Math.min(debtBefore, enteredUsd) * 100) / 100
    const extraToCreditUsd = Math.round((enteredUsd - appliedToDebtUsd) * 100) / 100
    const debtAfter = Math.round((debtBefore - appliedToDebtUsd) * 100) / 100
    const creditAfter = Math.round((creditBefore + extraToCreditUsd) * 100) / 100

    await Patient.updateOne(
      { _id: p._id },
      {
        $set: {
          outstandingDebtUsd: debtAfter,
          prepaidCreditUsd: creditAfter,
        },
      },
    )

    const outcome =
      debtBefore <= 0
        ? 'credit_only'
        : enteredUsd < debtBefore
          ? 'partial'
          : enteredUsd === debtBefore
            ? 'exact'
            : 'overpay'

    await writeAudit({
      user: req.user,
      action: 'تسوية مالية يدوية لمريض',
      entityType: 'Patient',
      entityId: p._id,
      details: {
        enteredUsd,
        debtBefore,
        debtAfter,
        creditBefore,
        creditAfter,
        appliedToDebtUsd,
        extraToCreditUsd,
        outcome,
      },
    })

    res.status(201).json({
      settlement: {
        enteredUsd,
        debtBefore,
        debtAfter,
        creditBefore,
        creditAfter,
        appliedToDebtUsd,
        extraToCreditUsd,
        outcome,
      },
      summary: {
        outstandingDebtUsd: debtAfter,
        prepaidCreditUsd: creditAfter,
      },
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

patientsRouter.post('/', requireActiveDay, async (req, res) => {
  try {
    if (!['super_admin', 'reception'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const body = req.body ?? {}
    const fileNumber = String(body.fileNumber || '').trim()
    if (!fileNumber) {
      res.status(400).json({ error: 'رقم الإضبارة مطلوب' })
      return
    }
    const normalized = normalizePatientProfilePayload(body)
    const paperLaserEntries = normalizePaperLaserEntries(body.paperLaserEntries)
    const p = await Patient.create({
      fileNumber,
      ...normalized,
      departments: Array.isArray(body.departments) ? body.departments : [],
      paperLaserEntries,
      lastVisit: new Date(),
    })
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
      action: 'إنشاء مريض وحساب بوابة',
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
