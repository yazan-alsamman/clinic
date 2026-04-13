import mongoose from 'mongoose'
import { BusinessDay } from '../models/BusinessDay.js'
import { FinancialDocument } from '../models/FinancialDocument.js'
import { LaserSession } from '../models/LaserSession.js'
import { DermatologyVisit } from '../models/DermatologyVisit.js'
import { BillingPayment } from '../models/BillingPayment.js'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { User } from '../models/User.js'
import { runCalculationProfile } from './calculationEngine.js'
import { buildParamBagForCalculation, resolveNumber, resolveString } from './parameterService.js'
import { round2, usdToSypInteger } from '../utils/money.js'

export function toYmdLocal(d) {
  const x = d instanceof Date ? d : new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const GL = {
  revenue_laser: '4100',
  revenue_derm: '4200',
  revenue_dental: '4300',
  cogs: '5000',
  doctor_payable: '2100',
}

/**
 * @param {Record<string, number>} stepResults
 * @param {number|null} exchangeRate
 * @param {string} revenueGl
 * @param {import('mongoose').Types.ObjectId|null} patientId
 * @param {string} department
 * @param {number} materialUsd — من المدخلات (المخزون / التكلفة المباشرة)
 */
function buildLinesFromSteps(stepResults, exchangeRate, revenueGl, patientId, department, materialUsd = 0) {
  const netGross = round2(stepResults.net_gross ?? 0)
  const material = round2(materialUsd)
  const doctorShare = round2(stepResults.doctor_share_usd ?? 0)
  const clinicNet = round2(stepResults.clinic_net_usd ?? netGross - doctorShare)

  const dims = {
    department,
    ...(patientId ? { patientId: String(patientId) } : {}),
  }

  return [
    {
      lineType: 'net_revenue',
      amountUsd: netGross,
      amountSyp: usdToSypInteger(netGross, exchangeRate),
      glAccountCode: revenueGl,
      dimensions: { ...dims },
    },
    {
      lineType: 'material_cost',
      amountUsd: material,
      amountSyp: usdToSypInteger(material, exchangeRate),
      glAccountCode: GL.cogs,
      dimensions: { ...dims },
    },
    {
      lineType: 'doctor_share',
      amountUsd: doctorShare,
      amountSyp: usdToSypInteger(doctorShare, exchangeRate),
      glAccountCode: GL.doctor_payable,
      dimensions: { ...dims },
    },
    {
      lineType: 'clinic_net',
      amountUsd: clinicNet,
      amountSyp: usdToSypInteger(clinicNet, exchangeRate),
      glAccountCode: '5900',
      dimensions: { ...dims },
    },
  ]
}

async function loadExchangeRate(businessDate) {
  const bd = await BusinessDay.findOne({ businessDate }).lean()
  return bd?.exchangeRate != null && Number.isFinite(bd.exchangeRate) ? bd.exchangeRate : null
}

/**
 * @param {import('mongoose').Types.ObjectId|string} providerUserId
 * @param {string} department
 */
async function resolveDoctorSharePercent(providerUserId, department) {
  const uid = String(providerUserId)
  const user = await User.findById(uid).lean()
  const base = user && Number.isFinite(user.doctorSharePercent) ? user.doctorSharePercent : 0
  const override = await resolveNumber(
    'doctor_share_percent',
    { department, userId: uid },
    new Date(),
  )
  if (override != null && Number.isFinite(override)) return Math.min(100, Math.max(0, override))
  return Math.min(100, Math.max(0, base))
}

/**
 * @param {{ department: string, userId?: string }} scope
 * @param {string} paramKey e.g. calc.profile.laser
 * @param {string} fallbackProfile
 */
async function resolveProfileCode(scope, paramKey, fallbackProfile) {
  const s = await resolveString(paramKey, scope, new Date())
  if (s && /^[A-Z0-9_]+$/i.test(s)) return s.trim().toUpperCase()
  return fallbackProfile
}

/**
 * @param {import('mongoose').Document|object} session
 * @param {import('mongoose').Types.ObjectId|null} postedBy
 */
export async function postLaserSessionIfCompleted(session, postedBy) {
  const s = session
  if (s.status !== 'completed') return { skipped: true, reason: 'not_completed' }
  if (s.billingItemId) {
    return { skipped: true, reason: 'uses_billing_queue' }
  }
  const idem = `laser_session:${String(s._id)}:v1`
  const existing = await FinancialDocument.findOne({ idempotencyKey: idem }).lean()
  if (existing) return { skipped: true, reason: 'already_posted', documentId: String(existing._id) }

  const businessDate = toYmdLocal(s.createdAt || new Date())
  const exchangeRate = await loadExchangeRate(businessDate)
  const providerId = s.operatorUserId
  const department = 'laser'
  const sharePct = await resolveDoctorSharePercent(providerId, department)
  const profileCode = await resolveProfileCode(
    { department, userId: String(providerId) },
    'calc.profile.laser',
    'CLINIC_NET_SHARE',
  )

  const { param, snapshot } = await buildParamBagForCalculation({
    department,
    userId: String(providerId),
  })
  const discount = Math.min(100, Math.max(0, Number(s.discountPercent) || 0))

  const input = {
    gross_usd: Number(s.costUsd) || 0,
    discount_percent: discount,
    material_cost_usd: 0,
    doctor_share_percent: sharePct,
  }

  const calc = await runCalculationProfile(profileCode, { input, param })
  const fullSnapshot = {
    ...snapshot,
    resolvedDoctorSharePercent: sharePct,
    discount_percent_cap: param.discount_percent_cap,
  }

  const lines = buildLinesFromSteps(
    calc.stepResults,
    exchangeRate,
    GL.revenue_laser,
    s.patientId,
    department,
    0,
  )

  const doc = await FinancialDocument.create({
    idempotencyKey: idem,
    sourceType: 'laser_session',
    sourceId: s._id,
    businessDate,
    patientId: s.patientId,
    providerUserId: providerId,
    department,
    exchangeRate,
    calculationProfileCode: calc.profileCode,
    parameterSnapshot: fullSnapshot,
    sourceInputSnapshot: input,
    stepResults: calc.stepResults,
    lines,
    postedBy,
    status: 'posted',
  })

  return { skipped: false, document: doc.toObject() }
}

/**
 * @param {import('mongoose').Document|object} visit
 * @param {import('mongoose').Types.ObjectId|null} postedBy
 */
export async function postDermatologyVisit(visit, postedBy) {
  const v = visit
  const idem = `dermatology_visit:${String(v._id)}:v1`
  const existing = await FinancialDocument.findOne({ idempotencyKey: idem }).lean()
  if (existing) return { skipped: true, reason: 'already_posted', documentId: String(existing._id) }

  const businessDate = v.businessDate || toYmdLocal(v.createdAt || new Date())
  const exchangeRate = await loadExchangeRate(businessDate)
  const providerId = v.providerUserId
  const department = 'dermatology'
  const sharePct = await resolveDoctorSharePercent(providerId, department)
  const profileCode = await resolveProfileCode(
    { department, userId: String(providerId) },
    'calc.profile.dermatology',
    'CLINIC_NET_SHARE',
  )

  const { param, snapshot } = await buildParamBagForCalculation({
    department,
    userId: String(providerId),
  })
  const discount = Math.min(100, Math.max(0, Number(v.discountPercent) || 0))
  const material = Math.max(0, Number(v.materialCostUsd) || 0)

  const input = {
    gross_usd: Number(v.costUsd) || 0,
    discount_percent: discount,
    material_cost_usd: material,
    doctor_share_percent: sharePct,
  }

  const calc = await runCalculationProfile(profileCode, { input, param })
  const fullSnapshot = {
    ...snapshot,
    resolvedDoctorSharePercent: sharePct,
    discount_percent_cap: param.discount_percent_cap,
    materialCostUsd: material,
  }

  const lines = buildLinesFromSteps(
    calc.stepResults,
    exchangeRate,
    GL.revenue_derm,
    v.patientId,
    department,
    material,
  )

  const doc = await FinancialDocument.create({
    idempotencyKey: idem,
    sourceType: 'dermatology_visit',
    sourceId: v._id,
    businessDate,
    patientId: v.patientId,
    providerUserId: providerId,
    department,
    exchangeRate,
    calculationProfileCode: calc.profileCode,
    parameterSnapshot: fullSnapshot,
    sourceInputSnapshot: input,
    stepResults: calc.stepResults,
    lines,
    postedBy,
    status: 'posted',
  })

  return { skipped: false, document: doc.toObject() }
}

/**
 * ترحيل محاسبي بعد تأكيد الاستقبال لدفع بند الفوترة (سير عمل منفصل عن الجلسة السريرية).
 * @param {import('mongoose').Types.ObjectId|string} paymentId
 */
export async function postBillingPayment(paymentId, postedBy) {
  const idem = `billing_payment:${String(paymentId)}:v1`
  const existing = await FinancialDocument.findOne({ idempotencyKey: idem }).lean()
  if (existing) {
    return { skipped: true, reason: 'already_posted', documentId: String(existing._id) }
  }

  const pay = await BillingPayment.findById(paymentId).lean()
  if (!pay) throw new Error('دفعة غير موجودة')

  const bi = await BillingItem.findById(pay.billingItemId).lean()
  if (!bi || bi.status !== 'paid') throw new Error('بند الفوترة غير مؤكد كمسدد')

  const cs = await ClinicalSession.findById(bi.clinicalSessionId).lean()
  if (!cs) throw new Error('الجلسة السريرية غير موجودة')

  const businessDate = bi.businessDate
  const exchangeRate = await loadExchangeRate(businessDate)
  const department = bi.department
  const providerId = bi.providerUserId
  const material = round2(Number(cs.materialCostUsdTotal) || 0)

  const sharePct = await resolveDoctorSharePercent(providerId, department)

  let paramKey = 'calc.profile.laser'
  let fallback = 'CLINIC_NET_SHARE'
  if (department === 'dermatology' || department === 'solarium') {
    paramKey = 'calc.profile.dermatology'
  } else if (department === 'dental') {
    paramKey = material > 0 ? 'calc.profile.dental_ortho' : 'calc.profile.dental_general'
    fallback = material > 0 ? 'CLINIC_NET_SHARE' : 'CLINIC_SHARE_ON_GROSS'
  }
  const profileCode = await resolveProfileCode(
    { department, userId: String(providerId) },
    paramKey,
    fallback,
  )

  const { param, snapshot } = await buildParamBagForCalculation({
    department,
    userId: String(providerId),
  })
  const input = {
    gross_usd: round2(Number(pay.amountUsd) || 0),
    discount_percent: 0,
    material_cost_usd: material,
    doctor_share_percent: sharePct,
  }

  const calc = await runCalculationProfile(profileCode, { input, param })
  const fullSnapshot = {
    ...snapshot,
    resolvedDoctorSharePercent: sharePct,
    discount_percent_cap: param.discount_percent_cap,
    billingPaymentId: String(pay._id),
    billingItemId: String(bi._id),
    clinicalSessionId: String(cs._id),
  }

  const revenueGl =
    department === 'laser'
      ? GL.revenue_laser
      : department === 'dermatology' || department === 'solarium'
        ? GL.revenue_derm
        : GL.revenue_dental

  const lines = buildLinesFromSteps(
    calc.stepResults,
    exchangeRate,
    revenueGl,
    bi.patientId,
    department,
    material,
  )

  const doc = await FinancialDocument.create({
    idempotencyKey: idem,
    sourceType: 'billing_payment',
    sourceId: pay._id,
    businessDate,
    patientId: bi.patientId,
    providerUserId: providerId,
    department,
    exchangeRate,
    calculationProfileCode: calc.profileCode,
    parameterSnapshot: fullSnapshot,
    sourceInputSnapshot: input,
    stepResults: calc.stepResults,
    lines,
    postedBy,
    status: 'posted',
  })

  await BillingPayment.findByIdAndUpdate(pay._id, { financialDocumentId: doc._id })

  return { skipped: false, document: doc.toObject() }
}

/** Super-admin repair: post all completed laser + all derm visits missing documents */
export async function backfillFinancialDocuments(postedBy) {
  const laserSessions = await LaserSession.find({ status: 'completed' }).lean()
  const dermVisits = await DermatologyVisit.find({}).lean()
  const out = { laser: 0, dermatology: 0, skipped: 0, errors: [] }
  for (const s of laserSessions) {
    try {
      const r = await postLaserSessionIfCompleted(s, postedBy)
      if (r.skipped && r.reason === 'already_posted') out.skipped += 1
      else if (!r.skipped) out.laser += 1
    } catch (e) {
      out.errors.push({ source: 'laser', id: String(s._id), message: String(e?.message || e) })
    }
  }
  for (const v of dermVisits) {
    try {
      const r = await postDermatologyVisit(v, postedBy)
      if (r.skipped && r.reason === 'already_posted') out.skipped += 1
      else if (!r.skipped) out.dermatology += 1
    } catch (e) {
      out.errors.push({ source: 'dermatology', id: String(v._id), message: String(e?.message || e) })
    }
  }
  return out
}

/**
 * @param {string} sourceType
 * @param {string} sourceId
 */
export async function repostSource(sourceType, sourceId, postedBy) {
  if (!mongoose.isValidObjectId(sourceId)) {
    throw new Error('معرّف المصدر غير صالح')
  }
  if (sourceType === 'laser_session') {
    const s = await LaserSession.findById(sourceId)
    if (!s) throw new Error('جلسة غير موجودة')
    await FinancialDocument.deleteMany({ sourceType: 'laser_session', sourceId: s._id })
    return postLaserSessionIfCompleted(s, postedBy)
  }
  if (sourceType === 'dermatology_visit') {
    const v = await DermatologyVisit.findById(sourceId)
    if (!v) throw new Error('زيارة غير موجودة')
    await FinancialDocument.deleteMany({ sourceType: 'dermatology_visit', sourceId: v._id })
    return postDermatologyVisit(v, postedBy)
  }
  throw new Error('نوع مصدر غير مدعوم لإعادة الترحيل')
}
