import { Router } from 'express'
import { DentalMasterPlan } from '../models/DentalMasterPlan.js'
import { Patient } from '../models/Patient.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { writeAudit } from '../utils/audit.js'
import { patientToDto } from '../utils/dto.js'
import { todayBusinessDate } from '../utils/date.js'

export const dentalRouter = Router()
dentalRouter.use(authMiddleware, loadBusinessDay)

const DENTAL_READ = ['super_admin', 'dental_branch', 'reception']
const DENTAL_CHART_WRITE = ['super_admin', 'dental_branch']
const FDI_VALID = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45,
  46, 47, 48,
])
const SURFACE_VIEWS = new Set(['buccal', 'occlusal'])
const SURFACE_REGIONS = new Set(['M', 'D', 'O', 'B', 'L', 'I'])

function normalizeTreatment(raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const totalCostSyp = Math.max(0, Math.round(Number(t.totalCostSyp) || 0))
  const payments = []
  let paidSum = 0
  if (Array.isArray(t.payments)) {
    for (const p of t.payments) {
      let amountSyp = Math.max(0, Math.round(Number(p?.amountSyp) || 0))
      if (!(amountSyp > 0)) continue
      if (paidSum + amountSyp > totalCostSyp && totalCostSyp > 0) {
        amountSyp = Math.max(0, totalCostSyp - paidSum)
        if (!(amountSyp > 0)) break
      }
      payments.push({
        amountSyp,
        paidAt: String(p?.paidAt || '').trim().slice(0, 32),
        note: String(p?.note || '').trim().slice(0, 300),
      })
      paidSum += amountSyp
      if (payments.length >= 80) break
    }
  }
  const out = {
    procedureDescription: String(t.procedureDescription || '').trim().slice(0, 2000),
    totalCostSyp,
    doctorName: String(t.doctorName || '').trim().slice(0, 160),
    payments,
  }
  if (t._id) out._id = t._id
  return out
}

function treatmentHasContent(n) {
  return (
    Boolean(String(n.procedureDescription || '').trim()) ||
    Number(n.totalCostSyp) > 0 ||
    Boolean(String(n.doctorName || '').trim()) ||
    (Array.isArray(n.payments) && n.payments.length > 0)
  )
}

function normalizeTreatmentsList(row) {
  const list = []
  if (Array.isArray(row?.treatments) && row.treatments.length > 0) {
    for (const item of row.treatments) {
      const n = normalizeTreatment(item)
      if (treatmentHasContent(n) || list.length === 0) list.push(n)
      if (list.length >= 40) break
    }
  } else if (row?.treatment) {
    const n = normalizeTreatment(row.treatment)
    if (treatmentHasContent(n)) list.push(n)
  }
  return list
}

function treatmentToDto(t) {
  const n = normalizeTreatment(t)
  const rawPays = Array.isArray(t?.payments) ? t.payments : []
  return {
    id: t?._id ? String(t._id) : undefined,
    procedureDescription: n.procedureDescription,
    totalCostSyp: n.totalCostSyp,
    doctorName: n.doctorName,
    payments: (n.payments || []).map((p, idx) => ({
      id: rawPays[idx]?._id ? String(rawPays[idx]._id) : `p-${idx}`,
      amountSyp: Math.round(Number(p.amountSyp) || 0),
      paidAt: String(p.paidAt || ''),
      note: String(p.note || ''),
    })),
  }
}

function normalizeLabWorks(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const row of raw) {
    const labName = String(row?.labName || '').trim().slice(0, 200)
    const procedureDescription = String(row?.procedureDescription || '').trim().slice(0, 1000)
    const amountSyp = Math.max(0, Math.round(Number(row?.amountSyp) || 0))
    if (!labName && !procedureDescription && !(amountSyp > 0)) continue
    const item = { labName, procedureDescription, amountSyp }
    if (row?._id) item._id = row._id
    out.push(item)
    if (out.length >= 80) break
  }
  return out
}

function labWorkToDto(row) {
  return {
    id: row?._id ? String(row._id) : undefined,
    labName: String(row?.labName || ''),
    procedureDescription: String(row?.procedureDescription || ''),
    amountSyp: Math.max(0, Math.round(Number(row?.amountSyp) || 0)),
  }
}

function emptyDentalChartDto() {
  return { teeth: [], updatedAt: null, updatedBy: null }
}

