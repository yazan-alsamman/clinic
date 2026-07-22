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
        const cost = roundMoney(tr.totalCostSyp)
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
