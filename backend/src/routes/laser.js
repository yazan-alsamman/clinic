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
import { Room } from '../models/Room.js'
import { LaserMonthlyExpenses } from '../models/LaserMonthlyExpenses.js'
import { LaserSettings } from '../models/LaserSettings.js'
import { LaserPackageTemplate } from '../models/LaserPackageTemplate.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { nextSequence } from '../models/Counter.js'
import { writeAudit } from '../utils/audit.js'
import { postLaserSessionIfCompleted } from '../services/postingService.js'
import { resolveLaserPackageSessionForBooking } from '../services/laserPackageBooking.js'
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
const LASER_PACKAGE_TEMPLATE_READ = ['super_admin', 'reception', 'laser']
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
  const male = Math.max(0, Math.round(Number(row.priceMaleSyp ?? row.priceSyp) || 0))
  const female = Math.max(0, Math.round(Number(row.priceFemaleSyp ?? row.priceSyp) || 0))
  const areaCount = Math.max(1, Math.min(20, Math.trunc(Number(row.areaCount) || 1)))
  return {
    id: String(row._id),
    code: row.code,
    name: row.name,
    groupId: row.groupId,
    groupTitle: row.groupTitle,
    kind: row.kind,
    priceSyp: Number(row.priceSyp) || female,
    priceMaleSyp: male,
    priceFemaleSyp: female,
    areaCount,
    active: Boolean(row.active),
    sortOrder: Number(row.sortOrder) || 0,
  }
}

async function ensureDefaultLaserProcedureOptions() {
  const count = await LaserProcedureOption.estimatedDocumentCount()
  if (count > 0) {
    await LaserProcedureOption.updateMany(
      {
        $or: [
          { priceMaleSyp: { $exists: false } },
          { priceFemaleSyp: { $exists: false } },
          { areaCount: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            priceMaleSyp: { $ifNull: ['$priceMaleSyp', { $ifNull: ['$priceSyp', 0] }] },
            priceFemaleSyp: { $ifNull: ['$priceFemaleSyp', { $ifNull: ['$priceSyp', 0] }] },
            areaCount: { $ifNull: ['$areaCount', 1] },
          },
        },
      ],
    )
    return
  }
  const rows = defaultProcedureOptions.map(([groupId, kind, name, priceSyp], idx) => ({
    code: `${groupId}-${slugifyArabic(name)}-${idx + 1}`,
    name,
    groupId,
    groupTitle: LASER_PROCEDURE_GROUPS[groupId],
    kind,
    priceSyp,
    priceMaleSyp: priceSyp,
    priceFemaleSyp: priceSyp,
    active: true,
    sortOrder: idx + 1,
  }))
  await LaserProcedureOption.insertMany(rows, { ordered: false })
}
function normalizePatientGender(raw) {
  const v = String(raw || '').trim()
  return v === 'male' || v === 'female' ? v : ''
}

function resolveProcedurePriceForGender(option, patientGender) {
  const male = Math.max(0, Math.round(Number(option?.priceMaleSyp ?? option?.priceSyp) || 0))
  const female = Math.max(0, Math.round(Number(option?.priceFemaleSyp ?? option?.priceSyp) || 0))
  if (patientGender === 'male') return male
  if (patientGender === 'female') return female
  return female || male
}

function parseUniqueStringIds(raw, max = 200) {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, max)
}

function parseLaserSessionLineItems(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => ({
      procedureOptionId: String(row?.procedureOptionId || '').trim(),
      areaLabel: String(row?.areaLabel || '')
        .trim()
        .slice(0, 120),
      pw: String(row?.pw || '')
        .trim()
        .slice(0, 80),
      pulse: String(row?.pulse || '')
        .trim()
        .slice(0, 80),
      shotCount: String(row?.shotCount || '')
        .trim()
        .slice(0, 80),
      chargeByPulseCount: row?.chargeByPulseCount === true,
      isAddon: row?.isAddon === true,
    }))
    .filter((row) => row.procedureOptionId || row.areaLabel)
    .slice(0, 120)
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

/**
 * مجموع ضربات الأخصائي في الجلسة فقط (بدون قراءات عدّاد الجهاز الكليّة).
 * - يُفضّل جمع أسطر lineItems لأنها تمثل إدخال الأخصائي لكل منطقة.
 * - إن لم توجد أسطر: يُجمع كل جزء من shotCount بعد الفصل بـ | (بدل دمج كل الأرقام في رقم واحد).
 * - أي جزء أكبر من الحد يُستبعد (غالباً قراءة عدّاد أو خطأ إدخال).
 */
const MAX_REASONABLE_SHOTS_PER_LINE = 500_000