function chartToDto(chart) {
  if (!chart) return emptyDentalChartDto()
  return {
    teeth: (chart.teeth || []).map((t) => {
      let treatmentsRaw = Array.isArray(t.treatments) ? t.treatments : []
      if (!treatmentsRaw.length && t.treatment) treatmentsRaw = [t.treatment]
      const treatments = treatmentsRaw.map((x) => treatmentToDto(x))
      const labWorks = (Array.isArray(t.labWorks) ? t.labWorks : []).map((x) => labWorkToDto(x))
      return {
        fdi: Number(t.fdi),
        status: t.status === 'missing' || t.status === 'implant' ? t.status : 'present',
        implantColor: t.implantColor === 'teal' || t.implantColor === 'red' ? t.implantColor : null,
        surfaces: (t.surfaces || []).map((s) => ({
          view: s.view === 'occlusal' ? 'occlusal' : 'buccal',
          region: String(s.region || 'O').toUpperCase(),
          label: String(s.label || 'حشوة كومبوزيت').trim().slice(0, 120),
        })),
        note: String(t.note || '').trim().slice(0, 500),
        treatments,
        labWorks,
        /** توافق واجهات قديمة */
        treatment: treatments[0] || treatmentToDto({}),
      }
    }),
    updatedAt: chart.updatedAt ? new Date(chart.updatedAt).toISOString() : null,
    updatedBy: chart.updatedBy ? String(chart.updatedBy) : null,
  }
}

function normalizeChartTeeth(rawTeeth) {
  if (!Array.isArray(rawTeeth)) return []
  const byFdi = new Map()
  for (const row of rawTeeth) {
    const fdi = Math.round(Number(row?.fdi))
    if (!FDI_VALID.has(fdi)) continue
    let status = String(row?.status || 'present').trim()
    if (status !== 'missing' && status !== 'implant') status = 'present'
    let implantColor = null
    if (status === 'implant') {
      implantColor = row?.implantColor === 'red' ? 'red' : 'teal'
    }
    const surfaces = []
    if (status === 'present' && Array.isArray(row?.surfaces)) {
      for (const s of row.surfaces) {
        const view = String(s?.view || '').trim()
        const region = String(s?.region || '').trim().toUpperCase()
        if (!SURFACE_VIEWS.has(view) || !SURFACE_REGIONS.has(region)) continue
        surfaces.push({
          view,
          region,
          label: String(s?.label || 'حشوة كومبوزيت').trim().slice(0, 120) || 'حشوة كومبوزيت',
        })
      }
    }
    const treatments = normalizeTreatmentsList(row)
    const labWorks = normalizeLabWorks(row?.labWorks)
    byFdi.set(fdi, {
      fdi,
      status,
      ...(status === 'implant' ? { implantColor } : {}),
      surfaces: status === 'present' ? surfaces.slice(0, 12) : [],
      note: String(row?.note || '').trim().slice(0, 500),
      treatments,
      labWorks,
      treatment: undefined,
    })
  }
  return [...byFdi.values()].sort((a, b) => a.fdi - b.fdi)
}

function planSummary(items) {
  if (!items?.length) return ''
  return items
    .map((i) => i.label || i.note)
    .filter(Boolean)
    .join(' — ')
}

