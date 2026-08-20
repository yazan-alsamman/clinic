import mongoose from 'mongoose'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import {
  DENTAL_ELIAS_DISPLAY_NAME,
  DENTAL_ELIAS_PROVIDER_KEY,
  DENTAL_ELIAS_VIRTUAL_ID,
  isEliasProviderRef,
} from './dentalDoctorConstants.js'
import {
  dentalSharePercentFor,
  loadDoctorShareContext,
  namedDentalPercent,
} from './doctorShareSettings.js'
import {
  loadDentalSettlementPaidMaps,
  settlementPaidForDentalTreatment,
} from './dentalChartBilling.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

/** تكلفة المخبر المكافئة بالليرة = ل.س + دولار×سعر الصرف */
export function labEffectiveAmountSyp(lab) {
  const syp = roundMoney(lab?.amountSyp)
  const usd = Math.max(0, Number(lab?.amountUsd) || 0)
  const rate = Math.max(0, Number(lab?.usdSypRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? roundMoney(usd * rate) : 0
  return syp + fromUsd
}

function inRange(ymd, from, to) {
  const d = String(ymd || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  return d >= from && d <= to
}

export function providerNameMatchesAyham(name) {
  const raw = String(name || '').trim()
  const s = raw.toLowerCase()
  return /ايهم|أيهم|ayham|aiham/.test(raw) || s.includes('ayham')
}

export function providerNameMatchesIyad(name) {
  const raw = String(name || '').trim()
  const s = raw.toLowerCase()
  return /اياد|إياد|iyad|eyad|iad/.test(raw) || s.includes('iyad') || s.includes('eyad')
}

export function providerNameMatchesOmar(name) {
  const raw = String(name || '').trim()
  const s = raw.toLowerCase()
  return /عمر|omar|omer/.test(raw) || s.includes('omar')
}

const DENTAL_CHART_PATIENT_FILTER = {
  $or: [
    { 'dentalChart.teeth.0': { $exists: true } },
    { 'dentalChart.generalTreatments.0': { $exists: true } },
    { 'dentalChart.generalLabWorks.0': { $exists: true } },
    { 'dentalChart.orthodonticCases.0': { $exists: true } },
    { departments: 'dental' },
  ],
}

function treatmentHasAccountContent(tr) {
  const cost = treatmentCostSyp(tr)
  const paid = treatmentPaidSyp(tr)
  const desc = String(tr.procedureDescription || '').trim()
  const hasDoctor =
    Boolean(tr.providerUserId) ||
    Boolean(String(tr.providerKey || '').trim()) ||
    Boolean(String(tr.doctorName || '').trim())
  return {
    cost,
    paid,
    desc,
    include: cost > 0 || Boolean(desc) || hasDoctor || paid > 0,
  }
}

function generalProcedureLabel(desc) {
  const d = String(desc || '').trim()
  if (!d) return 'إجراء عام'
  if (/^إجراء عام/.test(d)) return d
  return `إجراء عام — ${d}`
}

function orthoInstallmentAsTreatment(orthoCase, inst) {
  const title = String(orthoCase?.title || 'تقويم').trim() || 'تقويم'
  const note = String(inst?.note || '').trim()
  return {
    _id: inst?._id,
    procedureDescription: note ? `تقويم — ${title} — ${note}` : `تقويم — ${title}`,
    totalCostSyp: roundMoney(inst?.amountSyp),
    totalCostUsd: Math.max(0, Number(inst?.amountUsd) || 0),
    costUsdSypRate: Math.max(0, Number(inst?.costUsdSypRate) || 0),
    doctorName: String(orthoCase?.doctorName || '').trim(),
    providerUserId: orthoCase?.providerUserId || null,
    providerKey: String(orthoCase?.providerKey || '').trim(),
    businessDate: String(inst?.businessDate || '').trim().slice(0, 10),
    payments: Array.isArray(inst?.payments) ? inst.payments : [],
    billingItemId: inst?.billingItemId || null,
    clinicalSessionId: inst?.clinicalSessionId || null,
  }
}

/**
 * حصة التقويم: من المسدّد بعد طرح مستلزمات الحالة (مثل المخبر قبل نسبة الطبيب).
 */
function orthoSupplyCostSyp(s) {
  const rate = Math.max(0, Number(s?.costUsdSypRate) || 0)
  const usdPart = Math.max(0, Number(s?.amountUsd) || 0)
  return (
    roundMoney(s?.amountSyp) + (usdPart > 0 && rate > 0 ? roundMoney(usdPart * rate) : 0)
  )
}

function orthoSuppliesInRange(orthoCase, from, to) {
  let total = 0
  for (const s of orthoCase?.supplies || []) {
    const amt = orthoSupplyCostSyp(s)
    if (!(amt > 0)) continue
    let bd = String(s.businessDate || '').trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
      bd = String(orthoCase?.startedAt || '').trim().slice(0, 10)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) continue
    if (!inRange(bd, from, to)) continue
    total += amt
  }
  return roundMoney(total)
}

function accumulateOrthoPaidShare({
  orthoCase,
  from,
  to,
  userById,
  byDoctor,
  bumpNamed,
  addRevenue,
  addLabs,
}) {
  let paidInRange = 0
  for (const inst of orthoCase?.installments || []) {
    for (const pay of inst.payments || []) {
      const paidAt = String(pay.paidAt || '').trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) continue
      if (!inRange(paidAt, from, to)) continue
      const amount = roundMoney(pay.amountSyp)
      if (!(amount > 0)) continue
      paidInRange += amount
    }
  }
  const suppliesInRange = orthoSuppliesInRange(orthoCase, from, to)
  if (!(paidInRange > 0) && !(suppliesInRange > 0)) return 0

  const uid = orthoCase.providerUserId ? String(orthoCase.providerUserId) : ''
  const name = String(orthoCase.doctorName || userById.get(uid) || '').trim()
  const matchName = name || userById.get(uid) || ''
  const isElias = isEliasProviderRef({
    providerUserId: uid || orthoCase.providerUserId,
    providerKey: orthoCase.providerKey,
    doctorName: matchName,
  })

  if (addRevenue && paidInRange > 0) addRevenue(paidInRange)
  if (addLabs && suppliesInRange > 0) addLabs(suppliesInRange, isElias)

  /** أساس الحصة = المسدّد − المستلزمات (لا يقل عن صفر) */
  const shareBase = Math.max(0, paidInRange - suppliesInRange)
  if (!(shareBase > 0) && !(suppliesInRange > 0)) return 0

  if (shareBase > 0) {
    const key = isElias ? DENTAL_ELIAS_PROVIDER_KEY : uid || name || '—'
    const prev = byDoctor.get(key) || {
      userId: isElias ? null : uid || null,
      providerKey: isElias ? DENTAL_ELIAS_PROVIDER_KEY : '',
      name: isElias ? DENTAL_ELIAS_DISPLAY_NAME : name || '—',
      proceduresSyp: 0,
      shareSyp: 0,
      noShare: isElias,
    }
    prev.proceduresSyp += shareBase
    prev.name = isElias ? DENTAL_ELIAS_DISPLAY_NAME : name || prev.name
    if (uid && !isElias) prev.userId = uid
    byDoctor.set(key, prev)

    if (typeof bumpNamed === 'function') bumpNamed(shareBase, isElias, matchName)
  }
  return shareBase
}

/**
 * يجمع إيرادات مخطط الأسنان وحصص الأطباء والمخابر ضمن نطاق التاريخ.
 * نسبة كل طبيب تُقرأ من حسابه؛ د. الياس من إعداد النسبة الافتراضية الخاص به (قد تكون 0).
 */
export async function summarizeDentalChartFinance({ from, to }) {
  const patients = await Patient.find(DENTAL_CHART_PATIENT_FILTER)
    .select('dentalChart name')
    .lean()

  const ctx = await loadDoctorShareContext()
  const userById = new Map(
    ctx.users
      .filter((u) => u.role === 'dental_branch')
      .map((u) => [String(u._id), String(u.name || '').trim()]),
  )
  const dentalDefault = ctx.settings.departmentDefaults.dental

  let totalRevenueSyp = 0
  let labWorksTotalSyp = 0
  let eliasProceduresSyp = 0
  let eliasLabWorksSyp = 0
  let ayhamProceduresSyp = 0
  let iyadProceduresSyp = 0
  let omarProceduresSyp = 0
  let otherProceduresSyp = 0
  const byDoctor = new Map()

  for (const p of patients) {
    for (const tooth of p.dentalChart?.teeth || []) {
      const toothTreatmentsInRange = []

      for (const tr of tooth.treatments || []) {
        const rate = Math.max(0, Number(tr.costUsdSypRate) || 0)
        const usdPart = Math.max(0, Number(tr.totalCostUsd) || 0)
        const cost =
          roundMoney(tr.totalCostSyp) + (usdPart > 0 && rate > 0 ? roundMoney(usdPart * rate) : 0)
        if (
          !(cost > 0) &&
          !String(tr.procedureDescription || '').trim() &&
          !String(tr.doctorName || '').trim() &&
          !tr.providerUserId &&
          !tr.providerKey
        ) {
          continue
        }
        let bd = String(tr.businessDate || '').trim().slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
          const firstPay = (tr.payments || []).find((x) =>
            /^\d{4}-\d{2}-\d{2}$/.test(String(x.paidAt || '').slice(0, 10)),
          )
          bd = firstPay ? String(firstPay.paidAt).slice(0, 10) : ''
        }
        if (bd && !inRange(bd, from, to)) continue
        if (!bd) continue

        const uid = tr.providerUserId ? String(tr.providerUserId) : ''
        const name = String(tr.doctorName || userById.get(uid) || '').trim()
        const matchName = name || userById.get(uid) || ''
        const isElias = isEliasProviderRef({
          providerUserId: uid || tr.providerUserId,
          providerKey: tr.providerKey,
          doctorName: matchName,
        })

        if (cost > 0) totalRevenueSyp += cost

        const key = isElias ? DENTAL_ELIAS_PROVIDER_KEY : uid || name || '—'
        const prev = byDoctor.get(key) || {
          userId: isElias ? null : uid || null,
          providerKey: isElias ? DENTAL_ELIAS_PROVIDER_KEY : '',
          name: isElias ? DENTAL_ELIAS_DISPLAY_NAME : name || '—',
          proceduresSyp: 0,
          shareSyp: 0,
          noShare: isElias,
        }
        prev.proceduresSyp += cost
        prev.name = isElias ? DENTAL_ELIAS_DISPLAY_NAME : name || prev.name
        if (uid && !isElias) prev.userId = uid
        byDoctor.set(key, prev)

        toothTreatmentsInRange.push({ cost, isElias, name: matchName })

        if (isElias) eliasProceduresSyp += cost
        else if (providerNameMatchesAyham(matchName)) ayhamProceduresSyp += cost
        else if (providerNameMatchesIyad(matchName)) iyadProceduresSyp += cost
        else if (providerNameMatchesOmar(matchName)) omarProceduresSyp += cost
        else otherProceduresSyp += cost

        const gaAmt = generalAnesthesiaCostSyp(tr)
        if (gaAmt > 0) {
          labWorksTotalSyp += gaAmt
          if (isElias) eliasLabWorksSyp += gaAmt
        }
      }

      for (const lab of tooth.labWorks || []) {
        const amt = labEffectiveAmountSyp(lab)
        if (!(amt > 0)) continue
        let bd = String(lab.businessDate || '').trim().slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) continue
        if (!inRange(bd, from, to)) continue
        labWorksTotalSyp += amt

        const labUid = lab.providerUserId ? String(lab.providerUserId) : ''
        const labName = String(lab.doctorName || userById.get(labUid) || '').trim()
        let labIsElias = isEliasProviderRef({
          providerUserId: labUid || lab.providerUserId,
          providerKey: lab.providerKey,
          doctorName: labName,
        })

        /** إن لم يُربط المخبر بطبيب: يُنسب لد. الياس إذا كانت إجراءات هذا السن في النطاق له فقط */
        if (!labIsElias && !labUid && !String(lab.providerKey || '').trim() && !labName) {
          const withCost = toothTreatmentsInRange.filter((t) => t.cost > 0)
          if (withCost.length > 0 && withCost.every((t) => t.isElias)) labIsElias = true
        }

        if (labIsElias) eliasLabWorksSyp += amt
      }
    }

    for (const tr of p.dentalChart?.generalTreatments || []) {
      const rate = Math.max(0, Number(tr.costUsdSypRate) || 0)
      const usdPart = Math.max(0, Number(tr.totalCostUsd) || 0)
      const cost =
        roundMoney(tr.totalCostSyp) + (usdPart > 0 && rate > 0 ? roundMoney(usdPart * rate) : 0)
      const gaAmtEarly = generalAnesthesiaCostSyp(tr)
      if (
        !(cost > 0) &&
        !(gaAmtEarly > 0) &&
        !String(tr.procedureDescription || '').trim() &&
        !String(tr.doctorName || '').trim() &&
        !tr.providerUserId &&
        !tr.providerKey
      ) {
        continue
      }
      let bd = String(tr.businessDate || '').trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
        const firstPay = (tr.payments || []).find((x) =>
          /^\d{4}-\d{2}-\d{2}$/.test(String(x.paidAt || '').slice(0, 10)),
        )
        bd = firstPay ? String(firstPay.paidAt).slice(0, 10) : ''
      }
      if (bd && !inRange(bd, from, to)) continue
      if (!bd) continue

      const uid = tr.providerUserId ? String(tr.providerUserId) : ''
      const name = String(tr.doctorName || userById.get(uid) || '').trim()
      const matchName = name || userById.get(uid) || ''
      const isElias = isEliasProviderRef({
        providerUserId: uid || tr.providerUserId,
        providerKey: tr.providerKey,
        doctorName: matchName,
      })

      if (cost > 0) totalRevenueSyp += cost

      const key = isElias ? DENTAL_ELIAS_PROVIDER_KEY : uid || name || '—'
      const prev = byDoctor.get(key) || {
        userId: isElias ? null : uid || null,
        providerKey: isElias ? DENTAL_ELIAS_PROVIDER_KEY : '',
        name: isElias ? DENTAL_ELIAS_DISPLAY_NAME : name || '—',
        proceduresSyp: 0,
        shareSyp: 0,
        noShare: isElias,
      }
      prev.proceduresSyp += cost
      prev.name = isElias ? DENTAL_ELIAS_DISPLAY_NAME : name || prev.name
      if (uid && !isElias) prev.userId = uid
      byDoctor.set(key, prev)

      if (isElias) eliasProceduresSyp += cost
      else if (providerNameMatchesAyham(matchName)) ayhamProceduresSyp += cost
      else if (providerNameMatchesIyad(matchName)) iyadProceduresSyp += cost
      else if (providerNameMatchesOmar(matchName)) omarProceduresSyp += cost
      else otherProceduresSyp += cost

      const gaAmt = generalAnesthesiaCostSyp(tr)
      if (gaAmt > 0) {
        labWorksTotalSyp += gaAmt
        if (isElias) eliasLabWorksSyp += gaAmt
      }
    }

    for (const lab of p.dentalChart?.generalLabWorks || []) {
      const amt = labEffectiveAmountSyp(lab)
      if (!(amt > 0)) continue
      let bd = String(lab.businessDate || '').trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) continue
      if (!inRange(bd, from, to)) continue
      labWorksTotalSyp += amt

      const labUid = lab.providerUserId ? String(lab.providerUserId) : ''
      const labName = String(lab.doctorName || userById.get(labUid) || '').trim()
      const labIsElias = isEliasProviderRef({
        providerUserId: labUid || lab.providerUserId,
        providerKey: lab.providerKey,
        doctorName: labName,
      })
      if (labIsElias) eliasLabWorksSyp += amt
    }

    for (const orthoCase of p.dentalChart?.orthodonticCases || []) {
      accumulateOrthoPaidShare({
        orthoCase,
        from,
        to,
        userById,
        byDoctor,
        addRevenue: (amt) => {
          totalRevenueSyp += amt
        },
        addLabs: (amt, isElias) => {
          labWorksTotalSyp += amt
          if (isElias) eliasLabWorksSyp += amt
        },
        bumpNamed: (amt, isElias, matchName) => {
          if (isElias) eliasProceduresSyp += amt
          else if (providerNameMatchesAyham(matchName)) ayhamProceduresSyp += amt
          else if (providerNameMatchesIyad(matchName)) iyadProceduresSyp += amt
          else if (providerNameMatchesOmar(matchName)) omarProceduresSyp += amt
          else otherProceduresSyp += amt
        },
      })
    }
  }

  const doctorRows = [...byDoctor.values()]
    .map((r) => {
      const isElias = r.providerKey === DENTAL_ELIAS_PROVIDER_KEY
      const sharePercent = dentalSharePercentFor(
        { isElias, userId: r.userId, name: r.name },
        ctx,
      )
      const noShare = sharePercent <= 0
      return {
        ...r,
        proceduresSyp: roundMoney(r.proceduresSyp),
        sharePercent,
        shareSyp: roundMoney((r.proceduresSyp * sharePercent) / 100),
        noShare,
      }
    })
    .sort((a, b) => b.proceduresSyp - a.proceduresSyp)

  const ayhamSharePercent = namedDentalPercent(providerNameMatchesAyham, ctx)
  const iyadSharePercent = namedDentalPercent(providerNameMatchesIyad, ctx)
  const omarSharePercent = namedDentalPercent(providerNameMatchesOmar, ctx)
  const eliasSharePercent = dentalSharePercentFor({ isElias: true }, ctx)

  const ayhamShareSyp = roundMoney((ayhamProceduresSyp * ayhamSharePercent) / 100)
  const iyadShareSyp = roundMoney((iyadProceduresSyp * iyadSharePercent) / 100)
  const omarShareSyp = roundMoney((omarProceduresSyp * omarSharePercent) / 100)
  const eliasShareSyp = roundMoney((eliasProceduresSyp * eliasSharePercent) / 100)
  const doctorSharesTotalSyp = roundMoney(doctorRows.reduce((s, r) => s + r.shareSyp, 0))
  const otherShareSyp = roundMoney(
    Math.max(0, doctorSharesTotalSyp - ayhamShareSyp - iyadShareSyp - omarShareSyp - eliasShareSyp),
  )

  totalRevenueSyp = roundMoney(totalRevenueSyp)
  labWorksTotalSyp = roundMoney(labWorksTotalSyp)
  eliasProceduresSyp = roundMoney(eliasProceduresSyp)
  eliasLabWorksSyp = roundMoney(eliasLabWorksSyp)
  const eliasNetToClinicSyp = roundMoney(eliasProceduresSyp - eliasShareSyp - eliasLabWorksSyp)
  const clinicRemainderAfterSharesSyp = roundMoney(totalRevenueSyp - doctorSharesTotalSyp)
  const netProfitBeforeExpensesSyp = roundMoney(clinicRemainderAfterSharesSyp - labWorksTotalSyp)

  return {
    sharePercent: dentalDefault,
    ayhamSharePercent,
    iyadSharePercent,
    omarSharePercent,
    eliasSharePercent,
    totalRevenueSyp,
    labWorksTotalSyp,
    eliasProceduresSyp,
    eliasLabWorksSyp,
    eliasShareSyp,
    eliasNetToClinicSyp,
    ayhamProceduresSyp: roundMoney(ayhamProceduresSyp),
    iyadProceduresSyp: roundMoney(iyadProceduresSyp),
    omarProceduresSyp: roundMoney(omarProceduresSyp),
    otherProceduresSyp: roundMoney(otherProceduresSyp),
    ayhamShareSyp,
    iyadShareSyp,
    omarShareSyp,
    otherShareSyp,
    doctorSharesTotalSyp,
    clinicRemainderAfterSharesSyp,
    netProfitBeforeExpensesSyp,
    doctors: doctorRows,
  }
}

