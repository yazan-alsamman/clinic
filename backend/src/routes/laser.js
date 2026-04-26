import { Router } from 'express'
import { LaserAreaCatalog } from '../models/LaserAreaCatalog.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { BillingItem } from '../models/BillingItem.js'
import { ScheduleSlot } from '../models/ScheduleSlot.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { LaserMonthlyExpenses } from '../models/LaserMonthlyExpenses.js'
import { LaserSettings } from '../models/LaserSettings.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { nextSequence } from '../models/Counter.js'
import { writeAudit } from '../utils/audit.js'
import { postLaserSessionIfCompleted } from '../services/postingService.js'
import { todayBusinessDate } from '../utils/date.js'
import { round2 } from '../utils/money.js'

export const laserRouter = Router()
laserRouter.use(authMiddleware, loadBusinessDay)

/** استقبال: كتالوج وجلسات المريض من ملف المريض — وليس لوحة «جلسات اليوم» */
const LASER_READ = ['super_admin', 'laser', 'reception']
const LASER_TODAY_PAGE = ['super_admin', 'laser']
/** تسجيل جلسة من ملف المريض: ليزر + مدير (الاستقبال يعرض السجل فقط من نظرة عامة) */
const LASER_SESSION_CREATE = ['super_admin', 'laser', 'reception']
const LASER_STATUS_VALUES = ['scheduled', 'in_progress', 'completed_pending_collection', 'completed']
const LASER_PROCEDURE_READ = ['super_admin', 'reception', 'laser']
const LASER_PROCEDURE_GROUPS = {
  face: 'الوجه',
  upper: 'الجزء العلوي',
  lower: 'الجزء السفلي',
  offers: 'العروض التوفيرية',
}
const LASER_PROCEDURE_GROUP_ORDER = ['face', 'upper', 'lower', 'offers']

const defaultProcedureOptions = [
  ['face', 'area', 'الوجه', 55000],
  ['face', 'area', 'الجبين', 55000],
  ['face', 'area', 'الذقن', 55000],
  ['face', 'area', 'الأنف', 55000],
  ['face', 'area', 'الشارب', 55000],
  ['face', 'area', 'السالف', 55000],
  ['face', 'area', 'الرقبة', 55000],
  ['face', 'area', 'نقرة', 55000],
  ['upper', 'area', 'إبطين', 55000],
  ['upper', 'area', 'ساعدين', 55000],
  ['upper', 'area', 'زندين', 55000],
  ['upper', 'area', 'كفين', 55000],
  ['upper', 'area', 'صدر', 55000],
  ['upper', 'area', 'بطن', 55000],
  ['upper', 'area', 'ظهر', 55000],
  ['upper', 'area', 'أسفل الظهر', 55000],
  ['upper', 'area', 'حول الحلمة', 55000],
  ['upper', 'area', 'خط البطن', 55000],
  ['upper', 'area', 'خط الصدر', 55000],
  ['upper', 'area', 'خط الظهر', 55000],
  ['lower', 'area', 'بكيني', 55000],
  ['lower', 'area', 'حواف بكيني', 55000],
  ['lower', 'area', 'ديريير', 55000],
  ['lower', 'area', 'مثلث فخدين', 55000],
  ['lower', 'area', 'فخذين', 55000],
  ['lower', 'area', 'ساقين', 55000],
  ['lower', 'area', 'مشط قدم', 55000],
  ['lower', 'area', 'ركبة', 55000],
  ['offers', 'offer', 'رجلين كاملين', 55000],
  ['offers', 'offer', 'ساعدين و ساقين', 55000],
  ['offers', 'offer', 'يدين كاملين', 55000],
  ['offers', 'offer', 'فخذين و زندين', 55000],
  ['offers', 'offer', 'إبطين و بكيني', 55000],
  ['offers', 'offer', 'جسم كامل', 55000],
]