/** لوحة الأسنان: اقتراح للمدير + طابور الخطط المعتمدة لأطباء الفروع */
dentalRouter.get('/dashboard', async (req, res) => {
  try {
    if (!['super_admin', 'dental_branch'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }

    const isAdmin = req.user.role === 'super_admin'
    let strategic = null

    if (isAdmin) {
      const [draftPlan] = await DentalMasterPlan.find({ status: 'draft' })
        .populate('patientId')
        .sort({ updatedAt: -1 })
        .limit(1)
        .lean()

      if (draftPlan?.patientId) {
        strategic = {
          patient: patientToDto(draftPlan.patientId),
          reason: 'draft_plan',
          hint: 'خطة مسودة — يمكن الاعتماد أو التعديل من ملف المريض',
        }
      } else {
        const withPlanIds = await DentalMasterPlan.distinct('patientId')
        const noPlan = await Patient.findOne({
          departments: 'dental',
          _id: { $nin: withPlanIds },
        })
          .sort({ updatedAt: -1 })
          .lean()

        if (noPlan) {
          strategic = {
            patient: patientToDto(noPlan),
            reason: 'no_plan',
            hint: 'لا توجد خطة مسجّلة — ابدأ المخطط الاستراتيجي من ملف المريض',
          }
        } else {
          const anyDental = await Patient.findOne({ departments: 'dental' })
            .sort({ lastVisit: -1 })
            .lean()
          if (anyDental) {
            strategic = {
              patient: patientToDto(anyDental),
              reason: 'first_dental',
              hint: 'مريض أسنان — افتح الملف لمراجعة الخطة أو الاعتماد',
            }
          }
        }
      }
    }

    const approvedPlans = await DentalMasterPlan.find({ status: 'approved' })
      .populate('patientId')
      .sort({ approvedAt: -1 })
      .limit(30)
      .lean()

    const approvedQueue = approvedPlans
      .filter((doc) => doc.patientId && doc.patientId.departments?.includes('dental'))
      .map((doc) => ({
        patient: patientToDto(doc.patientId),
        planId: String(doc._id),
        approvedAt: doc.approvedAt,
        summary: planSummary(doc.items),
      }))

    res.json({
      businessDate: todayBusinessDate(),
      strategic,
      approvedQueue,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.get('/chart/:patientId', async (req, res) => {
  try {
    if (!DENTAL_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const patient = await Patient.findById(req.params.patientId).select('dentalChart').lean()
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    res.json({ chart: chartToDto(patient.dentalChart) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.put('/chart/:patientId', requireActiveDay, async (req, res) => {
  try {
    if (!DENTAL_CHART_WRITE.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية لتعديل مخطط الأسنان' })
      return
    }
    const patient = await Patient.findById(req.params.patientId)
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const teeth = normalizeChartTeeth(req.body?.teeth)
    patient.dentalChart = {
      teeth,
      updatedAt: new Date(),
      updatedBy: req.user._id,
    }
    if (!patient.departments.includes('dental')) {
      patient.departments = [...new Set([...patient.departments, 'dental'])]
    }
    await patient.save()
    await writeAudit({
      user: req.user,
      action: 'تحديث مخطط الأسنان',
      entityType: 'Patient',
      entityId: patient._id,
      details: { toothCount: teeth.length },
    })
    res.json({ chart: chartToDto(patient.dentalChart) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.get('/plans/:patientId', async (req, res) => {
  try {
    if (!DENTAL_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const plan = await DentalMasterPlan.findOne({ patientId: req.params.patientId })
    if (!plan) {
      res.json({ plan: null })
      return
    }
    res.json({
      plan: {
        id: String(plan._id),
        patientId: String(plan.patientId),
        status: plan.status,
        items: plan.items,
        approvedAt: plan.approvedAt,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.put('/plans/:patientId', requireActiveDay, async (req, res) => {
  try {
    if (!['super_admin', 'dental_branch'].includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const patient = await Patient.findById(req.params.patientId)
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    const body = req.body ?? {}
    let plan = await DentalMasterPlan.findOne({ patientId: patient._id })
    if (!plan) {
      plan = await DentalMasterPlan.create({
        patientId: patient._id,
        status: 'draft',
        items: body.items ?? [],
        createdBy: req.user._id,
      })
    } else {
      if (plan.status === 'approved' && req.user.role !== 'super_admin') {
        res.status(400).json({ error: 'الخطة معتمدة — تعديل المدير فقط' })
        return
      }
      plan.items = body.items ?? plan.items
      await plan.save()
    }
    if (!patient.departments.includes('dental')) {
      patient.departments = [...new Set([...patient.departments, 'dental'])]
      await patient.save()
    }
    await writeAudit({
      user: req.user,
      action: 'تحديث خطة علاج أسنان',
      entityType: 'DentalMasterPlan',
      entityId: plan._id,
    })
    res.json({
      plan: {
        id: String(plan._id),
        status: plan.status,
        items: plan.items,
        approvedAt: plan.approvedAt,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.post(
  '/plans/:patientId/approve',
  requireActiveDay,
  requireRoles('super_admin'),
  async (req, res) => {
    try {
      let plan = await DentalMasterPlan.findOne({ patientId: req.params.patientId })
      if (!plan) {
        plan = await DentalMasterPlan.create({
          patientId: req.params.patientId,
          status: 'draft',
          items: req.body?.items ?? [],
          createdBy: req.user._id,
        })
      }
      plan.status = 'approved'
      plan.approvedBy = req.user._id
      plan.approvedAt = new Date()
      if (req.body?.items) plan.items = req.body.items
      await plan.save()
      await writeAudit({
        user: req.user,
        action: 'اعتماد الخطة العلاجية الرئيسية',
        entityType: 'DentalMasterPlan',
        entityId: plan._id,
      })
      res.json({
        plan: {
          id: String(plan._id),
          status: plan.status,
          items: plan.items,
          approvedAt: plan.approvedAt,
        },
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)
