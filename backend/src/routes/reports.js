import { Router } from 'express'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { BusinessDay } from '../models/BusinessDay.js'
import { LaserSession } from '../models/LaserSession.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { LaserAreaCatalog } from '../models/LaserAreaCatalog.js'
import { FinancialDocument } from '../models/FinancialDocument.js'
import { todayBusinessDate } from '../utils/date.js'

export const reportsRouter = Router()

reportsRouter.use(authMiddleware)

const REPORT_ROLES = ['super_admin']

function parseLocalDay(dateStr) {
  const parts = String(dateStr || '')
    .slice(0, 10)
    .split('-')
    .map((x) => parseInt(x, 10))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const [y, m, d] = parts
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end, y, m, d }
}

function ymdFromParsed(p) {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function netLineUsd(cost, disc) {
  const c = Number(cost) || 0
  const d = Math.min(100, Math.max(0, Number(disc) || 0))
  return round2(c * (1 - d / 100))
}

function toYmdLocal(d) {
  const x = d instanceof Date ? d : new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const CLINICAL_ROLES = new Set(['laser', 'dermatology', 'dental_branch'])

function roleToDeptColumn(role) {
  if (role === 'laser') return 'ليزر'
  if (role === 'dermatology') return 'جلدية'
  if (role === 'dental_branch') return 'أسنان'
  return '—'
}

const REV_DEPT_LABEL = {
  laser: 'الليزر',
  dermatology: 'الجلدية',
  dental: 'الأسنان',
}

function parseInsightsRange(startStr, endStr) {
  const today = todayBusinessDate()
  const endParsed = parseLocalDay(endStr || today)
  if (!endParsed) return null
  let start = startStr
  if (!start) {
    const s = new Date(endParsed.start)
    s.setDate(s.getDate() - 29)
    const y = s.getFullYear()
    const m = String(s.getMonth() + 1).padStart(2, '0')
    const d = String(s.getDate()).padStart(2, '0')
    start = `${y}-${m}-${d}`
  }
  const startParsed = parseLocalDay(start)
  if (!startParsed) return null
  if (startParsed.start > endParsed.start) return null
  const rangeStart = startParsed.start
  const rangeEnd = new Date(endParsed.start)
  rangeEnd.setDate(rangeEnd.getDate() + 1)
  return {
    rangeStart,
    rangeEnd,
    startDate: ymdFromParsed(startParsed),
    endDate: ymdFromParsed(endParsed),
  }
}

const SOURCE_LABEL_LEDGER = {
  laser_session: 'جلسة ليزر (مُرحَّلة)',
  dermatology_visit: 'زيارة جلدية (مُرحَّلة)',
  dental_procedure: 'أسنان (مُرحَّلة)',
}

async function buildInsightsFromPostedLedger(startDate, endDate) {
  const docs = await FinancialDocument.find({
    businessDate: { $gte: startDate, $lte: endDate },
    status: 'posted',
  })
    .populate('patientId', 'name')
    .populate('providerUserId', 'name role doctorSharePercent')
    .sort({ businessDate: 1, createdAt: 1 })
    .lean()

  const revenueByDept = { laser: 0, dermatology: 0, dental: 0 }
  const deptLineCount = { laser: 0, dermatology: 0, dental: 0 }
  /** @type {Map<string, { userId: string, name: string, role: string, department: string, sharePercent: number, lines: object[], totalShareUsd: number }>} */
  const doctorMap = new Map()

  function ensureDoctor(user) {
    if (!user?._id) return null
    const id = String(user._id)
    if (!doctorMap.has(id)) {
      const role = user.role || ''
      const pct = CLINICAL_ROLES.has(role) ? Number(user.doctorSharePercent) || 0 : 0
      doctorMap.set(id, {
        userId: id,
        name: user.name || '',
        role,
        department: roleToDeptColumn(role),
        sharePercent: pct,
        lines: [],
        totalShareUsd: 0,
      })
    }
    return doctorMap.get(id)
  }

  for (const d of docs) {
    const deptKey =
      d.department === 'laser' ? 'laser' : d.department === 'dermatology' ? 'dermatology' : 'dental'
    const netLine = (d.lines || []).find((l) => l.lineType === 'net_revenue')
    const shareLine = (d.lines || []).find((l) => l.lineType === 'doctor_share')
    const net = round2(netLine?.amountUsd ?? 0)
    const shareUsd = round2(shareLine?.amountUsd ?? 0)
    revenueByDept[deptKey] = round2(revenueByDept[deptKey] + net)
    deptLineCount[deptKey] += 1

    const op = d.providerUserId
    const entry = ensureDoctor(op)
    const snapPct = Number(d.parameterSnapshot?.resolvedDoctorSharePercent)
    const pct = Number.isFinite(snapPct) ? snapPct : entry ? entry.sharePercent : 0
    const inp = d.sourceInputSnapshot && typeof d.sourceInputSnapshot === 'object' ? d.sourceInputSnapshot : {}
    const grossUsd = round2(Number(inp.gross_usd) || 0)
    const discountPercent = Number(inp.discount_percent) || 0
    const patientName = d.patientId?.name ?? ''
    const descParts = [d.department, d.calculationProfileCode].filter(Boolean)
    const line = {
      date: d.businessDate,
      patientName,
      source: d.sourceType,
      sourceLabel: SOURCE_LABEL_LEDGER[d.sourceType] || d.sourceType,
      description: descParts.join(' — ') || '—',
      revenueDept: deptKey,
      revenueDeptLabel: REV_DEPT_LABEL[deptKey] ?? deptKey,
      grossUsd,
      discountPercent,
      netUsd: net,
      appliedSharePercent: pct,
      shareUsd,
      explanation: `مستند مالي ${String(d._id).slice(-6)} — صافي ${net} USD — نسبة مرجعية ${pct}%`,
    }
    if (entry) {
      entry.lines.push(line)
      entry.totalShareUsd = round2(entry.totalShareUsd + shareUsd)
    }
  }

  const totalRevenueUsd = round2(revenueByDept.laser + revenueByDept.dermatology + revenueByDept.dental)
  const doctors = [...doctorMap.values()]
    .filter((doc) => doc.lines.length > 0)
    .sort((a, b) => b.totalShareUsd - a.totalShareUsd)
  const totalDoctorSharesUsd = round2(doctors.reduce((s, doc) => s + doc.totalShareUsd, 0))
  const clinicNetFromDocs = round2(
    docs.reduce((s, doc) => {
      const ln = (doc.lines || []).find((l) => l.lineType === 'clinic_net')
      return s + round2(ln?.amountUsd ?? 0)
    }, 0),
  )
  const estimatedNetProfitUsd =
    clinicNetFromDocs > 0 ? clinicNetFromDocs : round2(totalRevenueUsd - totalDoctorSharesUsd)

  let topDepartmentKey = 'laser'
  let topRev = -1
  for (const key of ['laser', 'dermatology', 'dental']) {
    const v = revenueByDept[key]
    if (v > topRev) {
      topRev = v
      topDepartmentKey = key
    }
  }
  const topDepartment =
    totalRevenueUsd <= 0
      ? { key: null, label: '—', revenueUsd: 0 }
      : {
          key: topDepartmentKey,
          label: REV_DEPT_LABEL[topDepartmentKey] ?? topDepartmentKey,
          revenueUsd: round2(topRev),
        }

  const revenueByDepartment = ['laser', 'dermatology', 'dental'].map((key) => ({
    key,
    label: REV_DEPT_LABEL[key],
    revenueUsd: round2(revenueByDept[key]),
    lineCount: deptLineCount[key],
  }))

  return {
    startDate,
    endDate,
    totalRevenueUsd,
    totalDoctorSharesUsd,
    estimatedNetProfitUsd,
    topDepartment,
    revenueByDepartment,
    doctors,
    reportingBasis: 'posted_ledger',
  }
}

reportsRouter.get('/insights', requireRoles('super_admin'), async (req, res) => {
  try {
    const bounds = parseInsightsRange(req.query.start, req.query.end)
    if (!bounds) {
      res.status(400).json({ error: 'نطاق التواريخ غير صالح' })
      return
    }
    const { rangeStart, rangeEnd, startDate, endDate } = bounds

    const ledgerProbe = await FinancialDocument.findOne({
      businessDate: { $gte: startDate, $lte: endDate },
      status: 'posted',
    })
      .select('_id')
      .lean()
    if (ledgerProbe) {
      const payload = await buildInsightsFromPostedLedger(startDate, endDate)
      res.json(payload)
      return
    }

    const [catalogRows, laserSessions, dermVisits] = await Promise.all([
      LaserAreaCatalog.find({}).lean(),
      LaserSession.find({
        status: 'completed',
        createdAt: { $gte: rangeStart, $lt: rangeEnd },
      })
        .populate('patientId', 'name')
        .populate('operatorUserId', 'name role doctorSharePercent')
        .sort({ createdAt: 1 })
        .lean(),
      DermatologyVisit.find({
        businessDate: { $gte: startDate, $lte: endDate },
      })
        .populate('patientId', 'name')
        .populate('providerUserId', 'name role doctorSharePercent')
        .sort({ createdAt: 1 })
        .lean(),
    ])

    const areaLabelById = new Map(catalogRows.map((r) => [r.areaId, r.label]))
    function areaLabels(ids) {
      return (ids || []).map((id) => areaLabelById.get(id) || id).join('، ')
    }

    const revenueByDept = { laser: 0, dermatology: 0, dental: 0 }
    const deptLineCount = { laser: 0, dermatology: 0, dental: 0 }

    /** @type {Map<string, { userId: string, name: string, role: string, department: string, sharePercent: number, lines: object[], totalShareUsd: number }>} */
    const doctorMap = new Map()

    function ensureDoctor(user) {
      if (!user?._id) return null
      const id = String(user._id)
      if (!doctorMap.has(id)) {
        const role = user.role || ''
        const pct = CLINICAL_ROLES.has(role) ? Number(user.doctorSharePercent) || 0 : 0
        doctorMap.set(id, {
          userId: id,
          name: user.name || '',
          role,
          department: roleToDeptColumn(role),
          sharePercent: pct,
          lines: [],
          totalShareUsd: 0,
        })
      }
      return doctorMap.get(id)
    }

    for (const s of laserSessions) {
      const net = netLineUsd(s.costUsd, s.discountPercent)
      revenueByDept.laser = round2(revenueByDept.laser + net)
      deptLineCount.laser += 1
      const op = s.operatorUserId
      const entry = ensureDoctor(op)
      const pct = entry ? entry.sharePercent : 0
      const shareUsd = round2(net * (pct / 100))
      const patientName = s.patientId?.name ?? ''
      const sessionType =
        (s.sessionTypeLabel && String(s.sessionTypeLabel).trim()) || `جلسة ليزر ${s.laserType}`
      const desc = [areaLabels(s.areaIds), sessionType].filter(Boolean).join(' — ')
      const line = {
        date: toYmdLocal(s.createdAt),
        patientName,
        source: 'laser_session',
        sourceLabel: 'جلسة ليزر (مكتملة)',
        description: desc,
        revenueDept: 'laser',
        revenueDeptLabel: REV_DEPT_LABEL.laser,
        grossUsd: round2(Number(s.costUsd) || 0),
        discountPercent: Number(s.discountPercent) || 0,
        netUsd: net,
        appliedSharePercent: pct,
        shareUsd,
        explanation: `صافي السطر ${net} USD × نسبة الاستحقاق المعرفة للمستخدم (${pct}%)`,
      }
      if (entry) {
        entry.lines.push(line)
        entry.totalShareUsd = round2(entry.totalShareUsd + shareUsd)
      }
    }

    for (const v of dermVisits) {
      const net = netLineUsd(v.costUsd, v.discountPercent)
      revenueByDept.dermatology = round2(revenueByDept.dermatology + net)
      deptLineCount.dermatology += 1
      const prov = v.providerUserId
      const entry = ensureDoctor(prov)
      const pct = entry ? entry.sharePercent : 0
      const shareUsd = round2(net * (pct / 100))
      const patientName = v.patientId?.name ?? ''
      const desc = [v.areaTreatment, v.sessionType].filter(Boolean).join(' — ')
      const line = {
        date: v.businessDate,
        patientName,
        source: 'dermatology_visit',
        sourceLabel: 'زيارة جلدية / تجميل',
        description: desc || '—',
        revenueDept: 'dermatology',
        revenueDeptLabel: REV_DEPT_LABEL.dermatology,
        grossUsd: round2(Number(v.costUsd) || 0),
        discountPercent: Number(v.discountPercent) || 0,
        netUsd: net,
        appliedSharePercent: pct,
        shareUsd,
        explanation: `صافي السطر ${net} USD × نسبة الاستحقاق المعرفة للمستخدم (${pct}%)`,
      }
      if (entry) {
        entry.lines.push(line)
        entry.totalShareUsd = round2(entry.totalShareUsd + shareUsd)
      }
    }

    const totalRevenueUsd = round2(revenueByDept.laser + revenueByDept.dermatology + revenueByDept.dental)

    const doctors = [...doctorMap.values()]
      .filter((d) => d.lines.length > 0)
      .sort((a, b) => b.totalShareUsd - a.totalShareUsd)

    const totalDoctorSharesUsd = round2(doctors.reduce((s, d) => s + d.totalShareUsd, 0))
    const estimatedNetProfitUsd = round2(totalRevenueUsd - totalDoctorSharesUsd)

    let topDepartmentKey = 'laser'
    let topRev = -1
    for (const key of ['laser', 'dermatology', 'dental']) {
      const v = revenueByDept[key]
      if (v > topRev) {
        topRev = v
        topDepartmentKey = key
      }
    }
    const topDepartment =
      totalRevenueUsd <= 0
        ? { key: null, label: '—', revenueUsd: 0 }
        : { key: topDepartmentKey, label: REV_DEPT_LABEL[topDepartmentKey] ?? topDepartmentKey, revenueUsd: round2(topRev) }

    const revenueByDepartment = ['laser', 'dermatology', 'dental'].map((key) => ({
      key,
      label: REV_DEPT_LABEL[key],
      revenueUsd: round2(revenueByDept[key]),
      lineCount: deptLineCount[key],
    }))

    res.json({
      startDate,
      endDate,
      totalRevenueUsd,
      totalDoctorSharesUsd,
      estimatedNetProfitUsd,
      topDepartment,
      revenueByDepartment,
      doctors,
      reportingBasis: 'operational_estimate',
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

reportsRouter.get('/daily', requireRoles(...REPORT_ROLES), async (req, res) => {
  try {
    const parsed = parseLocalDay(req.query.date)
    if (!parsed) {
      res.status(400).json({ error: 'تاريخ غير صالح' })
      return
    }
    const { start, end } = parsed
    const dateStr = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`

    const bd = await BusinessDay.findOne({ businessDate: dateStr }).lean()
    const exchangeRate = bd?.exchangeRate ?? null

    const [catalogRows, laserSessions, dermVisits] = await Promise.all([
      LaserAreaCatalog.find({}).lean(),
      LaserSession.find({
        createdAt: { $gte: start, $lt: end },
        status: 'completed',
      })
        .populate('patientId', 'name')
        .populate('operatorUserId', 'name')
        .sort({ createdAt: 1 })
        .lean(),
      DermatologyVisit.find({ businessDate: dateStr })
        .populate('patientId', 'name')
        .populate('providerUserId', 'name')
        .sort({ createdAt: 1 })
        .lean(),
    ])

    const areaLabelById = new Map(catalogRows.map((r) => [r.areaId, r.label]))

    function areaLabels(ids) {
      return (ids || []).map((id) => areaLabelById.get(id) || id).join('، ')
    }

    const laserRows = laserSessions.map((s) => ({
      kind: 'laser',
      id: String(s._id),
      patientName: s.patientId?.name ?? '',
      areaTreatment: areaLabels(s.areaIds),
      sessionType: (s.sessionTypeLabel && String(s.sessionTypeLabel).trim()) || `جلسة ليزر ${s.laserType}`,
      costUsd: Number(s.costUsd) || 0,
      discountPercent: Number(s.discountPercent) || 0,
      providerName: s.operatorUserId?.name ?? '',
      notes: s.notes || '',
      recordedAt: s.createdAt,
    }))

    const dermRows = dermVisits.map((v) => ({
      kind: 'dermatology',
      id: String(v._id),
      patientName: v.patientId?.name ?? '',
      areaTreatment: v.areaTreatment || '',
      sessionType: v.sessionType || 'جلدية / تجميل',
      costUsd: Number(v.costUsd) || 0,
      discountPercent: Number(v.discountPercent) || 0,
      providerName: v.providerUserId?.name ?? '',
      notes: v.notes || '',
      recordedAt: v.createdAt,
    }))

    const merged = [...laserRows, ...dermRows].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    )

    const ledgerDocs = await FinancialDocument.find({ businessDate: dateStr, status: 'posted' }).lean()
    const ledgerBySource = new Map(
      ledgerDocs.map((d) => [`${d.sourceType}:${String(d.sourceId)}`, d]),
    )

    const rows = merged.map((r, i) => {
      const disc = r.discountPercent
      const netUsd = r.costUsd * (1 - disc / 100)
      let finalSyp = exchangeRate != null ? Math.round(netUsd * exchangeRate) : null
      const lk = `${r.kind === 'laser' ? 'laser_session' : 'dermatology_visit'}:${r.id}`
      const fd = ledgerBySource.get(lk)
      if (fd) {
        const netLine = (fd.lines || []).find((l) => l.lineType === 'net_revenue')
        if (netLine?.amountSyp != null) finalSyp = netLine.amountSyp
      }
      return {
        operationNumber: String(i + 1).padStart(3, '0'),
        patientName: r.patientName,
        areaTreatment: r.areaTreatment,
        sessionType: r.sessionType,
        costUsd: r.costUsd,
        discountPercent: r.discountPercent,
        providerName: r.providerName,
        finalSyp,
        notes: r.notes || '—',
        source: r.kind,
        sourceId: r.id,
        ledgerPosted: Boolean(fd),
      }
    })

    res.json({
      date: dateStr,
      exchangeRate,
      rows,
      reportingBasis: ledgerDocs.length ? 'posted_ledger_mixed' : 'operational_only',
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