function specialistSessionShotsTotal(row) {
  const items = Array.isArray(row?.lineItems) ? row.lineItems : []

  const clampSegment = (parsed) => {
    const v = Math.round(Number(parsed) || 0)
    if (!Number.isFinite(v) || v <= 0) return 0
    if (v > MAX_REASONABLE_SHOTS_PER_LINE) return 0
    return v
  }

  if (items.length > 0) {
    let sum = 0
    for (const li of items) {
      sum += clampSegment(parseShotCount(li?.shotCount))
    }
    return sum
  }

  const raw = String(row?.shotCount ?? '').trim()
  if (!raw) return 0
  const parts = raw.includes('|')
    ? raw.split('|').map((s) => s.trim()).filter(Boolean)
    : [raw]
  let sum = 0
  for (const part of parts) {
    sum += clampSegment(parseShotCount(part))
  }
  return sum
}

function morningAssigneeId(room) {
  return room.morningAssignedUserId || room.assignedUserId || null
}

function isMorningLaserAssignee(room, userId) {
  const mid = morningAssigneeId(room)
  return mid != null && String(mid) === String(userId)
}

function meterSegmentReconciliation(meterStart, meterEnd, shotsInSegment) {
  const s = meterStart != null ? Number(meterStart) : NaN
  const e = meterEnd != null ? Number(meterEnd) : NaN
  const sh = Number(shotsInSegment) || 0
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return { complete: false, delta: null, matched: null }
  }
  const delta = s + sh - e
  const matched = Math.abs(delta) < 1e-6
  return { complete: true, delta, matched }
}

function sumShotsForRoomBeforeCutoff(laserRows, roomNum, cutoff) {
  if (!cutoff) return 0
  const roomStr = String(roomNum)
  const tCut =
    cutoff instanceof Date ? cutoff.getTime() : new Date(cutoff).getTime()
  if (!Number.isFinite(tCut)) return 0
  let sum = 0
  for (const row of laserRows) {
    if (String(row.room || '').trim() !== roomStr) continue
    const u = row.updatedAt ? new Date(row.updatedAt).getTime() : 0
    if (u <= tCut) sum += specialistSessionShotsTotal(row)
  }
  return sum
}

function buildRoomMeterBundle({
  laserRows,
  roomNum,
  meterStart,
  meterHalf,
  meterEnd,
  halfDayCapturedAt,
  shotsTotal,
}) {
  const shots = Number(shotsTotal) || 0
  const morningShots =
    meterHalf != null && halfDayCapturedAt
      ? sumShotsForRoomBeforeCutoff(laserRows, roomNum, halfDayCapturedAt)
      : null
  const afternoonShots =
    meterHalf != null && halfDayCapturedAt != null && morningShots != null
      ? Math.max(0, shots - morningShots)
      : null

  const fullDay = meterSegmentReconciliation(meterStart, meterEnd, shots)
  const morning =
    meterHalf != null && morningShots != null
      ? meterSegmentReconciliation(meterStart, meterHalf, morningShots)
      : { complete: false, delta: null, matched: null }
  const afternoon =
    meterHalf != null && meterEnd != null && afternoonShots != null
      ? meterSegmentReconciliation(meterHalf, meterEnd, afternoonShots)
      : { complete: false, delta: null, matched: null }

  let mismatchPhase = null
  if (morning.complete && morning.matched === false) mismatchPhase = 'morning'
  else if (afternoon.complete && afternoon.matched === false) mismatchPhase = 'afternoon'
  else if (fullDay.complete && fullDay.matched === false) mismatchPhase = 'full_day'

  return {
    complete: fullDay.complete,
    delta: fullDay.delta,
    matched: fullDay.matched,
    morning,
    afternoon,
    mismatchPhase,
    shotsMorning: morningShots,
    shotsAfternoon: afternoonShots,
    shotsTotal: shots,
  }
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
    await LaserSettings.create({ _id: 'default', pricePerPulseSyp: 0, laserCoverSyp: 0 })
    doc = { _id: 'default', pricePerPulseSyp: 0, laserCoverSyp: 0 }
  }
  return doc
}

function packageTemplateToDto(d) {
  const o = d.toObject ? d.toObject() : d
  return {
    id: String(o._id),
    name: String(o.name || '').trim(),
    procedureOptionIds: Array.isArray(o.procedureOptionIds) ? o.procedureOptionIds.map(String) : [],
    areaCount: Math.max(1, Math.trunc(Number(o.areaCount) || 0)),
    listPriceSyp: Math.round(Number(o.listPriceSyp) || 0),
    active: o.active !== false,
    sortOrder: Number(o.sortOrder) || 0,
    createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
    updatedAt: o.updatedAt ? new Date(o.updatedAt).toISOString() : null,
  }
}

async function assertProcedureOptionIdsValid(optionIds) {
  const ids = [...new Set(optionIds.map(String).filter(Boolean))]
  if (ids.length === 0) throw new Error('اختر منطقة واحدة على الأقل للباكج')
  const found = await LaserProcedureOption.find({ _id: { $in: ids } }).select('_id').lean()
  if (found.length !== ids.length) throw new Error('بعض معرفات المناطق غير موجودة في النظام')
  return ids
}

