import { Router } from 'express'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { writeAudit } from '../utils/audit.js'
import {
  applyDepartmentDefaultToDoctors,
  buildDoctorSharesAdminPayload,
  saveDepartmentDefault,
  saveUserSharePercent,
  saveVirtualProviderPercent,
} from '../services/doctorShareSettings.js'

export const doctorSharesRouter = Router()

doctorSharesRouter.use(authMiddleware, loadBusinessDay, requireRoles('super_admin'))

function sendServiceError(res, e) {
  if (e?.status) {
    res.status(e.status).json({ error: e.message || 'خطأ' })
    return
  }
  console.error(e)
  res.status(500).json({ error: 'خطأ في الخادم' })
}

doctorSharesRouter.get('/', async (_req, res) => {
  try {
    const payload = await buildDoctorSharesAdminPayload()
    res.json(payload)
  } catch (e) {
    sendServiceError(res, e)
  }
})

doctorSharesRouter.patch('/defaults/:department', async (req, res) => {
  try {
    const settings = await saveDepartmentDefault(req.params.department, req.body?.sharePercent)
    await writeAudit({
      user: req.user,
      action: 'تعديل النسبة الافتراضية للقسم',
      entityType: 'DoctorShareSettings',
      entityId: 'default',
      details: { department: req.params.department, sharePercent: req.body?.sharePercent },
    })
    const payload = await buildDoctorSharesAdminPayload()
    res.json({ ok: true, settings, ...payload })
  } catch (e) {
    sendServiceError(res, e)
  }
})

doctorSharesRouter.patch('/virtual/:key', async (req, res) => {
  try {
    const settings = await saveVirtualProviderPercent(req.params.key, req.body?.sharePercent)
    await writeAudit({
      user: req.user,
      action: 'تعديل نسبة مقدّم افتراضي',
      entityType: 'DoctorShareSettings',
      entityId: String(req.params.key || ''),
      details: { sharePercent: req.body?.sharePercent },
    })
    const payload = await buildDoctorSharesAdminPayload()
    res.json({ ok: true, settings, ...payload })
  } catch (e) {
    sendServiceError(res, e)
  }
})

doctorSharesRouter.patch('/users/:id', async (req, res) => {
  try {
    const doctor = await saveUserSharePercent(req.params.id, req.body?.sharePercent)
    await writeAudit({
      user: req.user,
      action: 'تعديل نسبة طبيب',
      entityType: 'User',
      entityId: doctor.id,
      details: { sharePercent: doctor.sharePercent },
    })
    const payload = await buildDoctorSharesAdminPayload()
    res.json({ ok: true, doctor, ...payload })
  } catch (e) {
    sendServiceError(res, e)
  }
})

doctorSharesRouter.post('/apply-default', async (req, res) => {
  try {
    const result = await applyDepartmentDefaultToDoctors(req.body?.department)
    await writeAudit({
      user: req.user,
      action: 'تطبيق النسبة الافتراضية على أطباء القسم',
      entityType: 'DoctorShareSettings',
      entityId: 'default',
      details: result,
    })
    const payload = await buildDoctorSharesAdminPayload()
    res.json({ ok: true, ...result, ...payload })
  } catch (e) {
    sendServiceError(res, e)
  }
})