function slugifyArabic(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function optionToDto(row) {
  return {
    id: String(row._id),
    code: row.code,
    name: row.name,
    groupId: row.groupId,
    groupTitle: row.groupTitle,
    kind: row.kind,
    priceSyp: Number(row.priceSyp) || 0,
    active: Boolean(row.active),
    sortOrder: Number(row.sortOrder) || 0,
  }
}

async function ensureDefaultLaserProcedureOptions() {
  const count = await LaserProcedureOption.estimatedDocumentCount()
  if (count > 0) return
  const rows = defaultProcedureOptions.map(([groupId, kind, name, priceSyp], idx) => ({
    code: `${groupId}-${slugifyArabic(name)}-${idx + 1}`,
    name,
    groupId,
    groupTitle: LASER_PROCEDURE_GROUPS[groupId],
    kind,
    priceSyp,
    active: true,
    sortOrder: idx + 1,
  }))
  await LaserProcedureOption.insertMany(rows, { ordered: false })
}
function parsePositiveSypInteger(raw) {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function parseNonNegativeSypInteger(raw) {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function sumLaserExpenseLinesSyp(lines) {
  return Math.round((lines || []).reduce((s, l) => s + (Number(l.amountSyp) || 0), 0))
}

function parseShotCount(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const normalized = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '.')
  const num = Number.parseFloat(normalized)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.round(num)
}

function resolveReportMonth(rawMonth, fallbackBusinessDate) {
  const m = String(rawMonth || '').trim()
  if (/^\d{4}-\d{2}$/.test(m)) return m
  const bd = String(fallbackBusinessDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(bd)) return bd.slice(0, 7)
  return todayBusinessDate().slice(0, 7)
}

async function getOrCreateLaserSettings() {
  let doc = await LaserSettings.findById('default').lean()
  if (!doc) {
    await LaserSettings.create({ _id: 'default', pricePerPulseSyp: 0 })
    doc = { _id: 'default', pricePerPulseSyp: 0 }
  }
  return doc
}

function findActiveLaserPackage(patientLike) {
  const packages = Array.isArray(patientLike?.sessionPackages) ? patientLike.sessionPackages : []
  for (const pkg of packages) {
    if (String(pkg?.department || '') !== 'laser') continue
    const sessions = Array.isArray(pkg?.sessions) ? pkg.sessions : []
    const available = sessions.find((s) => !s?.linkedLaserSessionId)
    if (available) {
      return { pkg, session: available }
    }
  }
  return null
}

laserRouter.get('/catalog', async (req, res) => {
  try {
    if (!LASER_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const rows = await LaserAreaCatalog.find({ active: true }).sort({
      categoryId: 1,
      sortOrder: 1,
    })
    const byCat = new Map()
    for (const r of rows) {
      if (!byCat.has(r.categoryId)) {
        byCat.set(r.categoryId, { id: r.categoryId, title: r.categoryTitle, areas: [] })
      }
      byCat.get(r.categoryId).areas.push({
        id: r.areaId,
        label: r.label,
        minutes: r.minutes,
      })
    }
    res.json({ categories: [...byCat.values()] })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/pricing-settings', async (req, res) => {
  try {
    if (!LASER_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const doc = await getOrCreateLaserSettings()
    res.json({
      pricePerPulseSyp: Math.max(0, Math.round(Number(doc.pricePerPulseSyp) || 0)),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.patch('/pricing-settings', requireRoles('super_admin'), async (req, res) => {
  try {
    const pricePerPulseSyp = Math.max(0, Math.round(Number(req.body?.pricePerPulseSyp) || 0))
    await LaserSettings.findOneAndUpdate(
      { _id: 'default' },
      { $set: { pricePerPulseSyp } },
      { upsert: true, new: true },
    )
    await writeAudit({
      user: req.user,
      action: 'تحديث سعر ضربة الليزر (محاسبة بعدد الضربات)',
      entityType: 'LaserSettings',
      entityId: 'default',
      details: { pricePerPulseSyp },
    })
    res.json({ pricePerPulseSyp })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/procedure-options', async (req, res) => {
  try {
    if (!LASER_PROCEDURE_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    await ensureDefaultLaserProcedureOptions()
    const includeInactive = req.user.role === 'super_admin' && String(req.query.includeInactive || '') === '1'
    const filter = includeInactive ? {} : { active: true }
    const rows = await LaserProcedureOption.find(filter).sort({ groupId: 1, sortOrder: 1, name: 1 }).lean()
    const groupsMap = new Map()
    for (const row of rows) {
      if (!groupsMap.has(row.groupId)) {
        groupsMap.set(row.groupId, {
          id: row.groupId,
          title: row.groupTitle || LASER_PROCEDURE_GROUPS[row.groupId] || row.groupId,
          items: [],
        })
      }
      groupsMap.get(row.groupId).items.push(optionToDto(row))
    }
    const rank = new Map(LASER_PROCEDURE_GROUP_ORDER.map((id, idx) => [id, idx]))
    const groups = [...groupsMap.values()].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : 999
      const rb = rank.has(b.id) ? rank.get(b.id) : 999
      if (ra !== rb) return ra - rb
      return String(a.title || '').localeCompare(String(b.title || ''), 'ar')
    })
    res.json({ groups })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.post('/procedure-options', requireRoles('super_admin'), async (req, res) => {
  try {
    const body = req.body ?? {}
    const name = String(body.name || '')
      .trim()
      .slice(0, 120)
    const groupId = String(body.groupId || '').trim()
    const kind = String(body.kind || 'area').trim() === 'offer' ? 'offer' : 'area'
    const priceSyp = Number(body.priceSyp)
    const sortOrder = Number(body.sortOrder)
    if (!name) {
      res.status(400).json({ error: 'اسم المنطقة/العرض مطلوب' })
      return
    }
    if (!LASER_PROCEDURE_GROUPS[groupId]) {
      res.status(400).json({ error: 'القسم غير صالح' })
      return
    }
    if (!Number.isFinite(priceSyp) || priceSyp < 0) {
      res.status(400).json({ error: 'السعر بالليرة غير صالح' })
      return
    }
    const option = await LaserProcedureOption.create({
      code: `${groupId}-${slugifyArabic(name)}-${Date.now()}`,
      name,
      groupId,
      groupTitle: LASER_PROCEDURE_GROUPS[groupId],
      kind,
      priceSyp,
      active: body.active !== false,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 999,
    })
    await writeAudit({
      user: req.user,
      action: 'إضافة منطقة/عرض ليزر',
      entityType: 'LaserProcedureOption',
      entityId: option._id,
      details: optionToDto(option),
    })
    res.status(201).json({ option: optionToDto(option) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.patch('/procedure-options/:id', requireRoles('super_admin'), async (req, res) => {
  try {
    const option = await LaserProcedureOption.findById(req.params.id)
    if (!option) {
      res.status(404).json({ error: 'العنصر غير موجود' })
      return
    }
    const body = req.body ?? {}
    if (body.name != null) option.name = String(body.name).trim().slice(0, 120)
    if (body.groupId != null) {
      const groupId = String(body.groupId).trim()
      if (!LASER_PROCEDURE_GROUPS[groupId]) {
        res.status(400).json({ error: 'القسم غير صالح' })
        return
      }
      option.groupId = groupId
      option.groupTitle = LASER_PROCEDURE_GROUPS[groupId]
    }
    if (body.kind != null) option.kind = String(body.kind).trim() === 'offer' ? 'offer' : 'area'
    if (body.priceSyp != null) {
      const priceSyp = Number(body.priceSyp)
      if (!Number.isFinite(priceSyp) || priceSyp < 0) {
        res.status(400).json({ error: 'السعر بالليرة غير صالح' })
        return
      }
      option.priceSyp = priceSyp
    }
    if (body.sortOrder != null) {
      const so = Number(body.sortOrder)
      if (Number.isFinite(so)) option.sortOrder = so
    }
    if (body.active != null) option.active = Boolean(body.active)
    if (!option.name) {
      res.status(400).json({ error: 'اسم المنطقة/العرض مطلوب' })
      return
    }
    await option.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل منطقة/عرض ليزر',
      entityType: 'LaserProcedureOption',
      entityId: option._id,
      details: optionToDto(option),
    })
    res.json({ option: optionToDto(option) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.delete('/procedure-options/:id', requireRoles('super_admin'), async (req, res) => {
  try {
    const option = await LaserProcedureOption.findByIdAndDelete(req.params.id)
    if (!option) {
      res.status(404).json({ error: 'العنصر غير موجود' })
      return
    }
    await writeAudit({
      user: req.user,
      action: 'حذف منطقة/عرض ليزر',
      entityType: 'LaserProcedureOption',
      entityId: option._id,
      details: { name: option.name, groupId: option.groupId },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/sessions/today', async (req, res) => {
  try {
    if (!LASER_TODAY_PAGE.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const sessions = await LaserSession.find({
      createdAt: { $gte: start, $lt: end },
    })
      .populate('patientId', 'name')
      .populate('operatorUserId', 'name')
      .sort({ createdAt: -1 })
    res.json({
      sessions: sessions.map((s) => ({
        id: String(s._id),
        treatmentNumber: s.treatmentNumber,
        patientName: s.patientId?.name ?? '',
        patientId: String(s.patientId?._id ?? s.patientId),
        room: s.room,
        laserType: s.laserType,
        status: s.status,
        createdAt: s.createdAt,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/shots-daily', requireRoles('super_admin'), async (req, res) => {
  try {
    const date = String(req.query.date || '').trim() || req.businessDate || todayBusinessDate()
    const specialists = await User.find({ role: 'laser' }).select('_id name active').sort({ name: 1 }).lean()
    const specialistIds = specialists.map((x) => x._id)
    const clinicalRows =
      specialistIds.length > 0
        ? await ClinicalSession.find({
            department: 'laser',
            businessDate: date,
            providerUserId: { $in: specialistIds },
          })
            .select('_id providerUserId')
            .lean()
        : []
    const sessionIds = clinicalRows.map((x) => x._id)
    const doneStatuses = ['completed', 'completed_pending_collection']
    const laserRows =
      sessionIds.length > 0
        ? await LaserSession.find({
            clinicalSessionId: { $in: sessionIds },
            status: { $in: doneStatuses },
          })
            .select('operatorUserId shotCount room')
            .lean()
        : []

    const totals = new Map()
    const roomTotals = { room1Shots: 0, room2Shots: 0 }
    for (const row of laserRows) {
      const shotCount = parseShotCount(row.shotCount)
      const room = String(row.room || '').trim()
      if (room === '1') roomTotals.room1Shots += shotCount
      if (room === '2') roomTotals.room2Shots += shotCount

      const uid = String(row.operatorUserId || '')
      if (!uid) continue
      const prev = totals.get(uid) || { totalShots: 0, sessionsCount: 0 }
      prev.totalShots += shotCount
      prev.sessionsCount += 1
      totals.set(uid, prev)
    }

    const rows = specialists.map((sp) => {
      const current = totals.get(String(sp._id)) || { totalShots: 0, sessionsCount: 0 }
      return {
        userId: String(sp._id),
        name: String(sp.name || '').trim() || '—',
        active: sp.active !== false,
        totalShots: current.totalShots,
        sessionsCount: current.sessionsCount,
      }
    })

    const bd = await BusinessDay.findOne({ businessDate: date })
      .select('room1MeterStart room2MeterStart room1MeterEnd room2MeterEnd')
      .lean()
    function meterReconciliationRow(meterStart, meterEnd, shotsInDay) {
      const s = meterStart != null ? Number(meterStart) : NaN
      const e = meterEnd != null ? Number(meterEnd) : NaN
      const sh = Number(shotsInDay) || 0
      if (!Number.isFinite(s) || !Number.isFinite(e)) {
        return { complete: false, delta: null, matched: null }
      }
      const delta = s + sh - e
      const matched = Math.abs(delta) < 1e-6
      return { complete: true, delta, matched }
    }
    const meterReconciliation = {
      room1: meterReconciliationRow(bd?.room1MeterStart, bd?.room1MeterEnd, roomTotals.room1Shots),
      room2: meterReconciliationRow(bd?.room2MeterStart, bd?.room2MeterEnd, roomTotals.room2Shots),
    }

    res.json({ date, rows, roomTotals, meterReconciliation })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** تفصيل تحصيل ليزر: كاش مقابل بنوك (من BillingPayment) — ل.س و USD حسب عملة التحصيل؛ جلسة ليزر completed فقط */
async function buildLaserPaymentBreakdown(businessDateFilter) {
  const empty = () => ({
    cash: { totalSyp: 0, totalUsd: 0 },
    banks: [],
    totals: { totalSyp: 0, totalUsd: 0 },
  })
  const itemFilter = { department: 'laser', status: 'paid', businessDate: businessDateFilter }
  const itemsRaw = await BillingItem.find(itemFilter).select('_id businessDate clinicalSessionId').lean()
  if (!itemsRaw.length) {
    return empty()
  }
  const cids = [...new Set(itemsRaw.map((i) => i.clinicalSessionId).filter(Boolean))]
  const completedLasers = await LaserSession.find({
    clinicalSessionId: { $in: cids },
    status: 'completed',
  })
    .select('clinicalSessionId')
    .lean()
  const completedSet = new Set(completedLasers.map((l) => String(l.clinicalSessionId || '')))
  const items = itemsRaw.filter((i) => completedSet.has(String(i.clinicalSessionId || '')))
  if (!items.length) {
    return empty()
  }
  const itemByPayment = new Map(items.map((i) => [String(i._id), i]))
  const payments = await BillingPayment.find({ billingItemId: { $in: items.map((i) => i._id) } }).lean()

  let cashSyp = 0
  let cashUsd = 0
  const bankMap = new Map()

  for (const p of payments) {
    if (!itemByPayment.get(String(p.billingItemId))) continue
    const payCur = String(p.payCurrency || 'SYP').toUpperCase() === 'USD' ? 'USD' : 'SYP'
    const sypPart = Math.round(Number(p.receivedAmountSyp) || 0)
    const usdPart = round2(Number(p.receivedAmountUsd) || 0)
    const refSyp = Math.round(Number(p.patientRefundSyp) || 0)
    const refUsd = round2(Number(p.patientRefundUsd) || 0)
    const usdNet = payCur === 'USD' ? round2(usdPart - refUsd) : usdPart
    const sypAdjUsdPay = payCur === 'USD' ? -refSyp : 0
    const channel = p.paymentChannel === 'bank' ? 'bank' : 'cash'
    if (channel === 'cash') {
      if (payCur === 'USD') {
        cashUsd += usdNet
        cashSyp += sypAdjUsdPay
      } else {
        cashSyp += sypPart
      }
    } else {
      const label = String(p.bankName || '').trim() || 'بنك'
      const cur = bankMap.get(label) || { bankName: label, totalSyp: 0, totalUsd: 0 }
      if (payCur === 'USD') {
        cur.totalUsd = round2(cur.totalUsd + usdNet)
        cur.totalSyp += sypAdjUsdPay
      } else {
        cur.totalSyp += sypPart
      }
      bankMap.set(label, cur)
    }
  }

  const banks = [...bankMap.values()].sort((a, b) => String(a.bankName).localeCompare(String(b.bankName), 'ar'))
  const totalsSyp = cashSyp + banks.reduce((s, b) => s + (Math.round(Number(b.totalSyp)) || 0), 0)
  const totalsUsd = round2(cashUsd + banks.reduce((s, b) => s + (Number(b.totalUsd) || 0), 0))
  return {
    cash: { totalSyp: cashSyp, totalUsd: round2(cashUsd) },
    banks,
    totals: { totalSyp: totalsSyp, totalUsd: totalsUsd },
  }
}

/**
 * صفوف تقرير مالية الليزر: بند مدفوع + جلسة ليزر بحالة completed فقط
 * (لا يُحسب completed_pending_collection ولا غير المحصّل).
 * @param {string|RegExp} businessDateFilter
 */
async function buildLaserFinanceRowsBySpecialist(businessDateFilter) {
  const specialists = await User.find({ role: 'laser' }).select('_id name active').sort({ name: 1 }).lean()
  const specialistIdSet = new Set(specialists.map((s) => String(s._id)))

  const paidItems = await BillingItem.find({
    department: 'laser',
    status: 'paid',
    businessDate: businessDateFilter,
  })
    .select('clinicalSessionId providerUserId amountDueSyp')
    .lean()

  if (!paidItems.length) {
    const rows = specialists.map((sp) => ({
      userId: String(sp._id),
      name: String(sp.name || '').trim() || '—',
      active: sp.active !== false,
      totalAmountSyp: 0,
      sessionsCount: 0,
    }))
    return { rows }
  }

  const clinicalIds = [...new Set(paidItems.map((i) => i.clinicalSessionId).filter(Boolean))]
  const completedLasers = await LaserSession.find({
    clinicalSessionId: { $in: clinicalIds },
    status: 'completed',
  })
    .select('clinicalSessionId')
    .lean()
  const completedClinicalIdSet = new Set(completedLasers.map((l) => String(l.clinicalSessionId || '')))

  const totals = new Map()
  for (const bi of paidItems) {
    if (!completedClinicalIdSet.has(String(bi.clinicalSessionId || ''))) continue
    const uid = String(bi.providerUserId || '')
    if (!specialistIdSet.has(uid)) continue
    const prev = totals.get(uid) || { totalAmountSyp: 0, sessionsCount: 0 }
    prev.totalAmountSyp += Number(bi.amountDueSyp) || 0
    prev.sessionsCount += 1
    totals.set(uid, prev)
  }

  const rows = specialists.map((sp) => {
    const current = totals.get(String(sp._id)) || { totalAmountSyp: 0, sessionsCount: 0 }
    return {
      userId: String(sp._id),
      name: String(sp.name || '').trim() || '—',
      active: sp.active !== false,
      totalAmountSyp: Math.round(current.totalAmountSyp),
      sessionsCount: current.sessionsCount,
    }
  })
  return { rows }
}

laserRouter.get('/finance-daily', requireRoles('super_admin'), async (req, res) => {
  try {
    const date = String(req.query.date || '').trim() || req.businessDate || todayBusinessDate()
    const { rows } = await buildLaserFinanceRowsBySpecialist(date)
    const top = [...rows].sort((a, b) => b.totalAmountSyp - a.totalAmountSyp)[0] || null
    const laserPaymentBreakdown = await buildLaserPaymentBreakdown(date)
    const bdRate = await BusinessDay.findOne({ businessDate: date }).select('usdSypRate').lean()
    const r = bdRate?.usdSypRate
    const usdSypRate =
      r != null && Number.isFinite(Number(r)) && Number(r) > 0 ? Number(r) : null
    res.json({
      date,
      rows,
      topSpecialist: top ? { userId: top.userId, name: top.name, totalAmountSyp: top.totalAmountSyp } : null,
      usdSypRate,
      laserPaymentBreakdown,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/shots-monthly', requireRoles('super_admin'), async (req, res) => {
  try {
    const month = resolveReportMonth(req.query.month, req.businessDate || todayBusinessDate())
    const specialists = await User.find({ role: 'laser' }).select('_id name active').sort({ name: 1 }).lean()
    const specialistIds = specialists.map((x) => x._id)
    const clinicalRows =
      specialistIds.length > 0
        ? await ClinicalSession.find({
            department: 'laser',
            businessDate: new RegExp(`^${month}-`),
            providerUserId: { $in: specialistIds },
          })
            .select('_id providerUserId')
            .lean()
        : []
    const sessionIds = clinicalRows.map((x) => x._id)
    const doneStatuses = ['completed', 'completed_pending_collection']
    const laserRows =
      sessionIds.length > 0
        ? await LaserSession.find({
            clinicalSessionId: { $in: sessionIds },
            status: { $in: doneStatuses },
          })
            .select('operatorUserId shotCount room')
            .lean()
        : []

    const totals = new Map()
    const roomTotals = { room1Shots: 0, room2Shots: 0 }
    for (const row of laserRows) {
      const shotCount = parseShotCount(row.shotCount)
      const room = String(row.room || '').trim()
      if (room === '1') roomTotals.room1Shots += shotCount
      if (room === '2') roomTotals.room2Shots += shotCount

      const uid = String(row.operatorUserId || '')
      if (!uid) continue
      const prev = totals.get(uid) || { totalShots: 0, sessionsCount: 0 }
      prev.totalShots += shotCount
      prev.sessionsCount += 1
      totals.set(uid, prev)
    }

    const rows = specialists.map((sp) => {
      const current = totals.get(String(sp._id)) || { totalShots: 0, sessionsCount: 0 }
      return {
        userId: String(sp._id),
        name: String(sp.name || '').trim() || '—',
        active: sp.active !== false,
        totalShots: current.totalShots,
        sessionsCount: current.sessionsCount,
      }
    })

    res.json({ month, rows, roomTotals })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/finance-monthly', requireRoles('super_admin'), async (req, res) => {
  try {
    const month = resolveReportMonth(req.query.month, req.businessDate || todayBusinessDate())
    const monthRe = new RegExp(`^${month}-`)
    const { rows } = await buildLaserFinanceRowsBySpecialist(monthRe)
    const top = [...rows].sort((a, b) => b.totalAmountSyp - a.totalAmountSyp)[0] || null
    const totalSessionRevenueSyp = Math.round(rows.reduce((s, r) => s + (Number(r.totalAmountSyp) || 0), 0))
    const expDoc = await LaserMonthlyExpenses.findOne({ month }).select('lines').lean()
    const totalExpensesSyp = sumLaserExpenseLinesSyp(expDoc?.lines)
    const netProfitSyp = totalSessionRevenueSyp - totalExpensesSyp
    const laserPaymentBreakdown = await buildLaserPaymentBreakdown(monthRe)
    res.json({
      month,
      rows,
      topSpecialist: top ? { userId: top.userId, name: top.name, totalAmountSyp: top.totalAmountSyp } : null,
      totalSessionRevenueSyp,
      totalExpensesSyp,
      netProfitSyp,
      laserPaymentBreakdown,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.get('/monthly-expenses', requireRoles('super_admin'), async (req, res) => {
  try {
    const month = resolveReportMonth(req.query.month, req.businessDate || todayBusinessDate())
    const doc = await LaserMonthlyExpenses.findOne({ month }).lean()
    const lines = (doc?.lines || []).map((l) => ({
      id: String(l._id),
      reason: String(l.reason || '').trim(),
      amountSyp: Math.round(Number(l.amountSyp) || 0),
    }))
    const totalExpensesSyp = sumLaserExpenseLinesSyp(lines)
    res.json({ month, lines, totalExpensesSyp })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.put('/monthly-expenses', requireRoles('super_admin'), async (req, res) => {
  try {
    const month = resolveReportMonth(req.body?.month, req.businessDate || todayBusinessDate())
    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : []
    if (rawLines.length > 300) {
      res.status(400).json({ error: 'عدد الصفوف كبير جداً' })
      return
    }
    const lines = rawLines.map((row) => ({
      reason: String(row?.reason ?? '').trim().slice(0, 500),
      amountSyp: Math.max(0, Math.round(Number(row?.amountSyp) || 0)),
    }))
    const doc = await LaserMonthlyExpenses.findOneAndUpdate(
      { month },
      { $set: { lines, updatedBy: req.user._id } },
      { upsert: true, new: true },
    ).lean()
    const outLines = (doc?.lines || []).map((l) => ({
      id: String(l._id),
      reason: String(l.reason || '').trim(),
      amountSyp: Math.round(Number(l.amountSyp) || 0),
    }))
    const totalExpensesSyp = sumLaserExpenseLinesSyp(outLines)
    await writeAudit({
      user: req.user,
      action: 'تحديث مصاريف ليزر شهرية',
      entityType: 'LaserMonthlyExpenses',
      entityId: month,
      details: { linesCount: outLines.length, totalExpensesSyp },
    })
    res.json({ month, lines: outLines, totalExpensesSyp })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.patch(
  '/sessions/:id/status',
  requireActiveDay,
  requireRoles('super_admin', 'laser'),
  async (req, res) => {
    try {
      const status = String(req.body?.status ?? '').trim()
      if (!LASER_STATUS_VALUES.includes(status)) {
        res.status(400).json({ error: 'حالة غير صالحة' })
        return
      }
      const s = await LaserSession.findById(req.params.id)
      if (!s) {
        res.status(404).json({ error: 'الجلسة غير موجودة' })
        return
      }
      if (status === 'completed_pending_collection' && !s.billingItemId) {
        res.status(400).json({ error: 'هذه الحالة مخصصة لجلسات لها بند تحصيل' })
        return
      }

      let nextStatus = status
      if (status === 'completed' && s.billingItemId) {
        const bi = await BillingItem.findById(s.billingItemId).lean()
        if (bi?.status === 'paid') {
          nextStatus = 'completed'
        } else {
          nextStatus = 'completed_pending_collection'
        }
      }

      const prev = s.status
      s.status = nextStatus
      await s.save()
      if (nextStatus === 'completed' && !s.billingItemId) {
        try {
          await postLaserSessionIfCompleted(s, req.user._id)
        } catch (postErr) {
          console.error('accounting post laser:', postErr)
        }
      }
      await writeAudit({
        user: req.user,
        action: 'تغيير حالة جلسة ليزر',
        entityType: 'LaserSession',
        entityId: s._id,
        details: { from: prev, to: nextStatus },
      })
      res.json({
        session: {
          id: String(s._id),
          status: s.status,
          treatmentNumber: s.treatmentNumber,
        },
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

laserRouter.get('/sessions', async (req, res) => {
  try {
    if (!LASER_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const patientId = req.query.patientId
    if (!patientId) {
      res.status(400).json({ error: 'patientId مطلوب' })
      return
    }
    const list = await LaserSession.find({ patientId }).sort({ createdAt: -1 })
    res.json({ sessions: list })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.post('/sessions', requireActiveDay, requireRoles(...LASER_SESSION_CREATE), async (req, res) => {
  try {
    const body = req.body ?? {}
    const patient = await Patient.findById(body.patientId)
    if (!patient) {
      res.status(404).json({ error: 'المريض غير موجود' })
      return
    }

    const packageMatch = findActiveLaserPackage(patient)
    const isPackageSession = Boolean(packageMatch)
    const discountPercent = isPackageSession ? 0 : Math.min(100, Math.max(0, Number(body.discountPercent) || 0))

    /** جلسة باكج: المبلغ المطلوب = مناطق خارج الباكج فقط (ليرة) */
    let packageAddOnGrossSyp = 0
    if (isPackageSession) {
      packageAddOnGrossSyp = parseNonNegativeSypInteger(body.additionalCostSyp)
    }

    const chargeByPulseCount = !isPackageSession && Boolean(body.chargeByPulseCount)
    let costGrossSyp = 0
    if (isPackageSession) {
      costGrossSyp = packageAddOnGrossSyp
    } else if (chargeByPulseCount) {
      const settings = await getOrCreateLaserSettings()
      const ppuSyp = Math.max(0, Math.round(Number(settings.pricePerPulseSyp) || 0))
      const shots = parseShotCount(body.shotCount)
      if (!(shots > 0)) {
        res.status(400).json({
          error: 'عند تفعيل «محاسبة على عدد الضربات» يجب إدخال عدد ضربات أكبر من صفر.',
        })
        return
      }
      if (!(ppuSyp > 0)) {
        res.status(400).json({
          error:
            'سعر الضربة غير محدد — يحدده المدير في «الغرف وتعيين أخصائيي الليزر» ضمن قسم أسعار المناطق والعروض.',
        })
        return
      }
      costGrossSyp = ppuSyp * shots
    } else {
      costGrossSyp = parsePositiveSypInteger(body.costSyp)
    }
    if (!isPackageSession && !(costGrossSyp > 0)) {
      res.status(400).json({ error: 'أدخل المبلغ الإجمالي بالليرة (قيمة أكبر من صفر)' })
      return
    }
    const amountDueSyp = isPackageSession
      ? Math.round(packageAddOnGrossSyp)
      : Math.round(costGrossSyp * (1 - discountPercent / 100))
    if (!isPackageSession && amountDueSyp <= 0) {
      res.status(400).json({ error: 'المبلغ بعد الحسم يجب أن يكون أكبر من صفر' })
      return
    }

    const areaIds = Array.isArray(body.areaIds) ? body.areaIds.map(String) : []
    const manualRaw = Array.isArray(body.manualAreaLabels) ? body.manualAreaLabels : []
    const manualAreaLabels = [
      ...new Set(
        manualRaw
          .map((x) => String(x ?? '').trim().slice(0, 120))
          .filter(Boolean),
      ),
    ].slice(0, 20)

    const addonRaw = Array.isArray(body.addonManualLabels) ? body.addonManualLabels : []
    const addonManualLabels = [
      ...new Set(
        addonRaw
          .map((x) => String(x ?? '').trim().slice(0, 120))
          .filter(Boolean),
      ),
    ].slice(0, 20)

    const laserType = body.laserType || 'Mix'
    const businessDate = String(body.businessDate || '').trim() || req.businessDate || todayBusinessDate()
    const scheduleSlotId = String(body.scheduleSlotId || '').trim()

    let linkedSlot = null
    if (scheduleSlotId) {
      linkedSlot = await ScheduleSlot.findById(scheduleSlotId)
      if (!linkedSlot) {
        res.status(404).json({ error: 'الموعد المرتبط غير موجود' })
        return
      }
      if (!linkedSlot.patientId || String(linkedSlot.patientId) !== String(patient._id)) {
        res.status(400).json({ error: 'الموعد المرتبط لا يخص هذا المريض' })
        return
      }
      if (String(linkedSlot.serviceType || '') !== 'laser') {
        res.status(400).json({ error: 'الموعد المرتبط ليس موعد ليزر' })
        return
      }
      if (!linkedSlot.arrivedAt) {
        res.status(400).json({ error: 'لا يمكن إنشاء الجلسة قبل تسجيل وصول المريض' })
        return
      }
      if (linkedSlot.laserSessionId) {
        res.status(409).json({ error: 'تم إنشاء جلسة ليزر لهذا الموعد مسبقاً' })
        return
      }
      if (
        req.user.role === 'laser' &&
        linkedSlot.assignedSpecialistUserId &&
        String(linkedSlot.assignedSpecialistUserId) !== String(req.user._id)
      ) {
        res.status(403).json({ error: 'هذا الموعد مرتبط بأخصائي آخر' })
        return
      }
    }

    const catalogRows =
      areaIds.length > 0
        ? await LaserAreaCatalog.find({ areaId: { $in: areaIds } }).lean()
        : []
    const labelByArea = new Map(catalogRows.map((r) => [r.areaId, r.label]))
    const catalogPart = areaIds.length
      ? areaIds.map((id) => labelByArea.get(id) || id).join('، ')
      : ''
    const manualPart = manualAreaLabels.length ? manualAreaLabels.join('، ') : ''
    const areaPart = [catalogPart, manualPart].filter(Boolean).join(' — ') || 'بدون مناطق محددة'
    const addonSuffix =
      isPackageSession && addonManualLabels.length
        ? ` — إضافات خارج الباكج: ${addonManualLabels.join('، ')}`
        : ''
    const procedureDescription = `ليزر ${laserType} — ${areaPart}${isPackageSession ? ' (باكج)' : ''}${addonSuffix}`.slice(
      0,
      500,
    )

    const treatmentNumber = await nextSequence('laserTreatment')

    let s = null
    let cs = null
    let bi = null
    try {
      s = await LaserSession.create({
        treatmentNumber,
        patientId: patient._id,
        operatorUserId: req.user._id,
        room: String(body.room ?? '1'),
        laserType,
        pw: body.pw ?? '',
        pulse: body.pulse ?? '',
        shotCount: body.shotCount ?? '',
        chargeByPulseCount: Boolean(chargeByPulseCount),
        notes: body.notes ?? '',
        areaIds,
        manualAreaLabels,
        status: isPackageSession ? 'completed_pending_collection' : body.status || 'scheduled',
        costSyp: costGrossSyp,
        discountPercent,
        isPackageSession,
        patientPackageId: isPackageSession ? String(packageMatch?.pkg?._id || '') : '',
        patientPackageSessionId: isPackageSession ? String(packageMatch?.session?._id || '') : '',
      })

      cs = await ClinicalSession.create({
        patientId: patient._id,
        providerUserId: req.user._id,
        department: 'laser',
        procedureDescription,
        sessionFeeSyp: amountDueSyp,
        businessDate,
        notes: String(body.notes ?? '').trim().slice(0, 2000),
        laserSessionId: s._id,
        materials: [],
        materialCostSypTotal: 0,
        isPackageSession,
        patientPackageId: isPackageSession ? String(packageMatch?.pkg?._id || '') : '',
        patientPackageSessionId: isPackageSession ? String(packageMatch?.session?._id || '') : '',
      })

      bi = await BillingItem.create({
        clinicalSessionId: cs._id,
        patientId: patient._id,
        providerUserId: req.user._id,
        department: 'laser',
        procedureLabel: procedureDescription.slice(0, 200) || 'ليزر',
        amountDueSyp,
        currency: 'SYP',
        businessDate,
        status: 'pending_payment',
        isPackagePrepaid: isPackageSession,
        patientPackageId: isPackageSession ? String(packageMatch?.pkg?._id || '') : '',
        patientPackageSessionId: isPackageSession ? String(packageMatch?.session?._id || '') : '',
      })

      cs.billingItemId = bi._id
      await cs.save()

      s.billingItemId = bi._id
      s.clinicalSessionId = cs._id
      await s.save()
      if (isPackageSession && packageMatch?.pkg?._id && packageMatch?.session?._id) {
        await Patient.updateOne(
          { _id: patient._id },
          {
            $set: {
              'sessionPackages.$[pkg].sessions.$[sess].linkedLaserSessionId': s._id,
              'sessionPackages.$[pkg].sessions.$[sess].linkedBillingItemId': bi._id,
            },
          },
          {
            arrayFilters: [{ 'pkg._id': packageMatch.pkg._id }, { 'sess._id': packageMatch.session._id }],
          },
        )
      }
      if (linkedSlot) {
        linkedSlot.laserSessionId = s._id
        await linkedSlot.save()
      }
    } catch (inner) {
      if (bi?._id) await BillingItem.deleteOne({ _id: bi._id })
      if (cs?._id) await ClinicalSession.deleteOne({ _id: cs._id })
      if (s?._id) await LaserSession.findByIdAndDelete(s._id)
      console.error(inner)
      res.status(500).json({ error: 'تعذر حفظ الجلسة أو إنشاء بند الفوترة' })
      return
    }

    try {
      await writeAudit({
        user: req.user,
        action: 'إنشاء جلسة ليزر وبند فوترة معلّق',
        entityType: 'LaserSession',
        entityId: String(s._id),
        details: { billingItemId: String(bi._id), amountDueSyp },
      })
    } catch (auditErr) {
      console.error('writeAudit after laser session:', auditErr)
    }

    const patientDepts = Array.isArray(patient.departments) ? patient.departments : []
    if (!patientDepts.includes('laser')) {
      await Patient.updateOne(
        { _id: patient._id },
        { $addToSet: { departments: 'laser' }, $set: { lastVisit: new Date() } },
      )
    }

    res.status(201).json({
      session: typeof s.toJSON === 'function' ? s.toJSON() : s,
      billingItem: {
        id: String(bi._id),
        status: bi.status,
        amountDueSyp: bi.amountDueSyp,
        isPackagePrepaid: bi.isPackagePrepaid === true,
      },
      packageInfo: isPackageSession
        ? {
            packageId: String(packageMatch?.pkg?._id || ''),
            packageSessionId: String(packageMatch?.session?._id || ''),
            label: String(packageMatch?.session?.label || ''),
          }
        : null,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
