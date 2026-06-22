import { Router } from 'express'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { SkinProcedureOption } from '../models/SkinProcedureOption.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { Room } from '../models/Room.js'
import { DermatologyBoard } from '../models/DermatologyBoard.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { todayBusinessDate, addCalendarDaysYmd, isValidYmd } from '../utils/date.js'
import { writeAudit } from '../utils/audit.js'
import { notifyAppointmentCancelled } from '../services/scheduleCancelNotify.js'
import { getLaserBookingContextForPatient } from '../services/laserPackageBooking.js'
import {
  normalizeHm,
  hmToMinutes,
  minutesToHm,
  slotIntervalMinutes,
  intervalsOverlapHalfOpen,
  APPOINTMENT_GRID_END_MIN,
} from '../utils/scheduleTime.js'

export const scheduleRouter = Router()

scheduleRouter.use(authMiddleware)

const providerRoles = ['laser', 'dermatology', 'dental_branch']
const SERVICE_TYPES = ['laser', 'dental', 'dermatology', 'solarium', 'skin', 'other']
const DERMATOLOGY_PROVIDER_ROLES = ['dermatology', 'dermatology_manager', 'dermatology_assistant_manager']
const DEFAULT_DERMATOLOGY_BOARDS = [
  { index: 1, title: 'د.لورا' },
  { index: 2, title: 'د.سامر' },
  { index: 3, title: 'د.محمد' },
]

function normalizeServiceType(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
  if (s === 'laser' || s === 'ليزر') return 'laser'
  if (s === 'dental' || s === 'أسنان' || s === 'اسنان') return 'dental'
  if (s === 'dermatology' || s === 'جلدية') return 'dermatology'
  if (s === 'skin' || s === 'قسم البشرة') return 'skin'
  if (s === 'solarium' || s === 'سولاريوم') return 'solarium'
  return 'other'
}

