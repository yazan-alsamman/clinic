import mongoose from 'mongoose'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { Patient } from '../models/Patient.js'
import {
  DENTAL_ELIAS_DISPLAY_NAME,
  DENTAL_ELIAS_PROVIDER_KEY,
  isEliasProviderRef,
} from './dentalDoctorConstants.js'
import { todayBusinessDate } from '../utils/date.js'
import { round6 } from '../utils/money.js'

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

function treatmentEffectiveTotalSyp(tr) {
  const syp = roundMoney(tr?.totalCostSyp)
  const usd = Math.max(0, Number(tr?.totalCostUsd) || 0)
  const rate = Math.max(0, Number(tr?.costUsdSypRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? roundMoney(usd * rate) : 0
  return syp + fromUsd
}

function procedureLabelForTooth(fdi, tr) {
  const desc = String(tr?.procedureDescription || '').trim()
  const base = desc || 'إجراء أسنان'
  return `سن ${fdi} — ${base}`.slice(0, 500)
}

function procedureLabelForGeneral(tr) {
  const desc = String(tr?.procedureDescription || '').trim()
  const base = desc || 'إجراء أسنان عام'
  return `إجراء عام — ${base}`.slice(0, 500)
}

/**
 * يزامن إجراء مخطط واحد مع بند تحصيل معلّق.
 * @param {{ fdi?: number | null, isGeneral?: boolean }} opts
 */
async function syncOneDentalTreatment(patient, tr, { actorUserId, fallbackDate, fdi = null, isGeneral = false }) {
  if (!tr._id) return { created: 0, updated: 0, cancelled: 0, dirty: false }
  let created = 0
  let updated = 0
  let cancelled = 0
  let dirty = false

  const effective = treatmentEffectiveTotalSyp(tr)
  const billingId = tr.billingItemId ? String(tr.billingItemId) : ''
  const hasBillable =
    effective > 0 &&
    (Boolean(tr.providerUserId) ||
      isEliasProviderRef({
        providerUserId: tr.providerUserId,
        providerKey: tr.providerKey,
        doctorName: tr.doctorName,
      }))

  if (!hasBillable) {
    if (billingId && mongoose.Types.ObjectId.isValid(billingId)) {
      const bi = await BillingItem.findById(billingId)
      if (bi && bi.status === 'pending_payment') {
        bi.status = 'cancelled'
        await bi.save()
        cancelled += 1
      }
      tr.billingItemId = undefined
      tr.clinicalSessionId = undefined
      dirty = true
    }
    return { created, updated, cancelled, dirty }
  }

  let providerUserId = tr.providerUserId
  if (
    isEliasProviderRef({
      providerUserId: tr.providerUserId,
      providerKey: tr.providerKey,
      doctorName: tr.doctorName,
    })
  ) {
    providerUserId = actorUserId
  }
  if (!providerUserId || !mongoose.Types.ObjectId.isValid(String(providerUserId))) {
    return { created, updated, cancelled, dirty }
  }

  const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(String(tr.businessDate || ''))
    ? String(tr.businessDate).slice(0, 10)
    : fallbackDate
  const label = isGeneral ? procedureLabelForGeneral(tr) : procedureLabelForTooth(fdi, tr)
  const usdPart = Math.max(0, Number(tr.totalCostUsd) || 0)
  const sypPart = roundMoney(tr.totalCostSyp)
  const currency = usdPart > 0 && !(sypPart > 0) ? 'USD' : 'SYP'
  const amountDueUsd = usdPart > 0 ? round6(usdPart) : 0
  const toothFdiForSession =
    !isGeneral && Number.isFinite(Number(fdi)) && Number(fdi) >= 11 ? Number(fdi) : undefined

  if (billingId && mongoose.Types.ObjectId.isValid(billingId)) {
    const bi = await BillingItem.findById(billingId)
    if (bi && bi.status === 'pending_payment') {
      bi.procedureLabel = label
      bi.listAmountDueSyp = effective
      bi.effectiveAmountDueSyp = effective
      bi.amountDueSyp = effective
      bi.listAmountDueUsd = amountDueUsd
      bi.effectiveAmountDueUsd = amountDueUsd
      bi.amountDueUsd = amountDueUsd
      bi.currency = currency
      bi.businessDate = businessDate
      bi.providerUserId = providerUserId
      await bi.save()
      const cs = tr.clinicalSessionId
        ? await ClinicalSession.findById(tr.clinicalSessionId)
        : await ClinicalSession.findById(bi.clinicalSessionId)
      if (cs) {
        cs.procedureDescription = label
        cs.sessionFeeSyp = effective
        cs.sessionFeeUsd = amountDueUsd
        cs.feeCurrency = currency
        cs.businessDate = businessDate
        cs.providerUserId = providerUserId
        if (toothFdiForSession != null) cs.dentalToothFdi = toothFdiForSession
        else cs.dentalToothFdi = undefined
        cs.dentalTreatmentId = String(tr._id)
        await cs.save()
        if (!tr.clinicalSessionId) {
          tr.clinicalSessionId = cs._id
          dirty = true
        }
      }
      updated += 1
      return { created, updated, cancelled, dirty }
    }
    if (bi && bi.status === 'paid') {
      return { created, updated, cancelled, dirty }
    }
    tr.billingItemId = undefined
    tr.clinicalSessionId = undefined
    dirty = true
  }

  let cs = null
  try {
    cs = await ClinicalSession.create({
      patientId: patient._id,
      providerUserId,
      department: 'dental',
      procedureDescription: label,
      sessionFeeSyp: effective,
      ...(currency === 'USD'
        ? { sessionFeeUsd: amountDueUsd, feeCurrency: 'USD' }
        : { feeCurrency: 'SYP' }),
      businessDate,
      notes: tr.doctorName
        ? `طبيب المخطط: ${tr.doctorName}`
        : isEliasProviderRef({ providerKey: tr.providerKey, doctorName: tr.doctorName })
          ? `طبيب المخطط: ${DENTAL_ELIAS_DISPLAY_NAME}`
          : '',
      materials: [],
      materialCostSypTotal: 0,
      materialChargeSypTotal: 0,
      ...(toothFdiForSession != null ? { dentalToothFdi: toothFdiForSession } : {}),
      dentalTreatmentId: String(tr._id),
    })
    const bi = await BillingItem.create({
      clinicalSessionId: cs._id,
      patientId: patient._id,
      providerUserId,
      department: 'dental',
      procedureLabel: label,
      listAmountDueSyp: effective,
      discountPercent: 0,
      effectiveAmountDueSyp: effective,
      amountDueSyp: effective,
      listAmountDueUsd: amountDueUsd,
      effectiveAmountDueUsd: amountDueUsd,
      amountDueUsd,
      currency,
      businessDate,
      status: 'pending_payment',
    })
    cs.billingItemId = bi._id
    await cs.save()
    tr.billingItemId = bi._id
    tr.clinicalSessionId = cs._id
    tr.payments = []
    dirty = true
    created += 1
  } catch (e) {
    if (cs?._id) {
      await BillingItem.deleteMany({ clinicalSessionId: cs._id })
      await ClinicalSession.findByIdAndDelete(cs._id)
    }
    throw e
  }

  return { created, updated, cancelled, dirty }
}

/**
 * يزامن إجراءات المخطط ذات التكلفة مع بنود تحصيل معلّقة في الاستقبال.
 * الدفعات النقدية تُسجَّل فقط عبر التحصيل (لا من واجهة الطبيب).
 */
export async function syncDentalChartBilling(patient, { actorUserId, businessDateFallback } = {}) {
  if (!patient?._id) return { created: 0, updated: 0, cancelled: 0 }
  const teeth = patient.dentalChart?.teeth || []
  const generalTreatments = patient.dentalChart?.generalTreatments || []
  let created = 0
  let updated = 0
  let cancelled = 0
  let dirty = false

  const fallbackDate =
    /^\d{4}-\d{2}-\d{2}$/.test(String(businessDateFallback || ''))
      ? String(businessDateFallback).slice(0, 10)
      : todayBusinessDate()

  for (const tooth of teeth) {
    const fdi = Number(tooth.fdi)
    for (const tr of tooth.treatments || []) {
      const r = await syncOneDentalTreatment(patient, tr, {
        actorUserId,
        fallbackDate,
        fdi,
        isGeneral: false,
      })
      created += r.created
      updated += r.updated
      cancelled += r.cancelled
      if (r.dirty) dirty = true
    }
  }

  for (const tr of generalTreatments) {
    const r = await syncOneDentalTreatment(patient, tr, {
      actorUserId,
      fallbackDate,
      fdi: null,
      isGeneral: true,
    })
    created += r.created
    updated += r.updated
    cancelled += r.cancelled
    if (r.dirty) dirty = true
  }

  /** إلغاء بنود معلّقة لإجراءات حُذفت من المخطط */
  const liveTreatmentIds = new Set()
  for (const tooth of teeth) {
    for (const tr of tooth.treatments || []) {
      if (tr._id) liveTreatmentIds.add(String(tr._id))
    }
  }
  for (const tr of generalTreatments) {
    if (tr._id) liveTreatmentIds.add(String(tr._id))
  }
  const orphanSessions = await ClinicalSession.find({
    patientId: patient._id,
    department: 'dental',
    dentalTreatmentId: { $nin: ['', ...liveTreatmentIds] },
  })
    .select('_id billingItemId dentalTreatmentId')
    .lean()
  for (const cs of orphanSessions) {
    const tid = String(cs.dentalTreatmentId || '').trim()
    if (!tid) continue
    if (liveTreatmentIds.has(tid)) continue
    if (cs.billingItemId) {
      const bi = await BillingItem.findById(cs.billingItemId)
      if (bi && bi.status === 'pending_payment') {
        bi.status = 'cancelled'
        await bi.save()
        cancelled += 1
      }
    }
  }

  if (dirty) {
    patient.markModified('dentalChart')
    await patient.save()
  }

  return { created, updated, cancelled }
}

/**
 * بعد تأكيد التحصيل: انسخ الدفعة إلى إجراء المخطط المرتبط (سن أو إجراء عام).
 */
export async function applyDentalBillingPaymentToChart(bi, payment) {
  if (!bi?._id || bi.department !== 'dental') return false
  const cs = bi.clinicalSessionId
    ? await ClinicalSession.findById(bi.clinicalSessionId).lean()
    : null
  const toothFdi = Number(cs?.dentalToothFdi)
  const treatmentId = String(cs?.dentalTreatmentId || '').trim()
  if (!treatmentId) return false

  const patient = await Patient.findById(bi.patientId)
  if (!patient?.dentalChart) return false

  let tr = null
  if (Number.isFinite(toothFdi) && toothFdi >= 11) {
    const tooth = (patient.dentalChart.teeth || []).find((t) => Number(t.fdi) === toothFdi)
    if (!tooth) return false
    tr = (tooth.treatments || []).find((x) => String(x._id) === treatmentId)
  } else {
    if (!Array.isArray(patient.dentalChart.generalTreatments)) {
      patient.dentalChart.generalTreatments = []
    }
    tr = (patient.dentalChart.generalTreatments || []).find((x) => String(x._id) === treatmentId)
  }
  if (!tr) return false

  const cashSyp = roundMoney(payment?.amountSyp)
  const creditSyp = roundMoney(payment?.creditAppliedSyp)
  const amountSyp =
    cashSyp + creditSyp > 0 ? cashSyp + creditSyp : roundMoney(payment?.amountSyp ?? bi.amountDueSyp)
  const amountUsd = Math.max(0, Number(payment?.receivedAmountUsd) || Number(bi.amountDueUsd) || 0)
  const currency =
    String(payment?.payCurrency || bi.currency || 'SYP').toUpperCase() === 'USD' ? 'usd' : 'syp'
  const paidAt =
    payment?.createdAt instanceof Date
      ? payment.createdAt.toISOString().slice(0, 10)
      : String(bi.businessDate || todayBusinessDate()).slice(0, 10)
  const rateUsed =
    currency === 'usd' && amountUsd > 0 && amountSyp > 0 ? roundMoney(amountSyp / amountUsd) : 0

  tr.payments = [
    {
      amountSyp,
      amountUsd: currency === 'usd' ? round6(amountUsd) : 0,
      currency,
      usdSypRateUsed: currency === 'usd' ? rateUsed : 0,
      paidAt,
      note:
        creditSyp > 0
          ? `تحصيل استقبال — رصيد إضافي ${creditSyp.toLocaleString('en-US')} ل.س`
          : 'تحصيل استقبال',
    },
  ]
  if (!tr.billingItemId) tr.billingItemId = bi._id
  if (!tr.clinicalSessionId && cs?._id) tr.clinicalSessionId = cs._id

  patient.markModified('dentalChart')
  await patient.save()
  return true
}

/** إثراء DTO بحالة التحصيل */
export async function billingStatusByItemIds(ids) {
  const valid = [...new Set((ids || []).map((x) => String(x || '')).filter((id) => mongoose.Types.ObjectId.isValid(id)))]
  if (!valid.length) return new Map()
  const rows = await BillingItem.find({ _id: { $in: valid } })
    .select('status amountDueSyp amountDueUsd paidAt')
    .lean()
  const map = new Map()
  for (const r of rows) {
    map.set(String(r._id), {
      status: r.status,
      amountDueSyp: roundMoney(r.amountDueSyp),
      amountDueUsd: round6(Number(r.amountDueUsd) || 0),
      paidAt: r.paidAt || null,
    })
  }
  return map
}

export { treatmentEffectiveTotalSyp, DENTAL_ELIAS_PROVIDER_KEY }