export function isValidProviderObjectId(raw) {
  const s = String(raw || '').trim()
  return mongoose.Types.ObjectId.isValid(s) && s !== DENTAL_ELIAS_VIRTUAL_ID
}

function treatmentBusinessDate(tr) {
  let bd = String(tr.businessDate || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(bd)) return bd
  const firstPay = (tr.payments || []).find((x) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(x.paidAt || '').slice(0, 10)),
  )
  return firstPay ? String(firstPay.paidAt).slice(0, 10) : ''
}

function treatmentCostSyp(tr) {
  const rate = Math.max(0, Number(tr.costUsdSypRate) || 0)
  const usdPart = Math.max(0, Number(tr.totalCostUsd) || 0)
  return roundMoney(tr.totalCostSyp) + (usdPart > 0 && rate > 0 ? roundMoney(usdPart * rate) : 0)
}

/** تكلفة التخدير العام — تُحسب مالياً مثل المخبر */
function generalAnesthesiaCostSyp(tr) {
  if (!tr?.generalAnesthesia) return 0
  const rate = Math.max(0, Number(tr.generalAnesthesiaUsdSypRate) || 0)
  const usdPart = Math.max(0, Number(tr.generalAnesthesiaAmountUsd) || 0)
  return (
    roundMoney(tr.generalAnesthesiaAmountSyp) +
    (usdPart > 0 && rate > 0 ? roundMoney(usdPart * rate) : 0)
  )
}

