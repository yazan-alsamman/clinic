import { Patient } from '../models/Patient.js'
import { BillingItem } from '../models/BillingItem.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { FinancialDocument } from '../models/FinancialDocument.js'
import { round6 } from '../utils/money.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

function normalizeArText(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
}

function treatmentHasData(tr) {
  if (!tr) return false
  const desc = String(tr.procedureDescription || '').trim()
  const cost = roundMoney(tr.totalCostSyp) + Math.max(0, Number(tr.totalCostUsd) || 0)
  const paid = Array.isArray(tr.payments)
    ? tr.payments.reduce((s, p) => s + roundMoney(p?.amountSyp) + Math.max(0, Number(p?.amountUsd) || 0), 0)
    : 0
  const hasDoctor =
    Boolean(tr.providerUserId) ||
    Boolean(String(tr.providerKey || '').trim()) ||
    Boolean(String(tr.doctorName || '').trim())
  return cost > 0 || paid > 0 || Boolean(desc) || hasDoctor
}

function isExtractionProcedure(desc) {
  const s = normalizeArText(desc)
  return /خلع|قلع|extraction|extracted|قلعت/.test(s)
}

function isImplantProcedure(desc) {
  const s = normalizeArText(desc)
  return /زرع|زراع|implant/.test(s)
}

function surfaceMatchesProcedure(surface, desc) {
  if (!surface || surface.origin !== 'clinic') return false
  const label = normalizeArText(surface.label)
  const procedure = normalizeArText(desc)
  if (!label || !procedure) return false
  if (label === procedure) return true
  if (procedure.includes(label) || label.includes(procedure)) return true
  return false
}

function remainingClinicTreatments(tooth, exceptId) {
  return (tooth.treatments || []).filter(
    (t) => String(t._id) !== String(exceptId) && treatmentHasData(t),
  )
}

/**
 * إزالة علامة العيادة المرتبطة بالإجراء من مخطط السن.
 * إذا لم يبقَ إجراء عيادة على السن: تُمسح كل علامات العيادة ويُعاد الوضع الطبيعي إن كان الخلع/الزرعة من العيادة.
 */
function stripClinicMarksForTreatment(tooth, treatment) {
  if (!tooth || !treatment) return { surfacesRemoved: 0, statusReset: false }
  const tid = String(treatment._id)
  const desc = String(treatment.procedureDescription || '')
  const remaining = remainingClinicTreatments(tooth, tid)
  const beforeSurfaces = Array.isArray(tooth.surfaces) ? tooth.surfaces.length : 0
  let statusReset = false

  if (remaining.length === 0) {
    tooth.surfaces = (tooth.surfaces || []).filter((s) => s.origin !== 'clinic')
    if (tooth.statusOrigin === 'clinic' && tooth.status !== 'present') {
      tooth.status = 'present'
      tooth.statusOrigin = 'preexisting'
      tooth.implantColor = undefined
      statusReset = true
    }
  } else {
    tooth.surfaces = (tooth.surfaces || []).filter((s) => !surfaceMatchesProcedure(s, desc))
    if (tooth.statusOrigin === 'clinic') {
      if (
        tooth.status === 'missing' &&
        isExtractionProcedure(desc) &&
        !remaining.some((t) => isExtractionProcedure(t.procedureDescription))
      ) {
        tooth.status = 'present'
        tooth.statusOrigin = 'preexisting'
        statusReset = true
      } else if (
        tooth.status === 'implant' &&
        isImplantProcedure(desc) &&
        !remaining.some((t) => isImplantProcedure(t.procedureDescription))
      ) {
        tooth.status = 'present'
        tooth.statusOrigin = 'preexisting'
        tooth.implantColor = undefined
        statusReset = true
      }
    }
  }

  return {
    surfacesRemoved: Math.max(0, beforeSurfaces - (tooth.surfaces || []).length),
    statusReset,
  }
}

