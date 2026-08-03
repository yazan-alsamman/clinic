import { Router } from 'express'
import mongoose from 'mongoose'
import { DentalMasterPlan } from '../models/DentalMasterPlan.js'
import {
  DentalChartMarkOption,
  DENTAL_CHART_MARK_CATEGORIES,
  DENTAL_CHART_MARK_SHAPES,
} from '../models/DentalChartMarkOption.js'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import { authMiddleware, requireActiveDay, requireRoles } from '../middleware/auth.js'
import { loadBusinessDay } from '../middleware/loadBusinessDay.js'
import { writeAudit } from '../utils/audit.js'
import { patientToDto } from '../utils/dto.js'
import {
  DENTAL_ELIAS_DISPLAY_NAME,
  DENTAL_ELIAS_PROVIDER_KEY,
  DENTAL_ELIAS_VIRTUAL_ID,
  resolveDentalProviderFields,
} from '../services/dentalDoctorConstants.js'
import { listDentalClinicSessions } from '../services/dentalFinanceShares.js'
import { isValidYmd, todayBusinessDate } from '../utils/date.js'
import { round6 } from '../utils/money.js'

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
const SURFACE_SHAPES = new Set(['fill', 'outline', 'cross', 'stripe', 'dot'])

const DEFAULT_CHART_MARKS = [
  { name: 'حشوة سابقة', color: '#c4b5a0', shape: 'fill', category: 'baseline', sortOrder: 0 },
  { name: 'حشوة عيادة', color: '#0d9488', shape: 'fill', category: 'clinic', sortOrder: 1 },
]