function treatmentPaidSyp(tr) {
  return roundMoney((tr.payments || []).reduce((s, p) => s + roundMoney(p.amountSyp), 0))
}

function treatmentPaidAfterSettlements(tr, maps) {
  const cost = treatmentCostSyp(tr)
  const chartPaid = treatmentPaidSyp(tr)
  const mapped = settlementPaidForDentalTreatment(tr, maps)
  const alreadyOnChart = chartDebtSettlementPaidSyp(tr)
  const extra = Math.max(0, mapped - alreadyOnChart)
  return roundMoney(Math.min(cost, chartPaid + extra))
}

function chartDebtSettlementPaidSyp(tr) {
  return roundMoney(
    (tr.payments || []).reduce((s, p) => {
      return /تسديد ذمة/.test(String(p.note || '')) ? s + roundMoney(p.amountSyp) : s
    }, 0),
  )
}

function resolveDoctorMeta(tr, userById) {
  const uid = tr.providerUserId ? String(tr.providerUserId) : ''
  const name = String(tr.doctorName || userById.get(uid) || '').trim()
  const matchName = name || userById.get(uid) || ''
  const isElias = isEliasProviderRef({
    providerUserId: uid || tr.providerUserId,
    providerKey: tr.providerKey,
    doctorName: matchName,
  })
  const key = isElias ? DENTAL_ELIAS_PROVIDER_KEY : uid || name || '—'
  const displayName = isElias ? DENTAL_ELIAS_DISPLAY_NAME : name || '—'
  return {
    key,
    userId: isElias ? null : uid || null,
    providerKey: isElias ? DENTAL_ELIAS_PROVIDER_KEY : String(tr.providerKey || '').trim(),
    name: displayName,
    clinicLabel: `عيادة ${displayName}`,
    noShare: isElias,
    isElias,
  }
}