laserRouter.get('/package-templates', async (req, res) => {
  try {
    if (!LASER_PACKAGE_TEMPLATE_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const includeInactive = req.user.role === 'super_admin' && String(req.query.includeInactive || '') === '1'
    const filter = includeInactive ? {} : { active: true }
    const rows = await LaserPackageTemplate.find(filter).sort({ sortOrder: 1, name: 1 }).lean()
    res.json({ templates: rows.map((r) => packageTemplateToDto(r)) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.post('/package-templates', requireRoles('super_admin'), async (req, res) => {
  try {
    const body = req.body ?? {}
    const name = String(body.name || '').trim().slice(0, 160)
    if (!name) {
      res.status(400).json({ error: 'اسم الباكج مطلوب' })
      return
    }
    const rawIds = Array.isArray(body.procedureOptionIds) ? body.procedureOptionIds : []
    const areaCount = Math.max(1, Math.min(40, Math.trunc(Number(body.areaCount) || rawIds.length || 0)))
    let procedureOptionIds
    try {
      procedureOptionIds = await assertProcedureOptionIdsValid(rawIds.map(String))
    } catch (err) {
      res.status(400).json({ error: String(err?.message || err) })
      return
    }
    if (procedureOptionIds.length !== areaCount) {
      res.status(400).json({ error: 'عدد المناطق يجب أن يطابق عدد العناصر المختارة من القائمة' })
      return
    }
    const listPriceSyp = Math.max(0, Math.round(Number(body.listPriceSyp) || 0))
    const sortOrder = Math.trunc(Number(body.sortOrder) || 0)
    const doc = await LaserPackageTemplate.create({
      name,
      procedureOptionIds,
      areaCount,
      listPriceSyp,
      active: body.active === false ? false : true,
      sortOrder,
    })
    await writeAudit({
      user: req.user,
      action: 'إنشاء قالب باكج ليزر',
      entityType: 'LaserPackageTemplate',
      entityId: doc._id,
      details: { name, areaCount, listPriceSyp },
    })
    res.status(201).json({ template: packageTemplateToDto(doc) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.patch('/package-templates/:id', requireRoles('super_admin'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const doc = await LaserPackageTemplate.findById(id)
    if (!doc) {
      res.status(404).json({ error: 'الباكج غير موجود' })
      return
    }
    const body = req.body ?? {}
    if (body.name != null) doc.name = String(body.name).trim().slice(0, 160) || doc.name
    if (body.listPriceSyp != null) doc.listPriceSyp = Math.max(0, Math.round(Number(body.listPriceSyp) || 0))
    if (body.sortOrder != null) doc.sortOrder = Math.trunc(Number(body.sortOrder) || 0)
    if (body.active != null) doc.active = Boolean(body.active)
    if (body.procedureOptionIds != null || body.areaCount != null) {
      const rawIds = Array.isArray(body.procedureOptionIds) ? body.procedureOptionIds : doc.procedureOptionIds
      const areaCount = Math.max(
        1,
        Math.min(40, Math.trunc(Number(body.areaCount != null ? body.areaCount : doc.areaCount) || 0)),
      )
      let procedureOptionIds
      try {
        procedureOptionIds = await assertProcedureOptionIdsValid(rawIds.map(String))
      } catch (err) {
        res.status(400).json({ error: String(err?.message || err) })
        return
      }
      if (procedureOptionIds.length !== areaCount) {
        res.status(400).json({ error: 'عدد المناطق يجب أن يطابق عدد العناصر المختارة' })
        return
      }
      doc.procedureOptionIds = procedureOptionIds
      doc.areaCount = areaCount
    }
    await doc.save()
    await writeAudit({
      user: req.user,
      action: 'تحديث قالب باكج ليزر',
      entityType: 'LaserPackageTemplate',
      entityId: doc._id,
      details: { name: doc.name },
    })
    res.json({ template: packageTemplateToDto(doc) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.delete('/package-templates/:id', requireRoles('super_admin'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const doc = await LaserPackageTemplate.findById(id)
    if (!doc) {
      res.status(404).json({ error: 'الباكج غير موجود' })
      return
    }
    const inUse = await Patient.countDocuments({
      sessionPackages: {
        $elemMatch: {
          department: 'laser',
          $or: [{ laserPackageTemplateId: String(id) }, { laserPackageTemplateIds: String(id) }],
        },
      },
    })
    if (inUse > 0) {
      res.status(400).json({ error: 'لا يمكن حذف الباكج لأنه مربوط بملفات مرضى — عطّله مؤقتاً بدلاً من ذلك' })
      return
    }
    await LaserPackageTemplate.deleteOne({ _id: doc._id })
    await writeAudit({
      user: req.user,
      action: 'حذف قالب باكج ليزر',
      entityType: 'LaserPackageTemplate',
      entityId: doc._id,
      details: { name: doc.name },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

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
      laserCoverSyp: Math.max(0, Math.round(Number(doc.laserCoverSyp) || 0)),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

laserRouter.patch('/pricing-settings', requireRoles('super_admin'), async (req, res) => {
  try {
    const body = req.body ?? {}
    const set = {}
    if (body.pricePerPulseSyp != null) {
      set.pricePerPulseSyp = Math.max(0, Math.round(Number(body.pricePerPulseSyp) || 0))
    }
    if (body.laserCoverSyp != null) {
      set.laserCoverSyp = Math.max(0, Math.round(Number(body.laserCoverSyp) || 0))
    }
    if (Object.keys(set).length === 0) {
      const doc = await getOrCreateLaserSettings()
      res.json({
        pricePerPulseSyp: Math.max(0, Math.round(Number(doc.pricePerPulseSyp) || 0)),
        laserCoverSyp: Math.max(0, Math.round(Number(doc.laserCoverSyp) || 0)),
      })
      return
    }
    await LaserSettings.findOneAndUpdate({ _id: 'default' }, { $set: set }, { upsert: true, new: true })
    const doc = await getOrCreateLaserSettings()
    await writeAudit({
      user: req.user,
      action: 'تحديث إعدادات تسعير الليزر',
      entityType: 'LaserSettings',
      entityId: 'default',
      details: set,
    })
    res.json({
      pricePerPulseSyp: Math.max(0, Math.round(Number(doc.pricePerPulseSyp) || 0)),
      laserCoverSyp: Math.max(0, Math.round(Number(doc.laserCoverSyp) || 0)),
    })
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
    const legacyPriceSyp = Number(body.priceSyp)
    const priceMaleSyp = Number(body.priceMaleSyp ?? legacyPriceSyp)
    const priceFemaleSyp = Number(body.priceFemaleSyp ?? legacyPriceSyp)
    const sortOrder = Number(body.sortOrder)
    const areaCountRaw = Number(body.areaCount)
    const areaCount = Number.isFinite(areaCountRaw) ? Math.trunc(areaCountRaw) : 1
    if (!name) {
      res.status(400).json({ error: 'اسم المنطقة/العرض مطلوب' })
      return
    }
    if (!LASER_PROCEDURE_GROUPS[groupId]) {
      res.status(400).json({ error: 'القسم غير صالح' })
      return
    }
    if (
      !Number.isFinite(priceMaleSyp) ||
      priceMaleSyp < 0 ||
      !Number.isFinite(priceFemaleSyp) ||
      priceFemaleSyp < 0
    ) {
      res.status(400).json({ error: 'سعر الذكور/الإناث بالليرة غير صالح' })
      return
    }
    if (!Number.isFinite(areaCount) || areaCount < 1 || areaCount > 20) {
      res.status(400).json({ error: 'عدد المناطق يجب أن يكون بين 1 و 20' })
      return
    }
    const option = await LaserProcedureOption.create({
      code: `${groupId}-${slugifyArabic(name)}-${Date.now()}`,
      name,
      groupId,
      groupTitle: LASER_PROCEDURE_GROUPS[groupId],
      kind,
      priceSyp: Math.round(priceFemaleSyp),
      priceMaleSyp: Math.round(priceMaleSyp),
      priceFemaleSyp: Math.round(priceFemaleSyp),
      areaCount,
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
    if (body.areaCount != null) {
      const nextAreaCount = Math.trunc(Number(body.areaCount))
      if (!Number.isFinite(nextAreaCount) || nextAreaCount < 1 || nextAreaCount > 20) {
        res.status(400).json({ error: 'عدد المناطق يجب أن يكون بين 1 و 20' })
        return
      }
      option.areaCount = nextAreaCount
    }
    if (body.priceSyp != null || body.priceMaleSyp != null || body.priceFemaleSyp != null) {
      const nextMale = Number(body.priceMaleSyp ?? body.priceSyp ?? option.priceMaleSyp ?? option.priceSyp)
      const nextFemale = Number(body.priceFemaleSyp ?? body.priceSyp ?? option.priceFemaleSyp ?? option.priceSyp)
      if (!Number.isFinite(nextMale) || nextMale < 0 || !Number.isFinite(nextFemale) || nextFemale < 0) {
        res.status(400).json({ error: 'سعر الذكور/الإناث بالليرة غير صالح' })
        return
      }
      option.priceMaleSyp = Math.round(nextMale)
      option.priceFemaleSyp = Math.round(nextFemale)
      option.priceSyp = Math.round(nextFemale)
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

/** إعلان خروج أخصائي وردية الصباح — يطلِب من السكرتاريا إدخال قراءة نصف اليوم للغرفة المعنية */
laserRouter.post(
  '/morning-shift-logout-notify',
  requireActiveDay,
  requireRoles('laser'),
  async (req, res) => {
    try {
      const d = req.businessDay
      if (!d?.active) {
        res.status(423).json({ error: 'يوم العمل غير مفعّل.' })
        return
      }
      const uid = req.user._id
      const rooms = await Room.find({}).lean()
      const pendingRooms = []
      for (const room of rooms) {
        if (!isMorningLaserAssignee(room, uid)) continue
        const n = Number(room.number)
        if (n === 1 && d.room1MeterHalfDay == null) {
          d.room1HalfDayPending = true
          pendingRooms.push(1)
        } else if (n === 2 && d.room2MeterHalfDay == null) {
          d.room2HalfDayPending = true
          pendingRooms.push(2)
        }
      }
      await d.save()
      res.json({ ok: true, pendingRooms })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'خطأ في الخادم' })
    }
  },
)

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
            .select('operatorUserId shotCount room lineItems updatedAt')
            .lean()
        : []

    const totals = new Map()
    const roomTotals = { room1Shots: 0, room2Shots: 0 }
    for (const row of laserRows) {
      const shotCount = specialistSessionShotsTotal(row)
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
      .select(
        'room1MeterStart room2MeterStart room1MeterEnd room2MeterEnd room1MeterHalfDay room2MeterHalfDay room1HalfDayCapturedAt room2HalfDayCapturedAt',
      )
      .lean()
    const meterReconciliation = {
      room1: buildRoomMeterBundle({
        laserRows,
        roomNum: 1,
        meterStart: bd?.room1MeterStart,
        meterHalf: bd?.room1MeterHalfDay,
        meterEnd: bd?.room1MeterEnd,
        halfDayCapturedAt: bd?.room1HalfDayCapturedAt,
        shotsTotal: roomTotals.room1Shots,
      }),
      room2: buildRoomMeterBundle({
        laserRows,
        roomNum: 2,
        meterStart: bd?.room2MeterStart,
        meterHalf: bd?.room2MeterHalfDay,
        meterEnd: bd?.room2MeterEnd,
        halfDayCapturedAt: bd?.room2HalfDayCapturedAt,
        shotsTotal: roomTotals.room2Shots,
      }),
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
            .select('operatorUserId shotCount room lineItems')
            .lean()
        : []

    const totals = new Map()
    const roomTotals = { room1Shots: 0, room2Shots: 0 }
    for (const row of laserRows) {
      const shotCount = specialistSessionShotsTotal(row)
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

    const scheduleSlotIdEarly = String(body.scheduleSlotId || '').trim()
    let slotPackageMode = ''
    if (scheduleSlotIdEarly) {
      const slotLean = await ScheduleSlot.findById(scheduleSlotIdEarly).select('laserPackageBookingMode').lean()
      if (slotLean) slotPackageMode = String(slotLean.laserPackageBookingMode || '').trim()
    }
    const skipLaserPackage =
      body.skipLaserPackage === true ||
      body.forceOutsidePackage === true ||
      slotPackageMode === 'outside_package'

    const packageMatch = skipLaserPackage
      ? null
      : await resolveLaserPackageSessionForBooking(patient, slotPackageMode)
    const isPackageSession = Boolean(packageMatch)
    const discountPercent = isPackageSession ? 0 : Math.min(100, Math.max(0, Number(body.discountPercent) || 0))
    const patientGender = normalizePatientGender(patient.gender)

    let effectiveMainOptionIds = parseUniqueStringIds(body.procedureOptionIds)
    if (isPackageSession && effectiveMainOptionIds.length === 0) {
      const snap = Array.isArray(packageMatch?.pkg?.procedureOptionIds) ? packageMatch.pkg.procedureOptionIds : []
      effectiveMainOptionIds = parseUniqueStringIds(snap)
    }
    const addonProcedureOptionIds = parseUniqueStringIds(body.addonProcedureOptionIds).filter(
      (id) => !effectiveMainOptionIds.includes(id),
    )
    const allProcedureOptionIds = [...new Set([...effectiveMainOptionIds, ...addonProcedureOptionIds])]
    const procedureOptionsById = new Map()
    if (allProcedureOptionIds.length > 0) {
      const optionRows = await LaserProcedureOption.find({
        _id: { $in: allProcedureOptionIds },
        active: true,
      }).lean()
      for (const row of optionRows) procedureOptionsById.set(String(row._id), row)
      const missing = allProcedureOptionIds.filter((id) => !procedureOptionsById.has(id))
      if (missing.length > 0) {
        res.status(400).json({ error: 'بعض المناطق/العروض المحددة غير موجودة أو موقفة' })
        return
      }
    }
    const selectedMainOptions = effectiveMainOptionIds
      .map((id) => procedureOptionsById.get(id))
      .filter(Boolean)
    const selectedAddonOptions = addonProcedureOptionIds
      .map((id) => procedureOptionsById.get(id))
      .filter(Boolean)
    let rawLineItems = parseLaserSessionLineItems(body.laserLineItems)
    if (isPackageSession && rawLineItems.length === 0 && effectiveMainOptionIds.length > 0) {
      rawLineItems = effectiveMainOptionIds.map((procedureOptionId) => ({
        procedureOptionId,
        areaLabel: '',
        pw: '',
        pulse: '',
        shotCount: '',
        chargeByPulseCount: false,
        isAddon: false,
      }))
    }
    const settings = await getOrCreateLaserSettings()
    const ppuSyp = Math.max(0, Math.round(Number(settings.pricePerPulseSyp) || 0))
    const distributedAreaPriceByIndex = new Map()
    const nonPulseGroupedIndexes = new Map()
    rawLineItems.forEach((row, idx) => {
      if (!row?.procedureOptionId || row.chargeByPulseCount) return
      const key = `${row.procedureOptionId}|${row.isAddon ? 1 : 0}`
      if (!nonPulseGroupedIndexes.has(key)) nonPulseGroupedIndexes.set(key, [])
      nonPulseGroupedIndexes.get(key).push(idx)
    })
    for (const indexes of nonPulseGroupedIndexes.values()) {
      if (!Array.isArray(indexes) || indexes.length === 0) continue
      const sample = rawLineItems[indexes[0]]
      const option =
        sample?.procedureOptionId && procedureOptionsById.has(sample.procedureOptionId)
          ? procedureOptionsById.get(sample.procedureOptionId)
          : null
      const fullAreaPriceSyp = option ? resolveProcedurePriceForGender(option, patientGender) : 0
      const count = indexes.length
      const base = Math.floor(fullAreaPriceSyp / count)
      const remainder = fullAreaPriceSyp - base * count
      indexes.forEach((idx, pos) => {
        distributedAreaPriceByIndex.set(idx, base + (pos < remainder ? 1 : 0))
      })
    }

    const normalizedLineItems = rawLineItems.map((row, idx) => {
      const option =
        row.procedureOptionId && procedureOptionsById.has(row.procedureOptionId)
          ? procedureOptionsById.get(row.procedureOptionId)
          : null
      const resolvedAreaLabel = row.areaLabel || String(option?.name || '').trim().slice(0, 120)
      const areaPriceSyp = option ? resolveProcedurePriceForGender(option, patientGender) : 0
      const distributedAreaPrice = distributedAreaPriceByIndex.get(idx)
      const shots = parseShotCount(row.shotCount)
      let lineCostSyp = distributedAreaPrice ?? areaPriceSyp
      if (row.chargeByPulseCount) {
        if (!(ppuSyp > 0)) {
          lineCostSyp = 0
        } else if (shots > 0) {
          lineCostSyp = ppuSyp * shots
        } else {
          lineCostSyp = 0
        }
      }
      return {
        ...row,
        areaLabel: resolvedAreaLabel,
        lineCostSyp: Math.max(0, Math.round(lineCostSyp)),
      }
    })

    /** جلسة باكج: المبلغ المطلوب = مناطق خارج الباكج فقط (ليرة) */
    let packageAddOnGrossSyp = 0
    if (isPackageSession) {
      if (normalizedLineItems.length > 0) {
        packageAddOnGrossSyp = normalizedLineItems
          .filter((row) => row.isAddon)
          .reduce((sum, row) => sum + (Number(row.lineCostSyp) || 0), 0)
      } else {
        packageAddOnGrossSyp =
          selectedAddonOptions.length > 0
            ? selectedAddonOptions.reduce(
                (sum, row) => sum + resolveProcedurePriceForGender(row, patientGender),
                0,
              )
            : parseNonNegativeSypInteger(body.additionalCostSyp)
      }
    }

    const chargeByPulseCount = !isPackageSession && Boolean(body.chargeByPulseCount)
    let costGrossSyp = 0
    if (isPackageSession) {
      costGrossSyp = packageAddOnGrossSyp
    } else if (normalizedLineItems.length > 0) {
      const pulseRows = normalizedLineItems.filter((row) => row.chargeByPulseCount)
      if (pulseRows.length > 0 && !(ppuSyp > 0)) {
        res.status(400).json({
          error:
            'سعر الضربة غير محدد — يحدده المدير في «الغرف وتعيين أخصائيي الليزر» ضمن قسم أسعار المناطق والعروض.',
        })
        return
      }
      const invalidPulseRow = pulseRows.find((row) => !(parseShotCount(row.shotCount) > 0))
      if (invalidPulseRow) {
        res.status(400).json({
          error: `أدخل عدد ضربات أكبر من صفر للسطر: ${invalidPulseRow.areaLabel || 'بدون اسم'}.`,
        })
        return
      }
      costGrossSyp = normalizedLineItems.reduce((sum, row) => sum + (Number(row.lineCostSyp) || 0), 0)
    } else if (chargeByPulseCount) {
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
      costGrossSyp =
        selectedMainOptions.length > 0
          ? selectedMainOptions.reduce(
              (sum, row) => sum + resolveProcedurePriceForGender(row, patientGender),
              0,
            )
          : parsePositiveSypInteger(body.costSyp)
    }

    const includeLaserCover = Boolean(body.includeLaserCover)
    const laserCoverSypSetting = Math.max(0, Math.round(Number(settings.laserCoverSyp) || 0))
    let laserCoverAppliedSyp = 0
    if (includeLaserCover) {
      if (!(laserCoverSypSetting > 0)) {
        res.status(400).json({
          error:
            'لم يُحدد سعر كفر الليزر — يضبطه المدير في «الغرف وتعيين أخصائيي الليزر» ضمن أسعار المناطق والعروض.',
        })
        return
      }
      laserCoverAppliedSyp = laserCoverSypSetting
      if (isPackageSession) {
        packageAddOnGrossSyp += laserCoverAppliedSyp
      }
      costGrossSyp += laserCoverAppliedSyp
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
    const manualAreaLabels =
      selectedMainOptions.length > 0
        ? selectedMainOptions.map((row) => String(row?.name || '').trim()).filter(Boolean).slice(0, 20)
        : [
            ...new Set(
              manualRaw
                .map((x) => String(x ?? '').trim().slice(0, 120))
                .filter(Boolean),
            ),
          ].slice(0, 20)

    const addonRaw = Array.isArray(body.addonManualLabels) ? body.addonManualLabels : []
    const addonManualLabels =
      selectedAddonOptions.length > 0
        ? selectedAddonOptions.map((row) => String(row?.name || '').trim()).filter(Boolean).slice(0, 20)
        : [
            ...new Set(
              addonRaw
                .map((x) => String(x ?? '').trim().slice(0, 120))
                .filter(Boolean),
            ),
          ].slice(0, 20)
    const linesPw = normalizedLineItems.map((row) => row.pw).filter(Boolean)
    const linesPulse = normalizedLineItems.map((row) => row.pulse).filter(Boolean)
    const linesShots = normalizedLineItems.map((row) => row.shotCount).filter(Boolean)
    const mergedPw = linesPw.length > 0 ? linesPw.join(' | ').slice(0, 500) : String(body.pw ?? '')
    const mergedPulse =
      linesPulse.length > 0 ? linesPulse.join(' | ').slice(0, 500) : String(body.pulse ?? '')
    const mergedShotCount =
      linesShots.length > 0 ? linesShots.join(' | ').slice(0, 500) : String(body.shotCount ?? '')

    const laserType = body.laserType || 'Mix'
    const businessDate = String(body.businessDate || '').trim() || req.businessDate || todayBusinessDate()
    const scheduleSlotId = String(body.scheduleSlotId || '').trim()

    let linkedSlot = null
    let resolvedRoom = String(body.room ?? '1').trim()
    if (resolvedRoom !== '2') resolvedRoom = '1'
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
      const slotRoom = String(linkedSlot.roomNumber ?? '').trim()
      if (slotRoom === '1' || slotRoom === '2') resolvedRoom = slotRoom
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
    const laserCoverSuffix = laserCoverAppliedSyp > 0 ? ' — كفر ليزر' : ''
    const procedureDescriptionBase =
      `ليزر ${laserType} — ${areaPart}${isPackageSession ? ' (باكج)' : ''}${addonSuffix}${laserCoverSuffix}`.slice(0, 500)

    /** يظهر لدى الاستقبال على التحصيل عند وجود محاسبة بعدد الضربات */
    const pulseLineItems = normalizedLineItems.filter((row) => row.chargeByPulseCount)
    const legacyWholeSessionPulse =
      !isPackageSession && normalizedLineItems.length === 0 && Boolean(chargeByPulseCount)
    let pulseBillingReceptionNote = ''
    if (pulseLineItems.length > 0) {
      const names = pulseLineItems
        .map((row) => String(row.areaLabel || '').trim())
        .filter((x) => Boolean(x))
      if (names.length === 1) {
        pulseBillingReceptionNote = `تم إضافة محاسبة على عدد الضربات للمنطقة: ${names[0]}`
      } else if (names.length > 1) {
        pulseBillingReceptionNote = `تم إضافة محاسبة على عدد الضربات للمناطق: ${names.join('، ')}`
      } else {
        pulseBillingReceptionNote = 'تم إضافة محاسبة على عدد الضربات لهذه الجلسة'
      }
    } else if (legacyWholeSessionPulse) {
      const hint = areaPart && areaPart !== 'بدون مناطق محددة' ? areaPart : 'المناطق المحددة'
      pulseBillingReceptionNote = `تم إضافة محاسبة على عدد الضربات (${hint})`
    }

    const procedureDescription = (
      pulseBillingReceptionNote
        ? `${procedureDescriptionBase} — ${pulseBillingReceptionNote}`
        : procedureDescriptionBase
    ).slice(0, 500)

    let procedureLabel = procedureDescription
    if (procedureLabel.length > 200) {
      if (pulseBillingReceptionNote) {
        const sep = ' — '
        const headLen = pulseBillingReceptionNote.length + sep.length
        const tailRoom = 200 - headLen
        procedureLabel =
          tailRoom > 24
            ? `${pulseBillingReceptionNote}${sep}${procedureDescriptionBase.slice(0, tailRoom)}`
            : pulseBillingReceptionNote.slice(0, 200)
      } else {
        procedureLabel = procedureDescription.slice(0, 200)
      }
    }

    if (isPackageSession && packageMatch?.mode === 'continue') {
      const existingLs = await LaserSession.findById(packageMatch.existingLaserSession._id)
      if (!existingLs) {
        res.status(404).json({ error: 'جلسة الليزر المرتبطة بالباكج غير موجودة.' })
        return
      }
      const oldRecorded = (Array.isArray(existingLs.lineItems) ? existingLs.lineItems : []).filter((r) => !r.isAddon)
        .length
      const newRecorded = normalizedLineItems.filter((r) => !r.isAddon).length
      if (newRecorded <= oldRecorded) {
        res.status(400).json({
          error: 'أضف منطقة واحدة على الأقل من مناطق الباكج المتبقية ثم احفظ (عدد أسطر المناطق أكبر من السابق).',
        })
        return
      }
      if (newRecorded > packageMatch.expectedAreas) {
        res.status(400).json({
          error: `لا يمكن تجاوز عدد مناطق الباكج (${packageMatch.expectedAreas} منطقة/ات).`,
        })
        return
      }

      const csExisting = existingLs.clinicalSessionId
        ? await ClinicalSession.findById(existingLs.clinicalSessionId)
        : null
      const biExisting = existingLs.billingItemId ? await BillingItem.findById(existingLs.billingItemId) : null
      if (!csExisting || !biExisting) {
        res.status(500).json({ error: 'بيانات الجلسة السريرية أو الفوترة غير مكتملة.' })
        return
      }

      existingLs.room = resolvedRoom
      existingLs.laserType = laserType
      existingLs.pw = mergedPw
      existingLs.pulse = mergedPulse
      existingLs.shotCount = mergedShotCount
      existingLs.chargeByPulseCount =
        normalizedLineItems.length > 0
          ? normalizedLineItems.some((row) => row.chargeByPulseCount)
          : Boolean(chargeByPulseCount)
      existingLs.notes = body.notes ?? ''
      existingLs.areaIds = areaIds
      existingLs.manualAreaLabels = manualAreaLabels
      existingLs.lineItems = normalizedLineItems
      existingLs.costSyp = costGrossSyp
      existingLs.laserCoverApplied = laserCoverAppliedSyp > 0
      existingLs.laserCoverSyp = laserCoverAppliedSyp
      existingLs.status = 'completed_pending_collection'
      await existingLs.save()

      csExisting.procedureDescription = procedureDescription
      csExisting.sessionFeeSyp = amountDueSyp
      csExisting.notes = String(body.notes ?? '').trim().slice(0, 2000)
      await csExisting.save()

      biExisting.procedureLabel = procedureLabel || 'ليزر'
      biExisting.amountDueSyp = amountDueSyp
      biExisting.listAmountDueSyp = amountDueSyp
      biExisting.effectiveAmountDueSyp = amountDueSyp
      await biExisting.save()

      const packageVisitIncomplete = newRecorded < packageMatch.expectedAreas

      try {
        await writeAudit({
          user: req.user,
          action: 'تحديث جلسة ليزر باكج (استكمال مناطق)',
          entityType: 'LaserSession',
          entityId: String(existingLs._id),
          details: {
            billingItemId: String(biExisting._id),
            newRecorded,
            expectedAreas: packageMatch.expectedAreas,
          },
        })
      } catch (auditErr) {
        console.error(auditErr)
      }

      res.status(200).json({
        session: typeof existingLs.toJSON === 'function' ? existingLs.toJSON() : existingLs,
        billingItem: {
          id: String(biExisting._id),
          status: biExisting.status,
          amountDueSyp: biExisting.amountDueSyp,
          isPackagePrepaid: biExisting.isPackagePrepaid === true,
        },
        packageInfo: {
          packageId: String(packageMatch.pkg._id || ''),
          packageSessionId: String(packageMatch.session._id || ''),
          label: String(packageMatch.session.label || ''),
        },
        packageVisitIncomplete,
      })
      return
    }

    const treatmentNumber = await nextSequence('laserTreatment')

    let s = null
    let cs = null
    let bi = null
    try {
      s = await LaserSession.create({
        treatmentNumber,
        patientId: patient._id,
        operatorUserId: req.user._id,
        room: resolvedRoom,
        laserType,
        pw: mergedPw,
        pulse: mergedPulse,
        shotCount: mergedShotCount,
        chargeByPulseCount:
          normalizedLineItems.length > 0
            ? normalizedLineItems.some((row) => row.chargeByPulseCount)
            : Boolean(chargeByPulseCount),
        notes: body.notes ?? '',
        areaIds,
        manualAreaLabels,
        lineItems: normalizedLineItems,
        status: isPackageSession ? 'completed_pending_collection' : body.status || 'scheduled',
        costSyp: costGrossSyp,
        discountPercent,
        isPackageSession,
        patientPackageId: isPackageSession ? String(packageMatch?.pkg?._id || '') : '',
        patientPackageSessionId: isPackageSession ? String(packageMatch?.session?._id || '') : '',
        laserCoverApplied: laserCoverAppliedSyp > 0,
        laserCoverSyp: laserCoverAppliedSyp,
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
        procedureLabel: procedureLabel || 'ليزر',
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
        details: {
          billingItemId: String(bi._id),
          amountDueSyp,
          laserCoverSyp: laserCoverAppliedSyp,
        },
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
      packageVisitIncomplete:
        isPackageSession &&
        Boolean(packageMatch) &&
        normalizedLineItems.filter((r) => !r.isAddon).length < (packageMatch.expectedAreas || 1),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