function normalizeHexColor(raw, fallback = '#0d9488') {
  const s = String(raw || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]
    const g = s[2]
    const b = s[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return fallback
}

function chartMarkOptionToDto(row) {
  const o = row?.toObject ? row.toObject() : row
  return {
    id: String(o._id),
    name: String(o.name || '').trim(),
    color: normalizeHexColor(o.color),
    shape: SURFACE_SHAPES.has(String(o.shape || '')) ? String(o.shape) : 'fill',
    category: DENTAL_CHART_MARK_CATEGORIES.includes(String(o.category || ''))
      ? String(o.category)
      : 'both',
    active: o.active !== false,
    sortOrder: Number(o.sortOrder) || 0,
  }
}

async function ensureDefaultChartMarks() {
  for (const p of DEFAULT_CHART_MARKS) {
    await DentalChartMarkOption.updateOne(
      { name: p.name },
      {
        $setOnInsert: {
          name: p.name,
          color: p.color,
          shape: p.shape,
          category: p.category,
          active: true,
          sortOrder: p.sortOrder,
        },
      },
      { upsert: true },
    )
  }
}

function surfaceMarkToDto(s) {
  const shapeRaw = String(s?.shape || '').trim()
  const colorRaw = String(s?.color || '').trim()
  return {
    view: s.view === 'occlusal' ? 'occlusal' : 'buccal',
    region: String(s.region || 'O').toUpperCase(),
    label: String(s.label || 'حشوة كومبوزيت').trim().slice(0, 120),
    origin: s.origin === 'clinic' ? 'clinic' : 'preexisting',
    markOptionId: String(s.markOptionId || '').trim().slice(0, 40),
    color: colorRaw ? normalizeHexColor(colorRaw, '') : '',
    shape: SURFACE_SHAPES.has(shapeRaw) ? shapeRaw : '',
  }
}

function normalizeYmd(raw, fallback = '') {
  const s = String(raw || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return fallback
}

function treatmentEffectiveTotalSyp(totalCostSyp, totalCostUsd, costUsdSypRate) {
  const syp = Math.max(0, Math.round(Number(totalCostSyp) || 0))
  const usd = Math.max(0, Number(totalCostUsd) || 0)
  const rate = Math.max(0, Number(costUsdSypRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? Math.round(usd * rate) : 0
  return syp + fromUsd
}

function normalizeTreatment(raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const totalCostSyp = Math.max(0, Math.round(Number(t.totalCostSyp) || 0))
  const totalCostUsd = Math.max(0, round6(Number(t.totalCostUsd) || 0))
  let costUsdSypRate = Math.max(0, Number(t.costUsdSypRate) || 0)
  if (totalCostUsd > 0 && !(costUsdSypRate > 0)) {
    costUsdSypRate = Math.max(0, Number(t._fallbackUsdSypRate) || 0)
  }
  if (!(totalCostUsd > 0)) costUsdSypRate = 0
  const effectiveTotal = treatmentEffectiveTotalSyp(totalCostSyp, totalCostUsd, costUsdSypRate)

  const payments = []
  let paidSum = 0
  if (Array.isArray(t.payments)) {
    for (const p of t.payments) {
      const currency = String(p?.currency || '').toLowerCase() === 'usd' ? 'usd' : 'syp'
      let amountUsd = Math.max(0, round6(Number(p?.amountUsd) || 0))
      let rateUsed = Math.max(0, Number(p?.usdSypRateUsed) || 0)
      let amountSyp = Math.max(0, Math.round(Number(p?.amountSyp) || 0))

      if (currency === 'usd') {
        if (!(amountUsd > 0) && amountSyp > 0 && rateUsed > 0) {
          amountUsd = round6(amountSyp / rateUsed)
        }
        if (!(rateUsed > 0)) rateUsed = costUsdSypRate || Math.max(0, Number(t._fallbackUsdSypRate) || 0)
        if (amountUsd > 0 && rateUsed > 0) {
          amountSyp = Math.round(amountUsd * rateUsed)
        }
      } else {
        amountUsd = 0
        rateUsed = 0
      }

      if (!(amountSyp > 0) && !(amountUsd > 0)) continue
      if (paidSum + amountSyp > effectiveTotal && effectiveTotal > 0) {
        amountSyp = Math.max(0, effectiveTotal - paidSum)
        if (!(amountSyp > 0)) break
        if (currency === 'usd' && rateUsed > 0) amountUsd = round6(amountSyp / rateUsed)
      }
      payments.push({
        amountSyp,
        amountUsd: currency === 'usd' ? amountUsd : 0,
        currency,
        usdSypRateUsed: currency === 'usd' ? rateUsed : 0,
        paidAt: String(p?.paidAt || '').trim().slice(0, 32),
        note: String(p?.note || '').trim().slice(0, 300),
      })
      paidSum += amountSyp
      if (payments.length >= 80) break
    }
  }
  let businessDate = normalizeYmd(t.businessDate)
  if (!businessDate) {
    const firstPay = payments.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p.paidAt || '').slice(0, 10)))
    businessDate = firstPay ? String(firstPay.paidAt).slice(0, 10) : todayBusinessDate()
  }
  const providerRaw = t.providerUserId != null ? String(t.providerUserId).trim() : ''
  const resolved = resolveDentalProviderFields({
    providerUserId: providerRaw,
    providerKey: t.providerKey,
    doctorName: t.doctorName,
  })
  let providerUserId = null
  if (!resolved.isElias && mongoose.Types.ObjectId.isValid(providerRaw)) {
    providerUserId = providerRaw
  }
  const out = {
    procedureDescription: String(t.procedureDescription || '').trim().slice(0, 2000),
    totalCostSyp,
    totalCostUsd,
    costUsdSypRate,
    doctorName: resolved.isElias
      ? DENTAL_ELIAS_DISPLAY_NAME
      : String(resolved.doctorName || t.doctorName || '').trim().slice(0, 160),
    providerUserId,
    providerKey: resolved.isElias ? DENTAL_ELIAS_PROVIDER_KEY : String(resolved.providerKey || '').trim().slice(0, 40),
    businessDate,
    payments,
  }
  if (t._id) out._id = t._id
  return out
}

function treatmentHasContent(n) {
  return (
    Boolean(String(n.procedureDescription || '').trim()) ||
    Number(n.totalCostSyp) > 0 ||
    Number(n.totalCostUsd) > 0 ||
    Boolean(String(n.doctorName || '').trim()) ||
    Boolean(n.providerUserId) ||
    Boolean(String(n.providerKey || '').trim()) ||
    (Array.isArray(n.payments) && n.payments.length > 0)
  )
}

function normalizeTreatmentsList(row, fallbackUsdSypRate = 0) {
  const list = []
  const injectRate = (item) =>
    item && typeof item === 'object' ? { ...item, _fallbackUsdSypRate: fallbackUsdSypRate } : item
  if (Array.isArray(row?.treatments) && row.treatments.length > 0) {
    for (const item of row.treatments) {
      const n = normalizeTreatment(injectRate(item))
      if (treatmentHasContent(n) || list.length === 0) list.push(n)
      if (list.length >= 40) break
    }
  } else if (row?.treatment) {
    const n = normalizeTreatment(injectRate(row.treatment))
    if (treatmentHasContent(n)) list.push(n)
  }
  return list
}

function treatmentToDto(t) {
  const n = normalizeTreatment(t)
  const rawPays = Array.isArray(t?.payments) ? t.payments : []
  const isElias = String(n.providerKey || '') === DENTAL_ELIAS_PROVIDER_KEY
  return {
    id: t?._id ? String(t._id) : undefined,
    procedureDescription: n.procedureDescription,
    totalCostSyp: n.totalCostSyp,
    totalCostUsd: n.totalCostUsd,
    costUsdSypRate: n.costUsdSypRate,
    doctorName: n.doctorName,
    providerUserId: isElias ? DENTAL_ELIAS_VIRTUAL_ID : n.providerUserId ? String(n.providerUserId) : null,
    providerKey: n.providerKey || '',
    businessDate: n.businessDate || '',
    payments: (n.payments || []).map((p, idx) => ({
      id: rawPays[idx]?._id ? String(rawPays[idx]._id) : `p-${idx}`,
      amountSyp: Math.round(Number(p.amountSyp) || 0),
      amountUsd: round6(Number(p.amountUsd) || 0),
      currency: p.currency === 'usd' ? 'usd' : 'syp',
      usdSypRateUsed: Math.max(0, Number(p.usdSypRateUsed) || 0),
      paidAt: String(p.paidAt || ''),
      note: String(p.note || ''),
    })),
  }
}

function normalizeLabWorks(raw, fallbackUsdSypRate = 0) {
  if (!Array.isArray(raw)) return []
  const out = []
  const today = todayBusinessDate()
  for (const row of raw) {
    const labName = String(row?.labName || '').trim().slice(0, 200)
    const procedureDescription = String(row?.procedureDescription || '').trim().slice(0, 1000)
    const amountSyp = Math.max(0, Math.round(Number(row?.amountSyp) || 0))
    const amountUsd = Math.max(0, round6(Number(row?.amountUsd) || 0))
    let usdSypRate = Math.max(0, Number(row?.usdSypRate) || 0)
    if (amountUsd > 0 && !(usdSypRate > 0)) {
      usdSypRate = Math.max(0, Number(fallbackUsdSypRate) || 0)
    }
    if (!(amountUsd > 0)) usdSypRate = 0
    if (!labName && !procedureDescription && !(amountSyp > 0) && !(amountUsd > 0)) continue
    const businessDate = normalizeYmd(row?.businessDate, today)
    const providerRaw = row?.providerUserId != null ? String(row.providerUserId).trim() : ''
    const resolved = resolveDentalProviderFields({
      providerUserId: providerRaw,
      providerKey: row?.providerKey,
      doctorName: row?.doctorName,
    })
    let providerUserId = null
    if (!resolved.isElias && mongoose.Types.ObjectId.isValid(providerRaw)) {
      providerUserId = providerRaw
    }
    const item = {
      labName,
      procedureDescription,
      amountSyp,
      amountUsd,
      usdSypRate,
      businessDate,
      doctorName: resolved.isElias
        ? DENTAL_ELIAS_DISPLAY_NAME
        : String(resolved.doctorName || row?.doctorName || '').trim().slice(0, 160),
      providerUserId,
      providerKey: resolved.isElias
        ? DENTAL_ELIAS_PROVIDER_KEY
        : String(resolved.providerKey || '').trim().slice(0, 40),
    }
    if (row?._id) item._id = row._id
    out.push(item)
    if (out.length >= 80) break
  }
  return out
}

function labWorkToDto(row) {
  const n = normalizeLabWorks([row])[0] || {
    labName: '',
    procedureDescription: '',
    amountSyp: 0,
    amountUsd: 0,
    usdSypRate: 0,
    businessDate: '',
    doctorName: '',
    providerUserId: null,
    providerKey: '',
  }
  const isElias = String(n.providerKey || '') === DENTAL_ELIAS_PROVIDER_KEY
  return {
    id: row?._id ? String(row._id) : undefined,
    labName: n.labName,
    procedureDescription: n.procedureDescription,
    amountSyp: n.amountSyp,
    amountUsd: round6(Number(n.amountUsd) || 0),
    usdSypRate: Math.max(0, Number(n.usdSypRate) || 0),
    businessDate: n.businessDate || '',
    doctorName: n.doctorName || '',
    providerUserId: isElias ? DENTAL_ELIAS_VIRTUAL_ID : n.providerUserId ? String(n.providerUserId) : null,
    providerKey: n.providerKey || '',
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
        statusOrigin: t.statusOrigin === 'clinic' ? 'clinic' : 'preexisting',
        implantColor: t.implantColor === 'teal' || t.implantColor === 'red' ? t.implantColor : null,
        surfaces: (t.surfaces || []).map((s) => surfaceMarkToDto(s)),
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

function normalizeChartTeeth(rawTeeth, fallbackUsdSypRate = 0) {
  if (!Array.isArray(rawTeeth)) return []
  const byFdi = new Map()
  for (const row of rawTeeth) {
    const fdi = Math.round(Number(row?.fdi))
    if (!FDI_VALID.has(fdi)) continue
    let status = String(row?.status || 'present').trim()
    if (status !== 'missing' && status !== 'implant') status = 'present'
    const statusOrigin = row?.statusOrigin === 'clinic' ? 'clinic' : 'preexisting'
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
          origin: s?.origin === 'clinic' ? 'clinic' : 'preexisting',
          markOptionId: String(s?.markOptionId || '').trim().slice(0, 40),
          color: (() => {
            const c = String(s?.color || '').trim()
            return c ? normalizeHexColor(c, '') : ''
          })(),
          shape: SURFACE_SHAPES.has(String(s?.shape || '').trim()) ? String(s.shape).trim() : '',
        })
      }
    }
    const treatments = normalizeTreatmentsList(row, fallbackUsdSypRate)
    const labWorks = normalizeLabWorks(row?.labWorks, fallbackUsdSypRate)
    byFdi.set(fdi, {
      fdi,
      status,
      statusOrigin: status === 'present' ? 'preexisting' : statusOrigin,
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

/** علامات مخطط الأسنان القابلة للتخصيص من لوحة المدير */
dentalRouter.get('/chart-mark-options', async (req, res) => {
  try {
    if (!DENTAL_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    await ensureDefaultChartMarks()
    const rows = await DentalChartMarkOption.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean()
    res.json({ options: rows.map(chartMarkOptionToDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.get('/chart-mark-options/admin', requireRoles('super_admin'), async (_req, res) => {
  try {
    await ensureDefaultChartMarks()
    const rows = await DentalChartMarkOption.find({}).sort({ sortOrder: 1, name: 1 }).lean()
    res.json({ options: rows.map(chartMarkOptionToDto) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.post('/chart-mark-options', requireRoles('super_admin'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120)
    if (!name) {
      res.status(400).json({ error: 'اسم العلامة مطلوب' })
      return
    }
    const color = normalizeHexColor(req.body?.color)
    const shapeRaw = String(req.body?.shape || 'fill').trim()
    const shape = DENTAL_CHART_MARK_SHAPES.includes(shapeRaw) ? shapeRaw : 'fill'
    const categoryRaw = String(req.body?.category || 'both').trim()
    const category = DENTAL_CHART_MARK_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'both'
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 999
    const row = await DentalChartMarkOption.create({
      name,
      color,
      shape,
      category,
      active: req.body?.active !== false,
      sortOrder,
    })
    await writeAudit({
      user: req.user,
      action: 'إضافة علامة لمخطط الأسنان',
      entityType: 'DentalChartMarkOption',
      entityId: row._id,
      details: { name, color, shape, category },
    })
    res.status(201).json({ option: chartMarkOptionToDto(row) })
  } catch (e) {
    if (e?.code === 11000) {
      res.status(400).json({ error: 'اسم العلامة موجود مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

dentalRouter.patch('/chart-mark-options/:id', requireRoles('super_admin'), async (req, res) => {
  try {
    const row = await DentalChartMarkOption.findById(req.params.id)
    if (!row) {
      res.status(404).json({ error: 'العلامة غير موجودة' })
      return
    }
    if (req.body?.name != null) row.name = String(req.body.name).trim().slice(0, 120)
    if (req.body?.color != null) row.color = normalizeHexColor(req.body.color, row.color || '#0d9488')
    if (req.body?.shape != null) {
      const shapeRaw = String(req.body.shape).trim()
      if (DENTAL_CHART_MARK_SHAPES.includes(shapeRaw)) row.shape = shapeRaw
    }
    if (req.body?.category != null) {
      const categoryRaw = String(req.body.category).trim()
      if (DENTAL_CHART_MARK_CATEGORIES.includes(categoryRaw)) row.category = categoryRaw
    }
    if (req.body?.active != null) row.active = req.body.active !== false
    if (req.body?.sortOrder != null) row.sortOrder = Number(req.body.sortOrder) || 0
    if (!String(row.name || '').trim()) {
      res.status(400).json({ error: 'اسم العلامة مطلوب' })
      return
    }
    await row.save()
    await writeAudit({
      user: req.user,
      action: 'تعديل علامة مخطط الأسنان',
      entityType: 'DentalChartMarkOption',
      entityId: row._id,
      details: {
        name: row.name,
        color: row.color,
        shape: row.shape,
        category: row.category,
        active: row.active,
      },
    })
    res.json({ option: chartMarkOptionToDto(row) })
  } catch (e) {
    if (e?.code === 11000) {
      res.status(400).json({ error: 'اسم العلامة موجود مسبقاً' })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** أطباء فرع الأسنان المرتبطون بحسابات المستخدمين (للمخطط والنظام المالي) */
dentalRouter.get('/providers', async (req, res) => {
  try {
    if (!DENTAL_READ.includes(req.user.role)) {
      res.status(403).json({ error: 'لا صلاحية' })
      return
    }
    const users = await User.find({ role: 'dental_branch', active: true })
      .select('name role active')
      .sort({ name: 1 })
      .lean()
    res.json({
      providers: [
        {
          id: DENTAL_ELIAS_VIRTUAL_ID,
          name: DENTAL_ELIAS_DISPLAY_NAME,
          role: 'clinic_owner',
          virtual: true,
          noShare: true,
        },
        ...users.map((u) => ({
          id: String(u._id),
          name: String(u.name || '').trim(),
          role: u.role,
          virtual: false,
          noShare: false,
        })),
      ],
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

/** لوحة المدير: جلسات/إجراءات كل عيادة أسنان (لكل طبيب) */
dentalRouter.get('/admin/clinics', requireRoles('super_admin'), async (req, res) => {
  try {
    const today = todayBusinessDate()
    let from = String(req.query.from || '').trim().slice(0, 10)
    let to = String(req.query.to || '').trim().slice(0, 10)
    if (!isValidYmd(from)) from = `${today.slice(0, 7)}-01`
    if (!isValidYmd(to)) to = today
    if (from > to) {
      const tmp = from
      from = to
      to = tmp
    }
    const clinicKey = String(req.query.clinicKey || req.query.provider || '').trim()
    const data = await listDentalClinicSessions({ from, to, clinicKey })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

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
        patient: patientToDto(doc.patientId, { hidePhone: req.user.role === 'dental_branch' }),
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
    const fallbackRate = Math.max(0, Number(req.businessDay?.usdSypRate) || 0)
    const teeth = normalizeChartTeeth(req.body?.teeth, fallbackRate)
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
        notes: String(plan.notes || ''),
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
    const notes =
      body.notes != null ? String(body.notes).trim().slice(0, 20000) : undefined
    const items = Array.isArray(body.items)
      ? body.items
          .map((it) => ({
            label: String(it?.label || '').trim().slice(0, 500),
            note: String(it?.note || '').trim().slice(0, 2000),
            tooth: Number.isFinite(Number(it?.tooth)) ? Math.round(Number(it.tooth)) : undefined,
          }))
          .filter((it) => it.label || it.note || it.tooth)
          .slice(0, 80)
      : undefined
    let plan = await DentalMasterPlan.findOne({ patientId: patient._id })
    if (!plan) {
      plan = await DentalMasterPlan.create({
        patientId: patient._id,
        status: 'draft',
        notes: notes ?? '',
        items: items ?? [],
        createdBy: req.user._id,
      })
    } else {
      if (plan.status === 'approved' && req.user.role !== 'super_admin') {
        res.status(400).json({ error: 'الخطة معتمدة — تعديل المدير فقط' })
        return
      }
      if (notes !== undefined) plan.notes = notes
      if (items !== undefined) plan.items = items
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
        notes: String(plan.notes || ''),
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
          notes: String(req.body?.notes || '').trim().slice(0, 20000),
          items: req.body?.items ?? [],
          createdBy: req.user._id,
        })
      }
      plan.status = 'approved'
      plan.approvedBy = req.user._id
      plan.approvedAt = new Date()
      if (req.body?.notes != null) plan.notes = String(req.body.notes).trim().slice(0, 20000)
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
          notes: String(plan.notes || ''),
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
