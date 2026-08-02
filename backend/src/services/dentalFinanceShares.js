import mongoose from 'mongoose'
import { Patient } from '../models/Patient.js'
import { User } from '../models/User.js'
import {
  DENTAL_ELIAS_DISPLAY_NAME,
  DENTAL_ELIAS_PROVIDER_KEY,
  DENTAL_ELIAS_VIRTUAL_ID,
  isEliasProviderRef,
} from './dentalDoctorConstants.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
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

const SHARE_PERCENT = 40

/**
 * يجمع إيرادات مخطط الأسنان وحصص الأطباء والمخابر ضمن نطاق التاريخ.
 * د. الياس: بدون نسبة 40٪ — إجراءاته تُحسب كاملة لربح القسم بعد خصم مخابره.
 */
export async function summarizeDentalChartFinance({ from, to }) {
  const patients = await Patient.find({ 'dentalChart.teeth.0': { $exists: true } })
    .select('dentalChart name')
    .lean()

  const users = await User.find({ role: 'dental_branch', active: true }).select('name').lean()
  const userById = new Map(users.map((u) => [String(u._id), String(u.name || '').trim()]))

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
      }

      for (const lab of tooth.labWorks || []) {
        const amt = roundMoney(lab.amountSyp)
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
  }

  const doctorRows = [...byDoctor.values()]
    .map((r) => {
      const noShare = r.noShare === true || r.providerKey === DENTAL_ELIAS_PROVIDER_KEY
      return {
        ...r,
        proceduresSyp: roundMoney(r.proceduresSyp),
        shareSyp: noShare ? 0 : roundMoney((r.proceduresSyp * SHARE_PERCENT) / 100),
        noShare,
      }
    })
    .sort((a, b) => b.proceduresSyp - a.proceduresSyp)

  const ayhamShareSyp = roundMoney((ayhamProceduresSyp * SHARE_PERCENT) / 100)
  const iyadShareSyp = roundMoney((iyadProceduresSyp * SHARE_PERCENT) / 100)
  const omarShareSyp = roundMoney((omarProceduresSyp * SHARE_PERCENT) / 100)
  const otherShareSyp = roundMoney((otherProceduresSyp * SHARE_PERCENT) / 100)
  /** د. الياس بدون نسبة */
  const doctorSharesTotalSyp = roundMoney(ayhamShareSyp + iyadShareSyp + omarShareSyp + otherShareSyp)

  totalRevenueSyp = roundMoney(totalRevenueSyp)
  labWorksTotalSyp = roundMoney(labWorksTotalSyp)
  eliasProceduresSyp = roundMoney(eliasProceduresSyp)
  eliasLabWorksSyp = roundMoney(eliasLabWorksSyp)
  const eliasNetToClinicSyp = roundMoney(eliasProceduresSyp - eliasLabWorksSyp)
  const clinicRemainderAfterSharesSyp = roundMoney(totalRevenueSyp - doctorSharesTotalSyp)
  const netProfitBeforeExpensesSyp = roundMoney(clinicRemainderAfterSharesSyp - labWorksTotalSyp)

  return {
    sharePercent: SHARE_PERCENT,
    totalRevenueSyp,
    labWorksTotalSyp,
    eliasProceduresSyp,
    eliasLabWorksSyp,
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

function treatmentPaidSyp(tr) {
  return roundMoney((tr.payments || []).reduce((s, p) => s + roundMoney(p.amountSyp), 0))
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
 * clinicKey: معرف الطبيب أو 'elias' أو فارغ للكل.
 */
export async function listDentalClinicSessions({ from, to, clinicKey = '' }) {
  const patients = await Patient.find({ 'dentalChart.teeth.0': { $exists: true } })
    .select('dentalChart name fileNumber')
    .lean()

  const users = await User.find({ role: 'dental_branch' }).select('name active').lean()
  const userById = new Map(users.map((u) => [String(u._id), String(u.name || '').trim()]))

  const filterKey = String(clinicKey || '').trim()
  const clinicsMap = new Map()
  const rows = []

  function ensureClinic(meta) {
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
        shareSyp: 0,
      })
    }
    return clinicsMap.get(meta.key)
  }

  for (const p of patients) {
    const patientId = String(p._id)
    const patientName = String(p.name || '').trim() || '—'
    const fileNumber = String(p.fileNumber || '').trim()

    for (const tooth of p.dentalChart?.teeth || []) {
      const fdi = Number(tooth.fdi) || 0
      const toothTreatmentsMeta = []

      for (const tr of tooth.treatments || []) {
        const bd = treatmentBusinessDate(tr)
        if (!bd || !inRange(bd, from, to)) continue
        const cost = treatmentCostSyp(tr)
        const paid = treatmentPaidSyp(tr)
        const remaining = Math.max(0, cost - paid)
        const meta = resolveDoctorMeta(tr, userById)
        if (filterKey && meta.key !== filterKey && meta.userId !== filterKey) continue

        toothTreatmentsMeta.push({ cost, meta })
        const clinic = ensureClinic(meta)
        clinic.treatmentCount += 1
        clinic.proceduresSyp += cost
        clinic.paidSyp += paid
        clinic.remainingSyp += remaining

        rows.push({
          kind: 'treatment',
          id: tr._id ? String(tr._id) : `t-${patientId}-${fdi}-${bd}-${rows.length}`,
          patientId,
          patientName,
          fileNumber,
          fdi,
          businessDate: bd,
          clinicKey: meta.key,
          clinicLabel: meta.clinicLabel,
          doctorName: meta.name,
          providerUserId: meta.userId,
          noShare: meta.noShare,
          procedureDescription: String(tr.procedureDescription || '').trim(),
          totalCostSyp: cost,
          totalCostUsd: Math.max(0, Number(tr.totalCostUsd) || 0),
          paidSyp: paid,
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
        const amt = roundMoney(lab.amountSyp)
        if (!(amt > 0) && !String(lab.labName || '').trim() && !String(lab.procedureDescription || '').trim()) {
          continue
        }
        let bd = String(lab.businessDate || '').trim().slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) continue
        if (!inRange(bd, from, to)) continue

        let meta = resolveDoctorMeta(lab, userById)
        if (!meta.userId && !meta.providerKey && meta.name === '—') {
          const withCost = toothTreatmentsMeta.filter((t) => t.cost > 0)
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
        clinic.labCount += 1
        clinic.labsSyp += amt

        rows.push({
          kind: 'lab',
          id: lab._id ? String(lab._id) : `l-${patientId}-${fdi}-${bd}-${rows.length}`,
          patientId,
          patientName,
          fileNumber,
          fdi,
          businessDate: bd,
          clinicKey: meta.key,
          clinicLabel: meta.clinicLabel,
          doctorName: meta.name,
          providerUserId: meta.userId,
          noShare: meta.noShare,
          labName: String(lab.labName || '').trim(),
          procedureDescription: String(lab.procedureDescription || '').trim(),
          amountSyp: amt,
        })
      }
    }
  }

  const clinics = [...clinicsMap.values()]
    .map((c) => ({
      ...c,
      proceduresSyp: roundMoney(c.proceduresSyp),
      paidSyp: roundMoney(c.paidSyp),
      remainingSyp: roundMoney(c.remainingSyp),
      labsSyp: roundMoney(c.labsSyp),
      shareSyp: c.noShare ? 0 : roundMoney((c.proceduresSyp * SHARE_PERCENT) / 100),
      netToClinicSyp: c.noShare
        ? roundMoney(c.proceduresSyp - c.labsSyp)
        : roundMoney(c.proceduresSyp - (c.proceduresSyp * SHARE_PERCENT) / 100 - c.labsSyp),
    }))
    .sort((a, b) => b.proceduresSyp - a.proceduresSyp || a.name.localeCompare(b.name, 'ar'))

  rows.sort((a, b) => {
    if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? 1 : -1
    if (a.clinicLabel !== b.clinicLabel) return a.clinicLabel.localeCompare(b.clinicLabel, 'ar')
    return (a.patientName || '').localeCompare(b.patientName || '', 'ar')
  })

  return {
    from,
    to,
    sharePercent: SHARE_PERCENT,
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
