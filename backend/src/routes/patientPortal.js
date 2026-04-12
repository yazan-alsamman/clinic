import { Router } from 'express'
import { patientAuthMiddleware } from '../middleware/patientAuth.js'
import { patientToDto } from '../utils/dto.js'
import { getClinicalBundleForPatientId } from '../services/patientClinicalBundle.js'
import { todayBusinessDate } from '../utils/date.js'

export const patientPortalRouter = Router()
patientPortalRouter.use(patientAuthMiddleware)

patientPortalRouter.get('/profile', async (req, res) => {
  try {
    res.json({ patient: patientToDto(req.patient) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientPortalRouter.get('/clinical', async (req, res) => {
  try {
    const bundle = await getClinicalBundleForPatientId(req.patient._id)
    res.json(bundle)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

patientPortalRouter.get('/dashboard', async (req, res) => {
  try {
    const p = req.patient
    const bundle = await getClinicalBundleForPatientId(p._id)
    const today = todayBusinessDate()
    const upcoming = bundle.appointments.filter((a) => String(a.businessDate) >= today)
    const recentLaser = bundle.laserSessions.slice(0, 5)
    const recentDerm = bundle.dermatologyVisits.slice(0, 5)

    const updates = []
    for (const s of bundle.laserSessions.slice(0, 3)) {
      updates.push({
        kind: 'laser',
        at: s.createdAt,
        label: `جلسة ليزر — ${s.laserType} — حالة: ${s.status}`,
      })
    }
    for (const v of bundle.dermatologyVisits.slice(0, 2)) {
      updates.push({
        kind: 'dermatology',
        at: v.createdAt,
        label: `زيارة جلدية — ${v.sessionType || 'إجراء'} — ${v.businessDate}`,
      })
    }
    updates.sort((a, b) => new Date(b.at) - new Date(a.at))

    res.json({
      patient: patientToDto(p),
      mustChangePassword: p.portalMustChangePassword === true,
      summary: {
        laserSessionsCount: bundle.laserSessions.length,
        dermatologyVisitsCount: bundle.dermatologyVisits.length,
        appointmentsTotal: bundle.appointments.length,
        upcomingAppointmentsCount: upcoming.length,
        dentalPlanStatus: bundle.dentalPlan?.status ?? null,
      },
      upcomingAppointments: upcoming.slice(0, 12),
      recentLaserSessions: recentLaser,
      recentDermatology: recentDerm,
      updates: updates.slice(0, 8),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
