import { Router } from 'express'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
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

function netLineSyp(cost, disc) {
  const c = Number(cost) || 0
  const d = Math.min(100, Math.max(0, Number(disc) || 0))
  return Math.round(c * (1 - d / 100))
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
  /** @type {Map<string, { userId: string, name: string, role: string, department: string, sharePercent: number, lines: object[], totalShareSyp: number }>} */
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
        totalShareSyp: 0,
      })
    }
    return doctorMap.get(id)
  }

  for (const d of docs) {
    const deptKey =
      d.department === 'laser' ? 'laser' : d.department === 'dermatology' ? 'dermatology' : 'dental'
    const netLine = (d.lines || []).find((l) => l.lineType === 'net_revenue')
    const shareLine = (d.lines || []).find((l) => l.lineType === 'doctor_share')
    const net = Math.round(Number(netLine?.amountSyp) || 0)
    const shareSyp = Math.round(Number(shareLine?.amountSyp) || 0)
    revenueByDept[deptKey] = Math.round(revenueByDept[deptKey] + net)
    deptLineCount[deptKey] += 1

    const op = d.providerUserId
    const entry = ensureDoctor(op)
    const snapPct = Number(d.parameterSnapshot?.resolvedDoctorSharePercent)
    const pct = Number.isFinite(snapPct) ? snapPct : entry ? entry.sharePercent : 0
    const inp = d.sourceInputSnapshot && typeof d.sourceInputSnapshot === 'object' ? d.sourceInputSnapshot : {}
    const grossSyp = Math.round(Number(inp.gross_syp) || 0)
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
      grossSyp,
      discountPercent,
      netSyp: net,
      appliedSharePercent: pct,
      shareSyp,
      explanation: `مستند مالي ${String(d._id).slice(-6)} — صافي ${net} ل.س — نسبة مرجعية ${pct}%`,
    }
    if (entry) {
      entry.lines.push(line)
      entry.totalShareSyp = Math.round(entry.totalShareSyp + shareSyp)
    }
  }

  const totalRevenueSyp = Math.round(revenueByDept.laser + revenueByDept.dermatology + revenueByDept.dental)
  const doctors = [...doctorMap.values()]
    .filter((doc) => doc.lines.length > 0)
    .sort((a, b) => b.totalShareSyp - a.totalShareSyp)
  const totalDoctorSharesSyp = Math.round(doctors.reduce((s, doc) => s + doc.totalShareSyp, 0))
  const clinicNetFromDocs = Math.round(
    docs.reduce((s, doc) => {
      const ln = (doc.lines || []).find((l) => l.lineType === 'clinic_net')
      return s + Math.round(Number(ln?.amountSyp) || 0)
    }, 0),
  )
  const estimatedNetProfitSyp =
    clinicNetFromDocs > 0 ? clinicNetFromDocs : Math.round(totalRevenueSyp - totalDoctorSharesSyp)

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
    totalRevenueSyp <= 0
      ? { key: null, label: '—', revenueSyp: 0 }
      : {
          key: topDepartmentKey,
          label: REV_DEPT_LABEL[topDepartmentKey] ?? topDepartmentKey,
          revenueSyp: Math.round(topRev),
        }

  const revenueByDepartment = ['laser', 'dermatology', 'dental'].map((key) => ({
    key,
    label: REV_DEPT_LABEL[key],
    revenueSyp: Math.round(revenueByDept[key]),
    lineCount: deptLineCount[key],
  }))

  return {
    startDate,
    endDate,
    totalRevenueSyp,
    totalDoctorSharesSyp,
    estimatedNetProfitSyp,
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

    /** @type {Map<string, { userId: string, name: string, role: string, department: string, sharePercent: number, lines: object[], totalShareSyp: number }>} */
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
          totalShareSyp: 0,
        })
      }
      return doctorMap.get(id)
    }

    for (const s of laserSessions) {
      const net = netLineSyp(s.costSyp, s.discountPercent)
      revenueByDept.laser = Math.round(revenueByDept.laser + net)
      deptLineCount.laser += 1
      const op = s.operatorUserId
      const entry = ensureDoctor(op)
      const pct = entry ? entry.sharePercent : 0
      const shareSyp = Math.round(net * (pct / 100))
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
        grossSyp: Math.round(Number(s.costSyp) || 0),
        discountPercent: Number(s.discountPercent) || 0,
        netSyp: net,
        appliedSharePercent: pct,
        shareSyp,
        explanation: `صافي السطر ${net} ل.س × نسبة الاستحقاق المعرفة للمستخدم (${pct}%)`,
      }
      if (entry) {
        entry.lines.push(line)
        entry.totalShareSyp = Math.round(entry.totalShareSyp + shareSyp)
      }
    }

    for (const v of dermVisits) {
      const net = netLineSyp(v.costSyp, v.discountPercent)
      revenueByDept.dermatology = Math.round(revenueByDept.dermatology + net)
      deptLineCount.dermatology += 1
      const prov = v.providerUserId
      const entry = ensureDoctor(prov)
      const pct = entry ? entry.sharePercent : 0
      const shareSyp = Math.round(net * (pct / 100))
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
        grossSyp: Math.round(Number(v.costSyp) || 0),
        discountPercent: Number(v.discountPercent) || 0,
        netSyp: net,
        appliedSharePercent: pct,
        shareSyp,
        explanation: `صافي السطر ${net} ل.س × نسبة الاستحقاق المعرفة للمستخدم (${pct}%)`,
      }
      if (entry) {
        entry.lines.push(line)
        entry.totalShareSyp = Math.round(entry.totalShareSyp + shareSyp)
      }
    }

    const totalRevenueSyp = Math.round(revenueByDept.laser + revenueByDept.dermatology + revenueByDept.dental)

    const doctors = [...doctorMap.values()]
      .filter((d) => d.lines.length > 0)
      .sort((a, b) => b.totalShareSyp - a.totalShareSyp)

    const totalDoctorSharesSyp = Math.round(doctors.reduce((s, d) => s + d.totalShareSyp, 0))
    const estimatedNetProfitSyp = Math.round(totalRevenueSyp - totalDoctorSharesSyp)

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
      totalRevenueSyp <= 0
        ? { key: null, label: '—', revenueSyp: 0 }
        : { key: topDepartmentKey, label: REV_DEPT_LABEL[topDepartmentKey] ?? topDepartmentKey, revenueSyp: Math.round(topRev) }

    const revenueByDepartment = ['laser', 'dermatology', 'dental'].map((key) => ({
      key,
      label: REV_DEPT_LABEL[key],
      revenueSyp: Math.round(revenueByDept[key]),
      lineCount: deptLineCount[key],
    }))

    res.json({
      startDate,
      endDate,
      totalRevenueSyp,
      totalDoctorSharesSyp,
      estimatedNetProfitSyp,
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
      costSyp: Number(s.costSyp) || 0,
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
      costSyp: Number(v.costSyp) || 0,
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
      const netSyp = Math.round(r.costSyp * (1 - disc / 100))
      let finalSyp = netSyp
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
        costSyp: r.costSyp,
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
      rows,
      reportingBasis: ledgerDocs.length ? 'posted_ledger_mixed' : 'operational_only',
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