function findChartTreatment(patient, treatmentId) {
  const tid = String(treatmentId || '').trim()
  if (!tid) return null
  const chart = patient.dentalChart
  if (!chart) return null

  for (const tooth of chart.teeth || []) {
    const treatments = tooth.treatments || []
    const idx = treatments.findIndex((t) => String(t._id) === tid)
    if (idx >= 0) {
      return { kind: 'tooth', tooth, fdi: Number(tooth.fdi) || 0, idx, treatment: treatments[idx] }
    }
  }

  const general = chart.generalTreatments || []
  const gIdx = general.findIndex((t) => String(t._id) === tid)
  if (gIdx >= 0) {
    return { kind: 'general', idx: gIdx, fdi: 0, treatment: general[gIdx] }
  }
  return null
}

/**
 * عكس أثر التحصيل على ذمة/رصيد المريض: الرصيد المخصوم + فرق التسوية.
 */
async function reversePatientWalletFromPayment(patientId, pay, bi) {
  if (!patientId || !pay) return null
  const p = await Patient.findById(patientId)
  if (!p) return null

  let debt = roundMoney(p.outstandingDebtSyp)
  let debtUsd = round6(p.outstandingDebtUsd)
  let credit = roundMoney(p.prepaidCreditSyp)

  const extraSyp = roundMoney(pay.settlementDeltaSyp)
  const extraUsd = round6(pay.settlementDeltaUsd)
  const isUsdBilling = String(bi?.currency || 'SYP').toUpperCase() === 'USD'

  if (bi?.isCreditTopUp === true) {
    const added = roundMoney(pay.effectiveAmountDueSyp || bi.effectiveAmountDueSyp || bi.amountDueSyp)
    credit = Math.max(0, credit - added)
  } else if (isUsdBilling && Math.abs(extraUsd) > 1e-9) {
    if (extraUsd < 0) {
      debtUsd = round6(Math.max(0, debtUsd - Math.abs(extraUsd)))
    } else if (extraUsd > 0) {
      const extraAsSyp = extraSyp > 0 ? extraSyp : 0
      const fromCredit = Math.min(credit, extraAsSyp)
      credit -= fromCredit
      debt += Math.max(0, extraAsSyp - fromCredit)
      if (extraAsSyp <= 0) {
        debtUsd = round6(debtUsd + extraUsd)
      }
    }
  } else if (extraSyp < 0) {
    debt = Math.max(0, debt - Math.abs(extraSyp))
  } else if (extraSyp > 0) {
    const fromCredit = Math.min(credit, extraSyp)
    credit -= fromCredit
    debt += Math.max(0, extraSyp - fromCredit)
  }

  credit += roundMoney(pay.creditAppliedSyp)

  p.outstandingDebtSyp = Math.max(0, roundMoney(debt))
  p.outstandingDebtUsd = Math.max(0, round6(debtUsd))
  p.prepaidCreditSyp = Math.max(0, roundMoney(credit))
  await p.save()

  return {
    outstandingDebtSyp: p.outstandingDebtSyp,
    outstandingDebtUsd: p.outstandingDebtUsd,
    prepaidCreditSyp: p.prepaidCreditSyp,
  }
}

async function purgeFinancialDocsForPayment(pay) {
  const clauses = [
    { sourceType: 'billing_payment', sourceId: pay._id },
    { 'parameterSnapshot.billingPaymentId': String(pay._id) },
  ]
  if (pay.financialDocumentId) {
    clauses.unshift({ _id: pay.financialDocumentId })
  }
  await FinancialDocument.deleteMany({ $or: clauses })
}

/**
 * حذف بند التحصيل ودفعته ومستنده المحاسبي وانعكاس الرصيد.
 * يُخرج البند من الجرد اليومي (BillingPayment) ومن اللوحة المالية (المستند + المخطط).
 */