/**
 * قائمة تفصيلية بإجراءات/مخابر كل عيادة أسنان (لكل طبيب) ضمن نطاق تاريخ.
 * العيادات تُعرض دائماً من حسابات أطباء الأسنان + د. الياس حتى بلا إجراءات في النطاق.
 * clinicKey: معرف الطبيب أو 'elias' أو فارغ للكل.
 */
export async function listDentalClinicSessions({ from, to, clinicKey = '' }) {
  const patients = await Patient.find(DENTAL_CHART_PATIENT_FILTER)
    .select('dentalChart name fileNumber')
    .lean()

  const ctx = await loadDoctorShareContext()
  const users = ctx.users.filter((u) => u.role === 'dental_branch' && u.active !== false)
  const userById = new Map(users.map((u) => [String(u._id), String(u.name || '').trim()]))
  const settlementMaps = await loadDentalSettlementPaidMaps(patients.map((p) => p._id))
  const unassignedByPatient = new Map(settlementMaps.byPatientUnassigned)

  const filterKey = String(clinicKey || '').trim()
  const clinicsMap = new Map()
  const rows = []

  function ensureClinic(meta) {
    if (!meta.key || meta.key === '—') return null
    if (!clinicsMap.has(meta.key)) {
      clinicsMap.set(meta.key, {
        key: meta.key,
        userId: meta.userId,
        providerKey: meta.providerKey,
        name: meta.name,
        clinicLabel: meta.clinicLabel,
        noShare: meta.noShare,
        treatmentCount: 0,
        labCount: 0,
        proceduresSyp: 0,
        paidSyp: 0,
        remainingSyp: 0,
        labsSyp: 0,
        orthoSupplySyp: 0,
        shareSyp: 0,
      })
    }
    return clinicsMap.get(meta.key)
  }

  /** عيادات ثابتة من الأطباء المسجّلين + د. الياس */
  ensureClinic({
    key: DENTAL_ELIAS_PROVIDER_KEY,
    userId: null,
    providerKey: DENTAL_ELIAS_PROVIDER_KEY,
    name: DENTAL_ELIAS_DISPLAY_NAME,
    clinicLabel: `عيادة ${DENTAL_ELIAS_DISPLAY_NAME}`,
    noShare: true,
    isElias: true,
  })
  for (const u of users) {
    const name = String(u.name || '').trim() || '—'
    const id = String(u._id)
    ensureClinic({
      key: id,
      userId: id,
      providerKey: '',
      name,
      clinicLabel: `عيادة ${name}`,
      noShare: false,
      isElias: false,
    })
  }

  for (const p of patients) {
    const patientId = String(p._id)
    const patientName = String(p.name || '').trim() || '—'
    const fileNumber = String(p.fileNumber || '').trim()
    let leftoverUnassigned = unassignedByPatient.get(patientId) || 0
    const consumeChartedUnassigned = (tr) => {
      if (!(leftoverUnassigned > 0)) return
      if (settlementPaidForDentalTreatment(tr, settlementMaps) > 0) return
      leftoverUnassigned = Math.max(0, leftoverUnassigned - chartDebtSettlementPaidSyp(tr))
    }
    for (const tooth of p.dentalChart?.teeth || []) {
      for (const tr of tooth.treatments || []) consumeChartedUnassigned(tr)
    }
    for (const tr of p.dentalChart?.generalTreatments || []) consumeChartedUnassigned(tr)
    for (const orthoCase of p.dentalChart?.orthodonticCases || []) {
      for (const inst of orthoCase.installments || []) {
        consumeChartedUnassigned(orthoInstallmentAsTreatment(orthoCase, inst))
      }
    }
    unassignedByPatient.set(patientId, leftoverUnassigned)

    for (const tooth of p.dentalChart?.teeth || []) {
      const fdi = Number(tooth.fdi) || 0
      const toothTreatmentsMeta = []

      for (const tr of tooth.treatments || []) {
        const cost = treatmentCostSyp(tr)
        const hasContent =
          cost > 0 ||
          Boolean(String(tr.procedureDescription || '').trim()) ||
          Boolean(String(tr.doctorName || '').trim()) ||
          Boolean(tr.providerUserId) ||
          Boolean(tr.providerKey) ||
          (Array.isArray(tr.payments) && tr.payments.length > 0)
        if (!hasContent) continue

        let bd = treatmentBusinessDate(tr)
        const undated = !bd
        /** بلا تاريخ: تُعرض دائماً حتى يراها المدير ويصحّح التاريخ */
        if (!undated && !inRange(bd, from, to)) continue
        if (undated) bd = 'بدون تاريخ'

        const paid = treatmentPaidAfterSettlements(tr, settlementMaps)
        let remaining = Math.max(0, cost - paid)
        const pid = String(p._id)
        let leftover = unassignedByPatient.get(pid) || 0
        if (leftover > 0 && remaining > 0) {
          const take = Math.min(remaining, leftover)
          remaining = Math.max(0, remaining - take)
          leftover = roundMoney(leftover - take)
          unassignedByPatient.set(pid, leftover)
        }
        const paidFinal = roundMoney(cost - remaining)
        const meta = resolveDoctorMeta(tr, userById)
        if (filterKey && meta.key !== filterKey && meta.userId !== filterKey) continue

        toothTreatmentsMeta.push({ cost, meta })
        const clinic = ensureClinic(meta)
        if (clinic) {
          clinic.treatmentCount += 1
          clinic.proceduresSyp += cost
          clinic.paidSyp += paidFinal
          clinic.remainingSyp += remaining
        }

        rows.push({
          kind: 'treatment',
          id: tr._id ? String(tr._id) : `t-${patientId}-${fdi}-${bd}-${rows.length}`,
          patientId,
          patientName,
          fileNumber,
          fdi,
          businessDate: bd,
          undated,
          clinicKey: meta.key,
          clinicLabel: meta.clinicLabel,
          doctorName: meta.name,
          providerUserId: meta.userId,
          noShare: meta.noShare,
          procedureDescription: String(tr.procedureDescription || '').trim(),
          totalCostSyp: cost,
          totalCostUsd: Math.max(0, Number(tr.totalCostUsd) || 0),
          paidSyp: paidFinal,
          remainingSyp: remaining,
          payments: (tr.payments || []).map((pay, idx) => ({
            id: pay._id ? String(pay._id) : `pay-${idx}`,
            amountSyp: roundMoney(pay.amountSyp),
            amountUsd: Number(pay.amountUsd) || 0,
            currency: pay.currency === 'usd' ? 'usd' : 'syp',
            paidAt: String(pay.paidAt || ''),
            note: String(pay.note || ''),
          })),
        })
      }

      for (const lab of tooth.labWorks || []) {
        const amt = labEffectiveAmountSyp(lab)
        if (!(amt > 0) && !String(lab.labName || '').trim() && !String(lab.procedureDescription || '').trim()) {
          continue
        }
        let bd = String(lab.businessDate || '').trim().slice(0, 10)
        const undated = !/^\d{4}-\d{2}-\d{2}$/.test(bd)
        if (!undated && !inRange(bd, from, to)) continue
        if (undated) bd = 'بدون تاريخ'

        let meta = resolveDoctorMeta(lab, userById)
        if ((!meta.userId && !meta.providerKey && (meta.name === '—' || !meta.name)) || meta.key === '—') {
          const withCost = toothTreatmentsMeta.filter((t) => t.cost > 0 || t.meta)
          if (withCost.length > 0 && withCost.every((t) => t.meta.isElias)) {
            meta = resolveDoctorMeta(
              { providerKey: DENTAL_ELIAS_PROVIDER_KEY, doctorName: DENTAL_ELIAS_DISPLAY_NAME },
              userById,
            )
          } else if (withCost.length === 1) {
            meta = withCost[0].meta
          }
        }
        if (filterKey && meta.key !== filterKey && meta.userId !== filterKey) continue

        const clinic = ensureClinic(meta)
        if (clinic) {
          clinic.labCount += 1
          clinic.labsSyp += amt
        }

        rows.push({
          kind: 'lab',
          id: lab._id ? String(lab._id) : `l-${patientId}-${fdi}-${bd}-${rows.length}`,
          patientId,
          patientName,
          fileNumber,
          fdi,
          businessDate: bd,
          undated,
          clinicKey: meta.key,
          clinicLabel: meta.clinicLabel,
          doctorName: meta.name,
          providerUserId: meta.userId,
          noShare: meta.noShare,
          labName: String(lab.labName || '').trim(),
          procedureDescription: String(lab.procedureDescription || '').trim(),
          amountSyp: amt,
          amountUsd: Math.max(0, Number(lab.amountUsd) || 0),
          amountSypOnly: roundMoney(lab.amountSyp),
        })
      }
    }

    for (const tr of p.dentalChart?.generalTreatments || []) {
      const cost = treatmentCostSyp(tr)
      const gaAmt = generalAnesthesiaCostSyp(tr)
      const hasContent =
        cost > 0 ||
        gaAmt > 0 ||
        Boolean(String(tr.procedureDescription || '').trim()) ||
        Boolean(String(tr.doctorName || '').trim()) ||
        Boolean(tr.providerUserId) ||
        Boolean(tr.providerKey) ||
        (Array.isArray(tr.payments) && tr.payments.length > 0)
      if (!hasContent) continue

      let bd = treatmentBusinessDate(tr)
      const undated = !bd
      if (!undated && !inRange(bd, from, to)) continue
      if (undated) bd = 'بدون تاريخ'

      const paid = treatmentPaidAfterSettlements(tr, settlementMaps)
      let remaining = Math.max(0, cost - paid)
      const leftover = unassignedByPatient.get(patientId) || 0
      if (leftover > 0 && remaining > 0) {
        const take = Math.min(remaining, leftover)
        remaining = Math.max(0, remaining - take)
        unassignedByPatient.set(patientId, roundMoney(leftover - take))
      }
      const paidFinal = roundMoney(cost - remaining)
      const meta = resolveDoctorMeta(tr, userById)
      if (filterKey && meta.key !== filterKey && meta.userId !== filterKey) continue

      const clinic = ensureClinic(meta)
      if (clinic) {
        clinic.treatmentCount += 1
        clinic.proceduresSyp += cost
        clinic.paidSyp += paidFinal
        clinic.remainingSyp += remaining
      }

      rows.push({
        kind: 'treatment',
        id: tr._id ? String(tr._id) : `g-${patientId}-${bd}-${rows.length}`,
        patientId,
        patientName,
        fileNumber,
        fdi: 0,
        isGeneral: true,
        businessDate: bd,
        undated,
        clinicKey: meta.key,
        clinicLabel: meta.clinicLabel,
        doctorName: meta.name,
        providerUserId: meta.userId,
        noShare: meta.noShare,
        procedureDescription: generalProcedureLabel(tr.procedureDescription),
        totalCostSyp: cost,
        totalCostUsd: Math.max(0, Number(tr.totalCostUsd) || 0),
        paidSyp: paidFinal,
        remainingSyp: remaining,
        payments: (tr.payments || []).map((pay, idx) => ({
          id: pay._id ? String(pay._id) : `pay-${idx}`,
          amountSyp: roundMoney(pay.amountSyp),
          amountUsd: Number(pay.amountUsd) || 0,
          currency: pay.currency === 'usd' ? 'usd' : 'syp',
          paidAt: String(pay.paidAt || ''),
          note: String(pay.note || ''),
        })),
      })

      if (gaAmt > 0) {
        if (clinic) {
          clinic.labCount += 1
          clinic.labsSyp += gaAmt
        }
        rows.push({
          kind: 'lab',
          id: tr._id ? `ga-${String(tr._id)}` : `ga-${patientId}-${bd}-${rows.length}`,
          patientId,
          patientName,
          fileNumber,
          fdi: 0,
          isGeneral: true,
          isGeneralAnesthesia: true,
          businessDate: bd,
          undated,
          clinicKey: meta.key,
          clinicLabel: meta.clinicLabel,
          doctorName: meta.name,
          providerUserId: meta.userId,
          noShare: meta.noShare,
          labName: 'تخدير عام',
          procedureDescription: `تخدير عام — ${generalProcedureLabel(tr.procedureDescription)}`,
          amountSyp: gaAmt,
          amountUsd: Math.max(0, Number(tr.generalAnesthesiaAmountUsd) || 0),
          amountSypOnly: roundMoney(tr.generalAnesthesiaAmountSyp),
        })
      }
    }

    for (const lab of p.dentalChart?.generalLabWorks || []) {
      const amt = labEffectiveAmountSyp(lab)
      if (!(amt > 0) && !String(lab.labName || '').trim() && !String(lab.procedureDescription || '').trim()) {
        continue
      }
      let bd = String(lab.businessDate || '').trim().slice(0, 10)
      const undated = !/^\d{4}-\d{2}-\d{2}$/.test(bd)
      if (!undated && !inRange(bd, from, to)) continue
      if (undated) bd = 'بدون تاريخ'

      let meta = resolveDoctorMeta(lab, userById)
      if (filterKey && meta.key !== filterKey && meta.userId !== filterKey) continue

      const clinic = ensureClinic(meta)
      if (clinic) {
        clinic.labCount += 1
        clinic.labsSyp += amt
      }

      rows.push({
        kind: 'lab',
        id: lab._id ? String(lab._id) : `gl-${patientId}-${bd}-${rows.length}`,
        patientId,
        patientName,
        fileNumber,
        fdi: 0,
        isGeneral: true,
        businessDate: bd,
        undated,
        clinicKey: meta.key,
        clinicLabel: meta.clinicLabel,
        doctorName: meta.name,
        providerUserId: meta.userId,
        noShare: meta.noShare,
        labName: String(lab.labName || '').trim(),
        procedureDescription: String(lab.procedureDescription || '').trim() || 'مخبر — إجراء عام',
        amountSyp: amt,
        amountUsd: Math.max(0, Number(lab.amountUsd) || 0),
        amountSypOnly: roundMoney(lab.amountSyp),
      })
    }

    for (const orthoCase of p.dentalChart?.orthodonticCases || []) {
      const meta = resolveDoctorMeta(orthoCase, userById)

      for (const inst of orthoCase.installments || []) {
        const tr = orthoInstallmentAsTreatment(orthoCase, inst)
        const cost = treatmentCostSyp(tr)
        const hasContent =
          cost > 0 ||
          Boolean(String(tr.procedureDescription || '').trim()) ||
          Boolean(String(tr.doctorName || '').trim()) ||
          Boolean(tr.providerUserId) ||
          Boolean(tr.providerKey) ||
          (Array.isArray(tr.payments) && tr.payments.length > 0)
        if (!hasContent) continue

        let bd = treatmentBusinessDate(tr)
        const undated = !bd
        if (!undated && !inRange(bd, from, to)) continue
        if (undated) bd = 'بدون تاريخ'

        const paid = treatmentPaidAfterSettlements(tr, settlementMaps)
        let remaining = Math.max(0, cost - paid)
        const leftover = unassignedByPatient.get(patientId) || 0
        if (leftover > 0 && remaining > 0) {
          const take = Math.min(remaining, leftover)
          remaining = Math.max(0, remaining - take)
          unassignedByPatient.set(patientId, roundMoney(leftover - take))
        }
        const paidFinal = roundMoney(cost - remaining)
        if (filterKey && meta.key !== filterKey && meta.userId !== filterKey) continue

        const clinic = ensureClinic(meta)
        if (clinic) {
          clinic.treatmentCount += 1
          clinic.proceduresSyp += paidFinal
          clinic.paidSyp += paidFinal
          clinic.remainingSyp += remaining
        }

        rows.push({
          kind: 'treatment',
          id: tr._id ? String(tr._id) : `ortho-${patientId}-${bd}-${rows.length}`,
          patientId,
          patientName,
          fileNumber,
          fdi: 0,
          isGeneral: true,
          isOrthodontic: true,
          businessDate: bd,
          undated,
          clinicKey: meta.key,
          clinicLabel: meta.clinicLabel,
          doctorName: meta.name,
          providerUserId: meta.userId,
          noShare: meta.noShare,
          procedureDescription: tr.procedureDescription,
          totalCostSyp: cost,
          totalCostUsd: Math.max(0, Number(tr.totalCostUsd) || 0),
          paidSyp: paidFinal,
          remainingSyp: remaining,
          payments: (tr.payments || []).map((pay, idx) => ({
            id: pay._id ? String(pay._id) : `pay-${idx}`,
            amountSyp: roundMoney(pay.amountSyp),
            amountUsd: Number(pay.amountUsd) || 0,
            currency: pay.currency === 'usd' ? 'usd' : 'syp',
            paidAt: String(pay.paidAt || ''),
            note: String(pay.note || ''),
          })),
        })
      }

      for (const s of orthoCase.supplies || []) {
        const amt = orthoSupplyCostSyp(s)
        const name = String(s?.name || '').trim() || 'مستلزم'
        if (!(amt > 0) && !String(s?.name || '').trim()) continue
        let bd = String(s.businessDate || '').trim().slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) {
          bd = String(orthoCase.startedAt || '').trim().slice(0, 10)
        }
        const undated = !/^\d{4}-\d{2}-\d{2}$/.test(bd)
        if (!undated && !inRange(bd, from, to)) continue
        if (undated) bd = 'بدون تاريخ'
        if (filterKey && meta.key !== filterKey && meta.userId !== filterKey) continue

        const clinic = ensureClinic(meta)
        if (clinic) {
          clinic.labCount += 1
          clinic.labsSyp += amt
          clinic.orthoSupplySyp = roundMoney((clinic.orthoSupplySyp || 0) + amt)
          /** طرح المستلزم من أساس حصة الطبيب قبل النسبة */
          const deduct = Math.min(amt, Math.max(0, clinic.proceduresSyp))
          clinic.proceduresSyp = Math.max(0, clinic.proceduresSyp - deduct)
        }

        rows.push({
          kind: 'lab',
          id: s._id ? String(s._id) : `ortho-sup-${patientId}-${bd}-${rows.length}`,
          patientId,
          patientName,
          fileNumber,
          fdi: 0,
          isGeneral: true,
          isOrthodontic: true,
          isOrthoSupply: true,
          businessDate: bd,
          undated,
          clinicKey: meta.key,
          clinicLabel: meta.clinicLabel,
          doctorName: meta.name,
          providerUserId: meta.userId,
          noShare: meta.noShare,
          labName: name,
          procedureDescription: `مستلزم تقويم — ${name}`,
          amountSyp: amt,
          amountUsd: Math.max(0, Number(s.amountUsd) || 0),
          amountSypOnly: roundMoney(s.amountSyp),
        })
      }
    }
  }

  const clinics = [...clinicsMap.values()]
    .map((c) => {
      const isElias = c.providerKey === DENTAL_ELIAS_PROVIDER_KEY || c.key === DENTAL_ELIAS_PROVIDER_KEY
      const sharePercent = dentalSharePercentFor(
        { isElias, userId: c.userId, name: c.name },
        ctx,
      )
      const noShare = sharePercent <= 0
      const proceduresSyp = roundMoney(c.proceduresSyp)
      const labsSyp = roundMoney(c.labsSyp)
      const orthoSupplySyp = roundMoney(c.orthoSupplySyp || 0)
      const shareSyp = roundMoney((proceduresSyp * sharePercent) / 100)
      return {
        ...c,
        proceduresSyp,
        paidSyp: roundMoney(c.paidSyp),
        remainingSyp: roundMoney(c.remainingSyp),
        labsSyp,
        orthoSupplySyp,
        sharePercent,
        shareSyp,
        noShare,
        /** المستلزمات طُرحت مسبقاً من proceduresSyp وتظهر في labsSyp — نعيد إضافتها مرة حتى لا تُطرح مرتين */
        netToClinicSyp: roundMoney(proceduresSyp - shareSyp - labsSyp + orthoSupplySyp),
      }
    })
    .filter((c) => !filterKey || c.key === filterKey || c.userId === filterKey)
    .sort((a, b) => b.proceduresSyp - a.proceduresSyp || a.name.localeCompare(b.name, 'ar'))

  rows.sort((a, b) => {
    if (a.undated !== b.undated) return a.undated ? -1 : 1
    if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? 1 : -1
    if (a.clinicLabel !== b.clinicLabel) return a.clinicLabel.localeCompare(b.clinicLabel, 'ar')
    return (a.patientName || '').localeCompare(b.patientName || '', 'ar')
  })

  return {
    from,
    to,
    sharePercent: ctx.settings.departmentDefaults.dental,
    filters: { clinicKey: filterKey || null },
    clinics,
    rows,
    totals: {
      treatmentCount: rows.filter((r) => r.kind === 'treatment').length,
      labCount: rows.filter((r) => r.kind === 'lab').length,
      proceduresSyp: roundMoney(clinics.reduce((s, c) => s + c.proceduresSyp, 0)),
      paidSyp: roundMoney(clinics.reduce((s, c) => s + c.paidSyp, 0)),
      remainingSyp: roundMoney(clinics.reduce((s, c) => s + c.remainingSyp, 0)),
      labsSyp: roundMoney(clinics.reduce((s, c) => s + c.labsSyp, 0)),
    },
  }
}

