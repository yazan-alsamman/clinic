import mongoose from 'mongoose'
import { BillingItem } from '../models/BillingItem.js'
import { DentalLab } from '../models/DentalLab.js'
import { Patient } from '../models/Patient.js'
import { todayBusinessDate } from '../utils/date.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

function treatmentHasCollection(tr, paidBillingIds) {
  const paidOnChart = (tr?.payments || []).some(
    (p) => roundMoney(p?.amountSyp) > 0 || Math.max(0, Number(p?.amountUsd) || 0) > 0,
  )
  if (paidOnChart) return true
  const bid = tr?.billingItemId ? String(tr.billingItemId) : ''
  return Boolean(bid && paidBillingIds?.has(bid))
}

function softLabKey(row) {
  return [
    String(row?.businessDate || '').trim().slice(0, 10),
    String(row?.procedureDescription || '').trim(),
    row?.providerUserId ? String(row.providerUserId) : '',
    String(row?.doctorName || '').trim(),
  ].join('|')
}

function labWorksForGeneralTreatment(patient, treatment) {
  const tid = treatment?._id ? String(treatment._id) : ''
  const labs = patient?.dentalChart?.generalLabWorks || []
  if (!tid) return []
  const linked = labs.filter((lab) => String(lab?.linkedGeneralTreatmentId || '') === tid)
  if (linked.length > 0) return linked
  const key = softLabKey(treatment)
  if (!key.replace(/\|/g, '')) return []
  return labs.filter((lab) => !lab?.linkedGeneralTreatmentId && softLabKey(lab) === key)
}

/**
 * أعمال المخبر على السن التي تخص هذا الإجراء:
 * نفس الوصف، أو نفس تاريخ الزيارة، أو كل مخابر السن إن كان عليه إجراء واحد.
 */
function labWorksForToothTreatment(tooth, treatment) {
  const labs = Array.isArray(tooth?.labWorks) ? tooth.labWorks : []
  if (!labs.length || !treatment) return []
  const billable = (tooth.treatments || []).filter(
    (t) => roundMoney(t?.totalCostSyp) > 0 || Math.max(0, Number(t?.totalCostUsd) || 0) > 0,
  )
  const desc = String(treatment.procedureDescription || '').trim()
  const date = String(treatment.businessDate || '').trim().slice(0, 10)
  const docId = treatment.providerUserId ? String(treatment.providerUserId) : ''
  const docName = String(treatment.doctorName || '').trim()

  const matched = []
  for (const lab of labs) {
    const labDesc = String(lab.procedureDescription || '').trim()
    if (desc && labDesc && desc === labDesc) {
      matched.push(lab)
      continue
    }
    const labDate = String(lab.businessDate || '').trim().slice(0, 10)
    const labDoc = lab.providerUserId ? String(lab.providerUserId) : ''
    const labDocName = String(lab.doctorName || '').trim()
    const sameDate = Boolean(date && labDate && date === labDate)
    const sameDoctor =
      (docId && labDoc && docId === labDoc) ||
      (docName && labDocName && docName === labDocName) ||
      (!docId && !docName) ||
      (!labDoc && !labDocName)
    if (sameDate && sameDoctor) matched.push(lab)
  }
  if (matched.length === 0 && billable.length <= 1) return labs
  return matched
}

function collectionBusinessDate(treatment, fallback) {
  const fromPay = (treatment?.payments || [])
    .map((p) => String(p?.paidAt || '').trim().slice(0, 10))
    .find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  if (fromPay) return fromPay
  const fromTr = String(treatment?.businessDate || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromTr)) return fromTr
  const fb = String(fallback || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(fb)) return fb
  return todayBusinessDate()
}