async function purgeBillingForDentalTreatment({ billingItemId, clinicalSessionId, dentalTreatmentId, patientId }) {
  const sessionIds = new Set()
  const itemIds = new Set()

  if (clinicalSessionId) sessionIds.add(String(clinicalSessionId))
  if (billingItemId) itemIds.add(String(billingItemId))

  if (dentalTreatmentId && patientId) {
    const sessions = await ClinicalSession.find({
      patientId,
      department: 'dental',
      dentalTreatmentId: String(dentalTreatmentId),
    })
      .select('_id billingItemId')
      .lean()
    for (const cs of sessions) {
      sessionIds.add(String(cs._id))
      if (cs.billingItemId) itemIds.add(String(cs.billingItemId))
    }
  }

  for (const sid of sessionIds) {
    const extra = await BillingItem.find({ clinicalSessionId: sid }).select('_id isCreditTopUp').lean()
    for (const row of extra) {
      if (row.isCreditTopUp === true) continue
      itemIds.add(String(row._id))
    }
  }

  let paymentsDeleted = 0
  let itemsDeleted = 0
  let docsDeleted = 0
  let wallet = null

  for (const iid of itemIds) {
    const bi = await BillingItem.findById(iid)
    if (!bi) continue
    if (bi.department !== 'dental') continue
    if (bi.isCreditTopUp === true) continue

    const pays = await BillingPayment.find({ billingItemId: bi._id })
    for (const pay of pays) {
      wallet = (await reversePatientWalletFromPayment(bi.patientId, pay, bi)) || wallet
      await purgeFinancialDocsForPayment(pay)
      docsDeleted += 1
      await pay.deleteOne()
      paymentsDeleted += 1
    }

    if (bi.clinicalSessionId) sessionIds.add(String(bi.clinicalSessionId))
    await BillingItem.deleteOne({ _id: bi._id })
    itemsDeleted += 1
  }

  let sessionsDeleted = 0
  for (const sid of sessionIds) {
    const cs = await ClinicalSession.findById(sid)
    if (!cs || cs.department !== 'dental' || cs.isCreditTopUp === true) continue
    await ClinicalSession.deleteOne({ _id: cs._id })
    sessionsDeleted += 1
  }

  return { paymentsDeleted, itemsDeleted, docsDeleted, sessionsDeleted, wallet }
}

/**
 * حذف إجراء أسنان بالكامل: المخطط + العلامات + التحصيل + الترحيل المحاسبي + الرصيد.
 */
export async function deleteDentalTreatmentFully({ patientId, treatmentId }) {
  const patient = await Patient.findById(patientId)
  if (!patient) {
    const err = new Error('المريض غير موجود')
    err.status = 404
    throw err
  }
  if (!patient.dentalChart) {
    const err = new Error('لا مخطط أسنان لهذا المريض')
    err.status = 404
    throw err
  }

  const found = findChartTreatment(patient, treatmentId)
  if (!found) {
    const err = new Error('الإجراء غير موجود على مخطط الأسنان')
    err.status = 404
    throw err
  }

  const treatment = found.treatment
  const snapshot = {
    procedureDescription: String(treatment.procedureDescription || ''),
    businessDate: String(treatment.businessDate || ''),
    totalCostSyp: roundMoney(treatment.totalCostSyp),
    totalCostUsd: Math.max(0, Number(treatment.totalCostUsd) || 0),
    billingItemId: treatment.billingItemId ? String(treatment.billingItemId) : null,
    clinicalSessionId: treatment.clinicalSessionId ? String(treatment.clinicalSessionId) : null,
    fdi: found.kind === 'tooth' ? found.fdi : 0,
    isGeneral: found.kind === 'general',
  }

  const finance = await purgeBillingForDentalTreatment({
    billingItemId: treatment.billingItemId,
    clinicalSessionId: treatment.clinicalSessionId,
    dentalTreatmentId: String(treatment._id),
    patientId: patient._id,
  })

  let chartMarks = { surfacesRemoved: 0, statusReset: false }
  if (found.kind === 'tooth') {
    chartMarks = stripClinicMarksForTreatment(found.tooth, treatment)
    found.tooth.treatments.splice(found.idx, 1)
  } else {
    patient.dentalChart.generalTreatments.splice(found.idx, 1)
  }

  patient.markModified('dentalChart')
  await patient.save()

  return {
    ok: true,
    patientId: String(patient._id),
    treatmentId: String(treatmentId),
    snapshot,
    finance,
    chartMarks,
  }
}