function inferRoomNumber(providerNameRaw) {
  const m = String(providerNameRaw || '').match(/room\s*(\d+)/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function inShift(slotMin, startMin, endMin) {
  return slotMin >= startMin && slotMin < endMin
}

function roomShiftBounds(room) {
  const morningShiftStart = normalizeHm(room?.morningShiftStart) || '09:00'
  const morningShiftEnd = normalizeHm(room?.morningShiftEnd) || '15:00'
  const eveningShiftStart = normalizeHm(room?.eveningShiftStart) || '15:00'
  const eveningShiftEnd = normalizeHm(room?.eveningShiftEnd) || '21:00'
  return {
    morningShiftStart,
    morningShiftEnd,
    eveningShiftStart,
    eveningShiftEnd,
    morningStartMin: hmToMinutes(morningShiftStart),
    morningEndMin: hmToMinutes(morningShiftEnd),
    eveningStartMin: hmToMinutes(eveningShiftStart),
    eveningEndMin: hmToMinutes(eveningShiftEnd),
  }
}

function pickAssignedForTime(room, timeStr) {
  const slotMin = hmToMinutes(normalizeHm(timeStr))
  if (slotMin == null) return null
  const b = roomShiftBounds(room)
  if (
    b.morningStartMin == null ||
    b.morningEndMin == null ||
    b.eveningStartMin == null ||
    b.eveningEndMin == null
  ) {
    return room?.assignedUserId || null
  }
  if (inShift(slotMin, b.morningStartMin, b.morningEndMin)) {
    return room?.morningAssignedUserId || room?.assignedUserId || null
  }
  if (inShift(slotMin, b.eveningStartMin, b.eveningEndMin)) {
    return room?.eveningAssignedUserId || room?.assignedUserId || null
  }
  return null
}

async function resolveProviderAssignment({ serviceType, providerName, roomNumberRaw, timeStr }) {
  let effectiveProviderName = String(providerName || '').trim()
  let roomNumber = null
  let assignedSpecialistUserId = null
  let assignedSpecialistName = ''
  if (serviceType === 'laser') {
    const bodyRoom = Number(roomNumberRaw)
    roomNumber = Number.isFinite(bodyRoom) && bodyRoom > 0 ? Math.trunc(bodyRoom) : inferRoomNumber(providerName)
    if (!roomNumber) {
      return { error: 'رقم غرفة الليزر مطلوب للحجز' }
    }
    const room = await Room.findOne({ number: roomNumber })
      .populate('assignedUserId', 'name')
      .populate('morningAssignedUserId', 'name')
      .populate('eveningAssignedUserId', 'name')
    const assignedForShift = pickAssignedForTime(room, timeStr)
    if (!assignedForShift) {
      return { error: 'لا يوجد أخصائي مخصص لهذه الغرفة في وقت الموعد. عدّل الورديات من لوحة المدير.' }
    }
    effectiveProviderName = `Laser Room ${roomNumber}`
    assignedSpecialistUserId = assignedForShift._id
    assignedSpecialistName = assignedForShift.name || ''
  } else if (serviceType === 'dermatology') {
    const boards = await ensureDermatologyBoards()
    const board = boards.find((b) => String(b.title || '').trim() === effectiveProviderName)
    if (!board) {
      return { error: 'جدول الجلدية المختار غير صالح' }
    }
    if (!board.assignedUserId?._id || !board.assignedUserId?.name) {
      return { error: 'لا يوجد طبيب جلدية مرتبط بهذا الجدول. عدّل الربط من لوحة المدير.' }
    }
    effectiveProviderName = String(board.title || '').trim()
    assignedSpecialistUserId = board.assignedUserId._id
    assignedSpecialistName = String(board.assignedUserId.name || '').trim()
  } else if (serviceType === 'skin') {
    effectiveProviderName = 'قسم البشرة'
    assignedSpecialistUserId = null
    assignedSpecialistName = ''
  }
  return { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName }
}

const PATIENT_DEPARTMENTS = ['laser', 'dermatology', 'dental', 'solarium', 'skin']

async function deleteSkinBillingForScheduleSlotId(slotId) {
  if (!slotId) return
  const prev = await ClinicalSession.findOne({ scheduleSlotId: slotId })
  if (!prev?._id) return
  await BillingItem.deleteMany({ clinicalSessionId: prev._id })
  await ClinicalSession.deleteOne({ _id: prev._id })
}

async function syncSkinAppointmentBillingForSlot(slot, reqUser) {
  await deleteSkinBillingForScheduleSlotId(slot._id)
  if (String(slot.serviceType) !== 'skin' || !slot.patientId) return { ok: true }
  const proc = String(slot.procedureType || '').trim()
  if (!proc) return { ok: true }
  const opt = await SkinProcedureOption.findOne({ name: proc, active: { $ne: false } }).lean()
  const amount = Math.round(Number(opt?.priceSyp) || 0)
  if (!(amount > 0)) return { error: 'نوع إجراء البشرة غير معرّف أو بلا سعر' }
  const patient = await Patient.findById(slot.patientId)
  if (!patient) return { error: 'المريض غير موجود' }
  let cs = null
  try {
    const bd = String(slot.businessDate || '').trim()
    cs = await ClinicalSession.create({
      patientId: patient._id,
      providerUserId: reqUser._id,
      department: 'skin',
      procedureDescription: proc.slice(0, 500),
      sessionFeeSyp: amount,
      businessDate: bd,
      notes: '',
      materials: [],
      materialCostSypTotal: 0,
      materialChargeSypTotal: 0,
      createdByReceptionUserId: reqUser._id,
      scheduleSlotId: slot._id,
    })
    const bi = await BillingItem.create({
      clinicalSessionId: cs._id,
      patientId: patient._id,
      providerUserId: reqUser._id,
      department: 'skin',
      procedureLabel: proc.slice(0, 200),
      listAmountDueSyp: amount,
      discountPercent: 0,
      effectiveAmountDueSyp: amount,
      amountDueSyp: amount,
      currency: 'SYP',
      businessDate: bd,
      status: 'pending_payment',
    })
    cs.billingItemId = bi._id
    await cs.save()
    const prevDeps = Array.isArray(patient.departments) ? patient.departments : []
    const cleaned = prevDeps.filter((d) => PATIENT_DEPARTMENTS.includes(d))
    patient.departments = [...new Set([...cleaned, 'skin'])]
    patient.lastVisit = new Date()
    await patient.save()
    await writeAudit({
      user: reqUser,
      action: 'موعد بشرة: جلسة وبند تحصيل حسب نوع الإجراء',
      entityType: 'ClinicalSession',
      entityId: cs._id,
      details: { scheduleSlotId: String(slot._id), amountDueSyp: amount, procedureType: proc },
    })
  } catch (e) {
    if (cs?._id) {
      await BillingItem.deleteMany({ clinicalSessionId: cs._id })
      await ClinicalSession.findByIdAndDelete(cs._id)
    }
    throw e
  }
  return { ok: true }
}

async function ensureDermatologyBoards() {
  for (const row of DEFAULT_DERMATOLOGY_BOARDS) {
    await DermatologyBoard.updateOne(
      { index: row.index },
      { $setOnInsert: { title: row.title, assignedUserId: null } },
      { upsert: true },
    )
  }
  return DermatologyBoard.find({ index: { $in: [1, 2, 3] } })
    .sort({ index: 1 })
    .populate('assignedUserId', 'name role active')
}

async function assertNoOverlapForProvider({ businessDate, providerName, startTime, endTime, ignoreId = null }) {
    const startMin = hmToMinutes(startTime)
    let endMin = hmToMinutes(endTime)
    if (startMin == null || endMin == null) {
      return { error: 'وقت النهاية يجب أن يكون بعد وقت البداية' }
    }
    if (endMin <= startMin) endMin += APPOINTMENT_GRID_END_MIN
  const sameProvSlots = await ScheduleSlot.find({ businessDate, providerName }).lean()
  for (const o of sameProvSlots) {
    if (!o.patientId) continue
    if (ignoreId && String(o._id) === String(ignoreId)) continue
    const iv = slotIntervalMinutes(o)
    if (!iv) continue
    if (intervalsOverlapHalfOpen(startMin, endMin, iv.start, iv.end)) {
      return {
        error:
          'فترة الموعد (من وقت البداية إلى النهاية) تتداخل مع موعد آخر لنفس المقدّم في هذا اليوم — اختر أوقاتاً لا تتقاطع مع المواعيد الحالية',
      }
    }
  }
  return { ok: true }
}

/**
 * مواعيد محجوزة: إما يوم واحد `?date=YYYY-MM-DD` أو نطاق `from` / `to` (للتوافق).
 * المدير والاستقبال: الكل — المقدّمون: حيث providerName = اسم المستخدم
 */
scheduleRouter.get(
  '/booked',
  loadBusinessDay,
  requireRoles(
    'super_admin',
    'reception',
    'laser',
    'dermatology',
    'dermatology_manager',
    'dermatology_assistant_manager',
    'dental_branch',
  ),
  async (req, res) => {
    try {
      const role = req.user.role
      const isDermatologyManager = role === 'dermatology_manager'
      const isDermatologyAssistantManager = role === 'dermatology_assistant_manager'
      const isDermatologyLeadership = isDermatologyManager || isDermatologyAssistantManager
      const isProvider = providerRoles.includes(role)

      let from
      let to
      if (isProvider) {
        /** مقدّمو الخدمة: دائماً يوم العمل الحالي فقط — تجاهل أي تاريخ في الطلب */
        const day = req.businessDate || todayBusinessDate()
        from = day
        to = day
      } else {
        const single = String(req.query.date || '').trim()
        let fromQ = String(req.query.from || '').trim()
        let toQ = String(req.query.to || '').trim()

        if (isValidYmd(single)) {
          from = single
          to = single
        } else {
          if (!isValidYmd(fromQ)) fromQ = todayBusinessDate()
          if (!isValidYmd(toQ)) toQ = addCalendarDaysYmd(fromQ, 89)
          if (fromQ > toQ) {
            res.status(400).json({ error: 'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية' })
            return
          }
          from = fromQ
          to = toQ
        }
      }

      const filter = {
        patientId: { $ne: null },
        businessDate: { $gte: from, $lte: to },
      }
      if (isDermatologyLeadership) {
        filter.serviceType = 'dermatology'
      }
      let scopedToProvider = false
      if (isProvider) {
        const name = String(req.user.name || '').trim()
        if (!name && req.user.role !== 'laser') {
          res.json({
            from,
            to,
            scopedToProvider: true,
            slots: [],
          })
          return
        }
        if (req.user.role === 'laser') {
          filter.$or = [{ assignedSpecialistUserId: req.user._id }, { providerName: name }]
        } else if (DERMATOLOGY_PROVIDER_ROLES.includes(req.user.role)) {
          filter.$or = [{ assignedSpecialistUserId: req.user._id }, { providerName: name }]
        } else {
          filter.providerName = name
        }
        scopedToProvider = true
      }
      const assistantHeadOnly =
        isDermatologyAssistantManager && String(req.query.headOnly || '').trim() === '1'
      if (assistantHeadOnly) {
        const managers = await User.find({
          role: 'dermatology_manager',
          active: true,
        })
          .select('_id')
          .lean()
        const ids = managers.map((u) => u._id)
        if (ids.length === 0) {
          res.json({
            from,
            to,
            scopedToProvider,
            slots: [],
          })
          return
        }
        filter.assignedSpecialistUserId = { $in: ids }
      }

      const slots = await ScheduleSlot.find(filter)
        .sort({ businessDate: 1, providerName: 1, time: 1 })
        .lean()
      res.json({
        from,
        to,
        scopedToProvider,
        slots: slots.map(slotToDto),
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

scheduleRouter.use(requireRoles('super_admin', 'reception', 'dermatology_manager'))

scheduleRouter.get('/dermatology-boards', async (_req, res) => {
  try {
    const boards = await ensureDermatologyBoards()
    res.json({
      boards: boards.map((b) => ({
        id: String(b._id),
        index: Number(b.index) || 0,
        title: String(b.title || '').trim(),
        assigned: b.assignedUserId?._id
          ? {
              id: String(b.assignedUserId._id),
              name: String(b.assignedUserId.name || '').trim(),
            }
          : null,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.patch('/dermatology-boards/:index', requireRoles('super_admin'), async (req, res) => {
  try {
    const idx = Number.parseInt(String(req.params.index || ''), 10)
    if (![1, 2, 3].includes(idx)) {
      res.status(400).json({ error: 'رقم جدول الجلدية غير صالح' })
      return
    }
    const nextTitle = String(req.body?.title || '').trim().slice(0, 120)
    if (!nextTitle) {
      res.status(400).json({ error: 'اسم الجدول مطلوب' })
      return
    }
    const assignedUserIdRaw = req.body?.assignedUserId
    let assignedUserId = null
    if (assignedUserIdRaw) {
      const user = await User.findById(assignedUserIdRaw).lean()
      if (!user || user.active === false || !DERMATOLOGY_PROVIDER_ROLES.includes(String(user.role || ''))) {
        res.status(400).json({ error: 'الطبيب المرتبط يجب أن يكون من فريق الجلدية النشط' })
        return
      }
      assignedUserId = user._id
    }
    const board = await DermatologyBoard.findOneAndUpdate(
      { index: idx },
      { $set: { title: nextTitle, assignedUserId: assignedUserId || null } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).populate('assignedUserId', 'name')
    await writeAudit({
      user: req.user,
      action: 'تعديل جدول عيادة الجلدية',
      entityType: 'DermatologyBoard',
      entityId: String(board?._id || idx),
      details: {
        index: idx,
        title: nextTitle,
        assignedUserId: assignedUserId ? String(assignedUserId) : null,
      },
    })
    res.json({
      board: {
        id: String(board._id),
        index: Number(board.index) || idx,
        title: String(board.title || '').trim(),
        assigned: board.assignedUserId?._id
          ? {
              id: String(board.assignedUserId._id),
              name: String(board.assignedUserId.name || '').trim(),
            }
          : null,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

function defaultEndFromStart(timeStr) {
  const s = hmToMinutes(timeStr)
  if (s == null) return ''
  const e = s + 30
  const h = Math.floor(e / 60)
  const m = e % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** أسماء الأطباء والأخصائيين (مستخدمون نشطون + أسماء مذكورة في مواعيد محجوزة) */
scheduleRouter.get('/providers', async (_req, res) => {
  try {
    const clinical = await User.find({
      role: {
        $in: [
          'laser',
          'dermatology',
          'dermatology_manager',
          'dermatology_assistant_manager',
          'dental_branch',
          'solarium',
        ],
      },
      active: true,
    })
      .select('name')
      .sort({ name: 1 })
      .lean()
    const fromUsers = clinical.map((u) => u.name).filter(Boolean)
    const fromSlots = await ScheduleSlot.distinct('providerName', { patientId: { $ne: null } })
    const fromSlotsClean = fromSlots.filter(Boolean)
    const merged = new Set([...fromUsers, ...fromSlotsClean])
    const providers = [...merged].sort((a, b) => a.localeCompare(b, 'ar'))
    res.json({ providers })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** خيارات أخصائيي الليزر المعيّنين على الغرف (للاستقبال/المدير) */
scheduleRouter.get('/laser-provider-options', async (_req, res) => {
  try {
    const slotTime = normalizeHm(_req.query.time) || '09:00'
    const rooms = await Room.find({
      $or: [{ morningAssignedUserId: { $ne: null } }, { eveningAssignedUserId: { $ne: null } }, { assignedUserId: { $ne: null } }],
    })
      .populate('morningAssignedUserId', 'name role')
      .populate('eveningAssignedUserId', 'name role')
      .populate('assignedUserId', 'name role')
      .sort({ number: 1 })
      .lean()
    const providers = rooms
      .map((r) => {
        const assigned = pickAssignedForTime(r, slotTime)
        if (!assigned?.name) return null
        return {
          roomNumber: r.number,
          userId: String(assigned._id),
          name: String(assigned.name || '').trim(),
        }
      })
      .filter(Boolean)
      .map((r) => ({
        roomNumber: r.roomNumber,
        userId: r.userId,
        name: r.name,
      }))
    res.json({ providers })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

function slotToDto(s) {
  const o = s.toObject ? s.toObject() : s
  const busy = Boolean(o.patientId)
  const startNorm = normalizeHm(o.time)
  let endTime = defaultEndFromStart(o.time)
  const rawEnd = o.endTime && String(o.endTime).trim()
  if (rawEnd) {
    const en = normalizeHm(rawEnd)
    const sm = hmToMinutes(startNorm)
    const em = hmToMinutes(en)
    if (en && sm != null && em != null && em > sm) endTime = en
  }
  return {
    id: String(o._id),
    businessDate: o.businessDate,
    time: o.time,
    endTime,
    providerName: o.providerName,
    serviceType: SERVICE_TYPES.includes(o.serviceType) ? o.serviceType : 'other',
    roomNumber: Number.isFinite(Number(o.roomNumber)) ? Number(o.roomNumber) : null,
    assignedSpecialistUserId: o.assignedSpecialistUserId ? String(o.assignedSpecialistUserId) : null,
    assignedSpecialistName: String(o.assignedSpecialistName || '').trim(),
    arrivedAt: o.arrivedAt || null,
    arrivedByUserId: o.arrivedByUserId ? String(o.arrivedByUserId) : null,
    arrivedByName: String(o.arrivedByName || '').trim(),
    laserSessionId: o.laserSessionId ? String(o.laserSessionId) : null,
    procedureType: String(o.procedureType || '').trim(),
    status: busy ? 'busy' : 'free',
    patientId: o.patientId ? String(o.patientId) : null,
    patientName: o.patientName || '',
    laserPackageBookingMode: [
      'use_package',
      'outside_package',
      'continue_package',
      'continue_package_with_addon',
      'use_package_with_addon',
    ].includes(String(o.laserPackageBookingMode || '').trim())
      ? String(o.laserPackageBookingMode).trim()
      : '',
  }
}

/** مواعيد محجوزة فقط — لا قالب أوقات فراغ؛ الحجز بأي وقت عبر assign طالما لا تعارض */
scheduleRouter.get('/', async (req, res) => {
  try {
    const businessDate = String(req.query.date || '').trim() || todayBusinessDate()
    const query = {
      businessDate,
      patientId: { $ne: null },
    }
    if (req.user.role === 'dermatology_manager') {
      query.serviceType = 'dermatology'
    }
    const slots = await ScheduleSlot.find(query)
      .sort({ time: 1, providerName: 1 })
      .lean()
    res.json({ businessDate, slots: slots.map(slotToDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/**
 * تعيين موعد في الجدول.
 * @param {boolean} allowWalkInOverlapBypass إن true: مسموح فقط من مسار «وصول بدون موعد» — يتجاهل تداخل الفترات ويزحف الوقت عند تعارض خانة بنفس البداية.
 */
async function runScheduleAssign(req, res, allowWalkInOverlapBypass) {
  try {
    const body = req.body ?? {}
    const businessDate = String(body.businessDate || '').trim() || todayBusinessDate()
    const time = normalizeHm(body.time)
    const endTime = normalizeHm(body.endTime)
    const providerName = String(body.providerName || '').trim()
    const serviceType = normalizeServiceType(body.serviceType)
    if (req.user.role === 'dermatology_manager' && serviceType !== 'dermatology') {
      res.status(403).json({ error: 'رئيس قسم الجلدية يمكنه حجز مواعيد الجلدية فقط' })
      return
    }
    const procedureType = String(body.procedureType || '')
      .trim()
      .slice(0, 200)
    const laserPkgRaw = String(body.laserPackageBookingMode || '').trim()
    const laserPackageBookingMode =
      serviceType === 'laser' &&
      [
        'use_package',
        'outside_package',
        'continue_package',
        'continue_package_with_addon',
        'use_package_with_addon',
      ].includes(laserPkgRaw)
        ? laserPkgRaw
        : ''
    const patientId = body.patientId
    if (!time || !endTime || !providerName || !patientId) {
      res.status(400).json({ error: 'وقت البداية ووقت النهاية والمقدّم والمريض مطلوبان' })
      return
    }
    if (!procedureType) {
      res.status(400).json({ error: 'نوع الإجراء مطلوب' })
      return
    }
    const startMin = hmToMinutes(time)
    let endMin = hmToMinutes(endTime)
    if (startMin == null || endMin == null) {
      res.status(400).json({ error: 'وقت النهاية يجب أن يكون بعد وقت البداية' })
      return
    }
    if (endMin <= startMin) endMin += APPOINTMENT_GRID_END_MIN
    const patient = await Patient.findById(patientId)
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }
    if (serviceType === 'laser' && laserPackageBookingMode) {
      const bookingCtx = await getLaserBookingContextForPatient(patient)
      if (
        laserPackageBookingMode === 'continue_package' ||
        laserPackageBookingMode === 'continue_package_with_addon'
      ) {
        if (!bookingCtx.partialVisit) {
          res.status(400).json({
            error: 'لا توجد جلسة باكج قيد الإكمال لهذا المريض — اختر «جلسة جديدة ضمن الباكج» أو «خارج الباكج».',
          })
          return
        }
      }
      if (
        (laserPackageBookingMode === 'use_package' ||
          laserPackageBookingMode === 'use_package_with_addon') &&
        !bookingCtx.hasFreshPackageSession
      ) {
        res.status(400).json({
          error:
            'لا توجد جلسة باكج جديدة متاحة — استخدم «إكمال المنطقة المتبقية» إن وُجدت جلسة ناقصة، أو «خارج الباكج».',
        })
        return
      }
    }
    const resolved = await resolveProviderAssignment({
      serviceType,
      providerName,
      roomNumberRaw: body.roomNumber,
      timeStr: time,
    })
    if (resolved.error) {
      res.status(400).json({ error: resolved.error })
      return
    }
    if (serviceType === 'skin') {
      const opt = await SkinProcedureOption.findOne({
        name: procedureType.trim(),
        active: { $ne: false },
      }).lean()
      const amount = Math.round(Number(opt?.priceSyp) || 0)
      if (!(amount > 0)) {
        res.status(400).json({
          error:
            'نوع إجراء البشرة غير معرّف أو بلا سعر — اختر من القائمة أو أضِف السعر من إدارة إجراءات البشرة',
        })
        return
      }
    }
    const { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName } = resolved
    const walkInOverride = allowWalkInOverlapBypass === true

    const sameProvSlots = await ScheduleSlot.find({ businessDate, providerName: effectiveProviderName }).lean()
    const findExistingAt = (tStr) => sameProvSlots.find((o) => normalizeHm(o.time) === normalizeHm(tStr)) ?? null

    let assignTime = time
    let assignEndTime = minutesToHm(endMin)
    let startMinCur = startMin
    let endMinCur = endMin
    let existing = findExistingAt(assignTime)

    if (existing?.patientId && String(existing.patientId) !== String(patient._id)) {
      if (!walkInOverride) {
        res.status(409).json({ error: 'هذه الخانة محجوزة لمريض آخر' })
        return
      }
      const duration = endMinCur - startMinCur
      const dayEndMin = APPOINTMENT_GRID_END_MIN
      let shifted = false
      for (let m = startMinCur; m + duration <= dayEndMin; m += 1) {
        const tStr = minutesToHm(m)
        const eStr = minutesToHm(m + duration)
        const ex = findExistingAt(tStr)
        if (!ex || !ex.patientId || String(ex.patientId) === String(patient._id)) {
          assignTime = tStr
          assignEndTime = eStr
          startMinCur = m
          endMinCur = m + duration
          existing = ex
          shifted = true
          break
        }
      }
      if (!shifted) {
        res.status(409).json({
          error: 'تعذر إيجاد وقت غير محجوز على هذا السطر في نفس اليوم — جرّب وقتاً آخر أو غداً.',
        })
        return
      }
    }

    let overlapCheck = { ok: true }
    if (!walkInOverride) {
      overlapCheck = await assertNoOverlapForProvider({
        businessDate,
        providerName: effectiveProviderName,
        startTime: assignTime,
        endTime: assignEndTime,
        ignoreId: existing?._id ?? null,
      })
    }
    if (overlapCheck.error) {
      res.status(409).json({ error: overlapCheck.error })
      return
    }
    const filter = existing ? { _id: existing._id } : { businessDate, time: assignTime, providerName: effectiveProviderName }
    const slot = await ScheduleSlot.findOneAndUpdate(
      filter,
      {
        $set: {
          businessDate,
          time: assignTime,
          endTime: assignEndTime,
          providerName: effectiveProviderName,
          serviceType,
          roomNumber,
          assignedSpecialistUserId,
          assignedSpecialistName,
          procedureType,
          patientId: patient._id,
          patientName: patient.name,
          arrivedAt: null,
          arrivedByUserId: null,
          arrivedByName: '',
          laserSessionId: null,
          laserPackageBookingMode: serviceType === 'laser' ? laserPackageBookingMode : '',
        },
      },
      { new: true, upsert: !existing },
    )
    // Avoid full-document validation on legacy records that may miss newly required fields
    // (e.g. fileNumber), while still updating "lastVisit" for appointment activity.
    await Patient.updateOne({ _id: patient._id }, { $set: { lastVisit: new Date() } })
    await writeAudit({
      user: req.user,
      action: walkInOverride ? 'تعيين موعد لمريض (وصول بدون موعد — تجاوز الفراغ)' : 'تعيين موعد لمريض',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: {
        businessDate,
        time: assignTime,
        endTime: assignEndTime,
        providerName: effectiveProviderName,
        serviceType,
        roomNumber,
        assignedSpecialistName,
        procedureType,
        patientId: String(patient._id),
      },
    })
    if (serviceType === 'skin') {
      const syncRes = await syncSkinAppointmentBillingForSlot(slot, req.user)
      if (syncRes.error) {
        res.status(500).json({ error: syncRes.error })
        return
      }
    }
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    if (e.code === 11000) {
      res.status(400).json({ error: 'تعارض في بيانات الموعد' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
}

/** حجز عادي — يُطبَّق شرط عدم تداخل المواعيد دائماً */
scheduleRouter.post('/assign', loadBusinessDay, requireActiveDay, async (req, res) => {
  await runScheduleAssign(req, res, false)
})

/** وصول بدون موعد (صفحة الاستقبال فقط) — يتجاهل تداخل الفترات؛ لا يُستدعى من حجز الموعد العادي */
scheduleRouter.post(
  '/walk-in-assign',
  loadBusinessDay,
  requireActiveDay,
  requireRoles('reception', 'super_admin'),
  async (req, res) => {
    await runScheduleAssign(req, res, true)
  },
)

scheduleRouter.get('/arrived', async (req, res) => {
  try {
    const businessDate = String(req.query.date || '').trim() || todayBusinessDate()
    const slots = await ScheduleSlot.find({
      businessDate,
      patientId: { $ne: null },
      arrivedAt: { $ne: null },
    })
      .sort({ arrivedAt: -1, time: 1 })
      .lean()
    res.json({ businessDate, slots: slots.map(slotToDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.post('/arrive/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    const slot = await ScheduleSlot.findById(req.params.id)
    if (!slot || !slot.patientId) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    slot.arrivedAt = new Date()
    slot.arrivedByUserId = req.user._id
    slot.arrivedByName = String(req.user.name || '').trim()
    await slot.save()
    await writeAudit({
      user: req.user,
      action: 'تسجيل وصول مريض للعيادة',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate: slot.businessDate, time: slot.time, providerName: slot.providerName },
    })
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.patch('/reschedule/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    if (req.user.role === 'dermatology_manager') {
      res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' })
      return
    }
    const slot = await ScheduleSlot.findById(req.params.id)
    if (!slot || !slot.patientId) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    const body = req.body ?? {}
    const businessDate = String(body.businessDate || slot.businessDate).trim() || slot.businessDate
    const time = normalizeHm(body.time || slot.time)
    const endTime = normalizeHm(body.endTime || slot.endTime)
    const serviceType = normalizeServiceType(body.serviceType || slot.serviceType)
    const requestedProvider = String(body.providerName || slot.providerName || '').trim()
    const procedureType = String(body.procedureType ?? slot.procedureType ?? '')
      .trim()
      .slice(0, 200)
    if (!time || !endTime || !requestedProvider || !procedureType) {
      res.status(400).json({ error: 'بيانات الموعد غير مكتملة' })
      return
    }
    const resolved = await resolveProviderAssignment({
      serviceType,
      providerName: requestedProvider,
      roomNumberRaw: body.roomNumber ?? slot.roomNumber,
      timeStr: time,
    })
    if (resolved.error) {
      res.status(400).json({ error: resolved.error })
      return
    }
    if (serviceType === 'skin') {
      const opt = await SkinProcedureOption.findOne({
        name: procedureType.trim(),
        active: { $ne: false },
      }).lean()
      const amount = Math.round(Number(opt?.priceSyp) || 0)
      if (!(amount > 0)) {
        res.status(400).json({
          error:
            'نوع إجراء البشرة غير معرّف أو بلا سعر — اختر من القائمة أو أضِف السعر من إدارة إجراءات البشرة',
        })
        return
      }
    }
    const { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName } = resolved
    const overlapCheck = await assertNoOverlapForProvider({
      businessDate,
      providerName: effectiveProviderName,
      startTime: time,
      endTime,
      ignoreId: slot._id,
    })
    if (overlapCheck.error) {
      res.status(409).json({ error: overlapCheck.error })
      return
    }
    slot.businessDate = businessDate
    slot.time = time
    slot.endTime = endTime
    slot.providerName = effectiveProviderName
    slot.serviceType = serviceType
    slot.roomNumber = roomNumber
    slot.assignedSpecialistUserId = assignedSpecialistUserId
    slot.assignedSpecialistName = assignedSpecialistName
    slot.procedureType = procedureType
    await slot.save()
    await writeAudit({
      user: req.user,
      action: 'تغيير وقت موعد',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate, time, endTime, providerName: effectiveProviderName, procedureType },
    })
    if (serviceType === 'skin') {
      const syncRes = await syncSkinAppointmentBillingForSlot(slot, req.user)
      if (syncRes.error) {
        res.status(400).json({ error: syncRes.error })
        return
      }
    } else {
      await deleteSkinBillingForScheduleSlotId(slot._id)
    }
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.patch('/provider/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    if (req.user.role === 'dermatology_manager') {
      res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' })
      return
    }
    const slot = await ScheduleSlot.findById(req.params.id)
    if (!slot || !slot.patientId) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    const body = req.body ?? {}
    const serviceType = normalizeServiceType(body.serviceType || slot.serviceType)
    const requestedProvider = String(body.providerName || slot.providerName || '').trim()
    const resolved = await resolveProviderAssignment({
      serviceType,
      providerName: requestedProvider,
      roomNumberRaw: body.roomNumber ?? slot.roomNumber,
      timeStr: slot.time,
    })
    if (resolved.error) {
      res.status(400).json({ error: resolved.error })
      return
    }
    const { effectiveProviderName, roomNumber, assignedSpecialistUserId, assignedSpecialistName } = resolved
    const overlapCheck = await assertNoOverlapForProvider({
      businessDate: slot.businessDate,
      providerName: effectiveProviderName,
      startTime: slot.time,
      endTime: normalizeHm(slot.endTime || defaultEndFromStart(slot.time)),
      ignoreId: slot._id,
    })
    if (overlapCheck.error) {
      res.status(409).json({ error: overlapCheck.error })
      return
    }
    slot.providerName = effectiveProviderName
    slot.serviceType = serviceType
    slot.roomNumber = roomNumber
    slot.assignedSpecialistUserId = assignedSpecialistUserId
    slot.assignedSpecialistName = assignedSpecialistName
    await slot.save()
    await writeAudit({
      user: req.user,
      action: 'تغيير مقدم الموعد',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { providerName: effectiveProviderName, serviceType, roomNumber, assignedSpecialistName },
    })
    const stAfter = normalizeServiceType(slot.serviceType)
    if (stAfter === 'skin') {
      const syncRes = await syncSkinAppointmentBillingForSlot(slot, req.user)
      if (syncRes.error) {
        res.status(400).json({ error: syncRes.error })
        return
      }
    } else {
      await deleteSkinBillingForScheduleSlotId(slot._id)
    }
    res.json({ slot: slotToDto(slot) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.delete('/cancel/:id', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    if (req.user.role === 'dermatology_manager') {
      res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' })
      return
    }
    const slot = await ScheduleSlot.findById(req.params.id).lean()
    if (!slot) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    if (slot.patientId) {
      try {
        await notifyAppointmentCancelled(slot, req.user)
      } catch (notifyErr) {
        console.error('notifyAppointmentCancelled:', notifyErr)
      }
    }
    await deleteSkinBillingForScheduleSlotId(slot._id)
    await ScheduleSlot.deleteOne({ _id: slot._id })
    await writeAudit({
      user: req.user,
      action: 'إلغاء موعد',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate: slot.businessDate, time: slot.time, providerName: slot.providerName },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

scheduleRouter.post('/clear', loadBusinessDay, requireActiveDay, async (req, res) => {
  try {
    if (req.user.role === 'dermatology_manager') {
      res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' })
      return
    }
    const body = req.body ?? {}
    const businessDate = String(body.businessDate || '').trim() || todayBusinessDate()
    const time = normalizeHm(body.time)
    const providerName = String(body.providerName || '').trim()
    if (!time || !providerName) {
      res.status(400).json({ error: 'الوقت والمقدّم مطلوبان' })
      return
    }
    const sameProvSlots = await ScheduleSlot.find({ businessDate, providerName }).lean()
    const hit = sameProvSlots.find((o) => normalizeHm(o.time) === time)
    if (!hit?._id) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    await deleteSkinBillingForScheduleSlotId(hit._id)
    const slot = await ScheduleSlot.findByIdAndDelete(hit._id)
    if (!slot) {
      res.status(404).json({ error: 'الموعد غير موجود' })
      return
    }
    if (slot.patientId) {
      try {
        await notifyAppointmentCancelled(slot.toObject ? slot.toObject() : slot, req.user)
      } catch (notifyErr) {
        console.error('notifyAppointmentCancelled:', notifyErr)
      }
    }
    await writeAudit({
      user: req.user,
      action: 'إلغاء موعد وحذف السجل',
      entityType: 'ScheduleSlot',
      entityId: slot._id,
      details: { businessDate, time, providerName },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