/**
 * لوحة المدير: كل مرضى الأسنان مع الحساب الكامل والإجراءات والطبيب لكل إجراء.
 */
export async function listDentalPatientsAccounts({ q = '' } = {}) {
  const patients = await Patient.find(DENTAL_CHART_PATIENT_FILTER)
    .select('name fileNumber phone dentalChart departments')
    .lean()

  const users = await User.find({ role: 'dental_branch' }).select('name').lean()
  const userById = new Map(users.map((u) => [String(u._id), String(u.name || '').trim()]))
  const needle = String(q || '').trim().toLowerCase()
  const settlementMaps = await loadDentalSettlementPaidMaps(patients.map((p) => p._id))
  const unassignedByPatient = new Map(settlementMaps.byPatientUnassigned)

  const rows = []
  for (const p of patients) {
    const procedures = []
    const pid = String(p._id)
    let leftoverUnassigned = unassignedByPatient.get(pid) || 0
    const consumeChartedUnassigned = (tr) => {
      if (!(leftoverUnassigned > 0)) return
      if (settlementPaidForDentalTreatment(tr, settlementMaps) > 0) return
      leftoverUnassigned = Math.max(0, leftoverUnassigned - chartDebtSettlementPaidSyp(tr))
    }
    for (const tooth of p.dentalChart?.teeth || []) {
      for (const tr of tooth.treatments || []) consumeChartedUnassigned(tr)
    }
    for (const tr of p.dentalChart?.generalTreatments || []) consumeChartedUnassigned(tr)
    for (const orthoCase of p.dentalChart?.orthodonticCases || []) {
      for (const inst of orthoCase.installments || []) {
        consumeChartedUnassigned(orthoInstallmentAsTreatment(orthoCase, inst))
      }
    }
    unassignedByPatient.set(pid, leftoverUnassigned)

    const pushProcedure = (tr, { fdi, isGeneral }) => {
      const { cost, paid, desc, include } = treatmentHasAccountContent(tr)
      if (!include) return
      const meta = resolveDoctorMeta(tr, userById)
      const settlementPaid = settlementPaidForDentalTreatment(tr, settlementMaps)
      const extra = Math.max(0, settlementPaid - chartDebtSettlementPaidSyp(tr))
      let paidFinal = roundMoney(Math.min(cost, paid + extra))
      let remaining = Math.max(0, cost - paidFinal)
      let leftover = unassignedByPatient.get(pid) || 0
      if (leftover > 0 && remaining > 0) {
        const take = Math.min(remaining, leftover)
        paidFinal = roundMoney(paidFinal + take)
        remaining = Math.max(0, remaining - take)
        leftover = roundMoney(leftover - take)
        unassignedByPatient.set(pid, leftover)
      }
      const bd = treatmentBusinessDate(tr) || '—'
      const isOrtho = /^تقويم/.test(String(desc || '').trim())
      procedures.push({
        id: tr._id ? String(tr._id) : `${isGeneral ? 'g' : 't'}-${String(p._id)}-${fdi}-${procedures.length}`,
        fdi: isGeneral ? 0 : fdi,
        isGeneral: Boolean(isGeneral),
        businessDate: bd,
        procedureDescription: isGeneral
          ? isOrtho
            ? desc || 'تقويم'
            : generalProcedureLabel(desc)
          : desc || 'إجراء',
        doctorName: meta.name,
        providerUserId: meta.userId,
        noShare: meta.noShare,
        totalCostSyp: cost,
        totalCostUsd: Math.max(0, Number(tr.totalCostUsd) || 0),
        paidSyp: paidFinal,
        remainingSyp: remaining,
        billingStatus: tr.billingItemId
          ? paidFinal >= cost && cost > 0
            ? 'paid'
            : 'pending_payment'
          : paidFinal >= cost && cost > 0
            ? 'paid'
            : cost > 0
              ? 'unlinked'
              : null,
      })
    }

    for (const tooth of p.dentalChart?.teeth || []) {
      const fdi = Number(tooth.fdi) || 0
      for (const tr of tooth.treatments || []) {
        pushProcedure(tr, { fdi, isGeneral: false })
      }
    }
    for (const tr of p.dentalChart?.generalTreatments || []) {
      pushProcedure(tr, { fdi: 0, isGeneral: true })
    }
    for (const orthoCase of p.dentalChart?.orthodonticCases || []) {
      for (const inst of orthoCase.installments || []) {
        const tr = orthoInstallmentAsTreatment(orthoCase, inst)
        pushProcedure(tr, { fdi: 0, isGeneral: true })
      }
    }

    if (procedures.length === 0 && !(Array.isArray(p.departments) && p.departments.includes('dental'))) {
      continue
    }

    const name = String(p.name || '').trim() || '—'
    const fileNumber = String(p.fileNumber || '').trim()
    if (needle) {
      const hay = `${name} ${fileNumber} ${p.phone || ''}`.toLowerCase()
      if (!hay.includes(needle)) continue
    }

    procedures.sort((a, b) => {
      if (a.businessDate !== b.businessDate) {
        if (a.businessDate === '—') return 1
        if (b.businessDate === '—') return -1
        return a.businessDate < b.businessDate ? 1 : -1
      }
      return a.fdi - b.fdi
    })

    const totalCostSyp = procedures.reduce((s, r) => s + r.totalCostSyp, 0)
    const paidSyp = procedures.reduce((s, r) => s + r.paidSyp, 0)
    const remainingSyp = procedures.reduce((s, r) => s + r.remainingSyp, 0)
    rows.push({
      patientId: String(p._id),
      patientName: name,
      fileNumber,
      phone: String(p.phone || '').trim(),
      procedureCount: procedures.length,
      totalCostSyp: roundMoney(totalCostSyp),
      paidSyp: roundMoney(paidSyp),
      remainingSyp: roundMoney(remainingSyp),
      procedures,
    })
  }

  rows.sort((a, b) => {
    if (b.remainingSyp !== a.remainingSyp) return b.remainingSyp - a.remainingSyp
    return a.patientName.localeCompare(b.patientName, 'ar')
  })

  return {
    patients: rows,
    totals: {
      patientCount: rows.length,
      procedureCount: rows.reduce((s, r) => s + r.procedureCount, 0),
      totalCostSyp: roundMoney(rows.reduce((s, r) => s + r.totalCostSyp, 0)),
      paidSyp: roundMoney(rows.reduce((s, r) => s + r.paidSyp, 0)),
      remainingSyp: roundMoney(rows.reduce((s, r) => s + r.remainingSyp, 0)),
    },
  }
}

