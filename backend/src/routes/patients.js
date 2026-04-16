import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { Patient } from '../models/Patient.js'
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
    const gRaw = String(body.gender || '').trim()
    const gender = gRaw === 'male' || gRaw === 'female' ? gRaw : ''
    const p = await Patient.create({
      fileNumber,
      name: String(body.name || '').trim() || 'مريض جديد',
      dob: body.dob ?? '',
      marital: body.marital ?? '',
      occupation: body.occupation ?? '',
      medicalHistory: body.medicalHistory ?? '',
      surgicalHistory: body.surgicalHistory ?? '',
      allergies: body.allergies ?? '',
      departments: Array.isArray(body.departments) ? body.departments : [],
      phone: body.phone ?? '',
      gender,
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
      'departments',
      'phone',
      'gender',
    ]
    for (const f of fields) {
      if (body[f] === undefined) continue
      if (f === 'gender') {
        const g = String(body.gender || '').trim()
        if (['male', 'female', ''].includes(g)) p.gender = g
        continue
      }
      if (f === 'fileNumber') {
        const next = String(body.fileNumber || '').trim()
        if (!next) continue
        p.fileNumber = next
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