function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function labEffectiveSyp(row) {
  const syp = Math.max(0, roundMoney(row?.amountSyp))
  const usd = Math.max(0, Number(row?.amountUsd) || 0)
  const rate = Math.max(0, Number(row?.usdSypRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? roundMoney(usd * rate) : 0
  return syp + fromUsd
}

async function workTotalsByLabId(labDocs) {
  const byId = new Map(labDocs.map((l) => [String(l._id), l]))
  const byName = new Map()
  for (const lab of labDocs) {
    const key = normalizeNameKey(lab.name)
    if (key && !byName.has(key)) byName.set(key, lab)
  }
  const totals = new Map()
  const patients = await Patient.find({
    $or: [
      { 'dentalChart.teeth.labWorks.0': { $exists: true } },
      { 'dentalChart.generalLabWorks.0': { $exists: true } },
    ],
  })
    .select('dentalChart.teeth.labWorks dentalChart.generalLabWorks')
    .lean()

  function add(lw) {
    const amount = labEffectiveSyp(lw)
    if (!(amount > 0)) return
    const labIdRaw = lw.labId ? String(lw.labId) : ''
    const labDoc = (labIdRaw && byId.get(labIdRaw)) || byName.get(normalizeNameKey(lw.labName)) || null
    if (!labDoc) return
    const id = String(labDoc._id)
    totals.set(id, (totals.get(id) || 0) + amount)
  }

  for (const patient of patients) {
    for (const tooth of patient.dentalChart?.teeth || []) {
      for (const lw of tooth.labWorks || []) add(lw)
    }
    for (const lw of patient.dentalChart?.generalLabWorks || []) add(lw)
  }
  return totals
}

/**
 * يضيف مبلغ كل عمل مخبر كدفعة مسدّدة على حساب المخبر، مرة واحدة لكل عمل.
 */
export async function postAutoLabPayments(rows) {
  const pending = []
  const seenWorks = new Set()
  for (const row of rows || []) {
    const lab = row?.labWork
    const workId = lab?._id ? String(lab._id) : ''
    if (!workId || seenWorks.has(workId)) continue
    const amountSyp = Math.max(0, roundMoney(lab.amountSyp))
    const amountUsd = Math.max(0, Number(lab.amountUsd) || 0)
    if (!(amountSyp > 0 || amountUsd > 0)) continue
    seenWorks.add(workId)
    pending.push({ ...row, labWork: lab, workId, amountSyp, amountUsd })
  }
  if (!pending.length) return { posted: 0 }

  const labs = await DentalLab.find()
  const byId = new Map(labs.map((l) => [String(l._id), l]))
  const byName = new Map()
  for (const lab of labs) {
    const key = normalizeNameKey(lab.name)
    if (key && !byName.has(key)) byName.set(key, lab)
  }

  const already = new Set()
  const paidByLab = new Map()
  for (const lab of labs) {
    let paid = 0
    for (const pay of lab.payments || []) {
      if (pay?.sourceLabWorkId) already.add(String(pay.sourceLabWorkId))
      paid += labEffectiveSyp(pay)
    }
    paidByLab.set(String(lab._id), paid)
  }
  const totalsByLab = await workTotalsByLabId(labs)

  const dirty = new Set()
  let posted = 0
  for (const row of pending) {
    if (already.has(row.workId)) continue
    const labIdRaw = row.labWork.labId ? String(row.labWork.labId) : ''
    const labDoc =
      (labIdRaw && byId.get(labIdRaw)) || byName.get(normalizeNameKey(row.labWork.labName)) || null
    if (!labDoc) continue
    const labKey = String(labDoc._id)
    const room = Math.max(0, (totalsByLab.get(labKey) || 0) - (paidByLab.get(labKey) || 0))
    const want = labEffectiveSyp({
      amountSyp: row.amountSyp,
      amountUsd: row.amountUsd,
      usdSypRate: row.labWork.usdSypRate,
    })
    if (!(room > 0) || !(want > 0)) continue
    const take = Math.min(room, want)

    const desc = String(row.labWork.procedureDescription || '').trim()
    const patientName = String(row.patientName || '').trim() || 'مريض'
    const note = `تحصيل تلقائي بعد تسديد المريض ${patientName}${desc ? ` — ${desc}` : ''}`.slice(0, 500)
    const businessDate = String(row.businessDate || '').trim().slice(0, 10) || todayBusinessDate()
    const fullFits = take >= want
    const usdSypRate = fullFits && row.amountUsd > 0 ? Math.max(0, Number(row.labWork.usdSypRate) || 0) : 0
    labDoc.payments.push({
      amountSyp: fullFits ? row.amountSyp : take,
      amountUsd: fullFits ? row.amountUsd : 0,
      usdSypRate,
      businessDate,
      note,
      autoFromCollection: true,
      sourceLabWorkId: row.labWork._id,
      sourcePatientId: mongoose.Types.ObjectId.isValid(String(row.patientId || '')) ? row.patientId : null,
      sourceBillingItemId: mongoose.Types.ObjectId.isValid(String(row.billingItemId || ''))
        ? row.billingItemId
        : null,
      createdByName: 'تحصيل تلقائي',
    })
    already.add(row.workId)
    paidByLab.set(labKey, (paidByLab.get(labKey) || 0) + take)
    dirty.add(labKey)
    posted += 1
  }

  for (const lab of labs) {
    if (dirty.has(String(lab._id))) await lab.save()
  }
  return { posted }
}

export async function settleLabsForCollectedTreatment(patient, treatment, { billingItemId, businessDate, tooth } = {}) {
  if (!patient || !treatment) return { posted: 0 }
  let labs = []
  if (tooth) labs = labWorksForToothTreatment(tooth, treatment)
  else labs = labWorksForGeneralTreatment(patient, treatment)
  if (!labs.length) return { posted: 0 }
  const patientName = String(patient.name || patient.fullName || '').trim()
  return postAutoLabPayments(
    labs.map((labWork) => ({
      patientId: patient._id,
      patientName,
      labWork,
      billingItemId: billingItemId || treatment.billingItemId || null,
      businessDate: businessDate || collectionBusinessDate(treatment),
    })),
  )
}

/** يسدّد مخابر الإجراءات المحصّلة سابقاً التي لم تُرحَّل بعد إلى حساب المخبر. */
export async function syncCollectedDentalLabPayments() {
  const paidItems = await BillingItem.find({ department: 'dental', status: 'paid' }).select('_id').lean()
  const paidBillingIds = new Set(paidItems.map((x) => String(x._id)))

  const patients = await Patient.find({
    $or: [
      { 'dentalChart.teeth.labWorks.0': { $exists: true } },
      { 'dentalChart.generalLabWorks.0': { $exists: true } },
    ],
  })
    .select('name fullName dentalChart')
    .lean()

  const rows = []
  const queued = new Set()
  function pushLabs(patient, treatment, labs) {
    const patientName = String(patient.name || patient.fullName || '').trim()
    const when = collectionBusinessDate(treatment)
    for (const labWork of labs) {
      const id = labWork?._id ? String(labWork._id) : ''
      if (!id || queued.has(id)) continue
      queued.add(id)
      rows.push({
        patientId: patient._id,
        patientName,
        labWork,
        billingItemId: treatment.billingItemId || null,
        businessDate: when,
      })
    }
  }

  for (const patient of patients) {
    for (const tooth of patient.dentalChart?.teeth || []) {
      for (const tr of tooth.treatments || []) {
        if (!treatmentHasCollection(tr, paidBillingIds)) continue
        pushLabs(patient, tr, labWorksForToothTreatment(tooth, tr))
      }
    }
    for (const tr of patient.dentalChart?.generalTreatments || []) {
      if (!treatmentHasCollection(tr, paidBillingIds)) continue
      pushLabs(patient, tr, labWorksForGeneralTreatment(patient, tr))
    }
  }

  return postAutoLabPayments(rows)
}

/** يلغي تسديد المخبر التلقائي المرتبط ببند تحصيل حُذف. */
export async function removeAutoLabPaymentsForBillingItemIds(billingItemIds) {
  const ids = [
    ...new Set((billingItemIds || []).map((id) => String(id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ]
  if (!ids.length) return { removed: 0 }
  const labs = await DentalLab.find({ 'payments.sourceBillingItemId': { $in: ids } })
  let removed = 0
  for (const lab of labs) {
    const before = lab.payments.length
    lab.payments = lab.payments.filter(
      (p) =>
        !(
          p?.autoFromCollection &&
          p?.sourceBillingItemId &&
          ids.includes(String(p.sourceBillingItemId))
        ),
    )
    removed += before - lab.payments.length
    if (lab.payments.length !== before) await lab.save()
  }
  return { removed }
}

export async function removeAutoLabPaymentsForWorkIds(workIds) {
  const ids = [...new Set((workIds || []).map((id) => String(id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id)))]
  if (!ids.length) return { removed: 0 }
  const labs = await DentalLab.find({ 'payments.sourceLabWorkId': { $in: ids } })
  let removed = 0
  for (const lab of labs) {
    const before = lab.payments.length
    lab.payments = lab.payments.filter(
      (p) => !(p?.autoFromCollection && p?.sourceLabWorkId && ids.includes(String(p.sourceLabWorkId))),
    )
    removed += before - lab.payments.length
    if (lab.payments.length !== before) await lab.save()
  }
  return { removed }
}
