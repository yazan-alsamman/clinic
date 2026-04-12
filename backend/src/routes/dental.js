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
