import mongoose from 'mongoose'
import { BillingItem } from '../models/BillingItem.js'
import { ClinicalSession } from '../models/ClinicalSession.js'
import { LaserSession } from '../models/LaserSession.js'
import { Patient } from '../models/Patient.js'
import { LaserProcedureOption } from '../models/LaserProcedureOption.js'
import { LaserSettings } from '../models/LaserSettings.js'

async function getOrCreateLaserSettings() {
  let doc = await LaserSettings.findById('default').lean()
  if (!doc) {
    await LaserSettings.create({ _id: 'default', pricePerPulseSyp: 0, laserCoverSyp: 0 })
    doc = { _id: 'default', pricePerPulseSyp: 0, laserCoverSyp: 0 }
  }
  return doc
}
import { writeAudit } from '../utils/audit.js'

const LASER_TYPES = ['Mix', 'Yag', 'Alex']

function parsePositiveSypInteger(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function parseNonNegativeSypInteger(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function parseDiscountPercent(raw) {
  if (raw == null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return n
}

function resolveBillingDiscount(listDueSyp, discountPercent) {
  const list = Math.round(Number(listDueSyp) || 0)
  if (!(list > 0)) {
    return { discountPercent: 0, listAmountDueSyp: 0, effectiveAmountDueSyp: 0, amountDueSyp: 0 }
  }
  const pct = parseDiscountPercent(discountPercent) ?? 0
  const eff = pct > 0 ? Math.max(1, Math.round(list * (1 - pct / 100))) : list
  return {
    discountPercent: pct,
    listAmountDueSyp: list,
    effectiveAmountDueSyp: eff,
    amountDueSyp: eff,
  }
}

function parseShotCount(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const normalized = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '.')
  const num = Number.parseFloat(normalized)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.round(num)
}

function parseLaserLineItems(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => ({
      procedureOptionId: String(row?.procedureOptionId || '').trim(),
      areaLabel: String(row?.areaLabel || '').trim().slice(0, 120),
      pw: String(row?.pw || '').trim().slice(0, 80),
      pulse: String(row?.pulse || '').trim().slice(0, 80),
      shotCount: String(row?.shotCount || '').trim().slice(0, 80),
      chargeByPulseCount: row?.chargeByPulseCount === true,
      isAddon: row?.isAddon === true,
      lineCostSyp: Math.max(0, Math.round(Number(row?.lineCostSyp) || 0)),
    }))
    .filter((row) => row.areaLabel || row.procedureOptionId)
    .slice(0, 120)
}

function parseMaterials(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((m) => ({
      inventoryItemId: mongoose.isValidObjectId(m?.inventoryItemId) ? m.inventoryItemId : undefined,
      sku: String(m?.sku || '').trim().slice(0, 80),
      name: String(m?.name || '').trim().slice(0, 200),
      unit: String(m?.unit || 'وحدة').trim().slice(0, 40) || 'وحدة',
      quantity: Math.max(0, Number(m?.quantity) || 0),
      unitCostSyp: Math.max(0, Math.round(Number(m?.unitCostSyp) || 0)),
      lineCostSyp: Math.max(0, Math.round(Number(m?.lineCostSyp) || 0)),
      chargedUnitPriceSyp: Math.max(0, Math.round(Number(m?.chargedUnitPriceSyp) || 0)),
      lineChargeSyp: Math.max(0, Math.round(Number(m?.lineChargeSyp) || 0)),
    }))
    .slice(0, 80)
}

function materialTotals(materials) {
  const materialCostSypTotal = Math.round(materials.reduce((s, m) => s + (m.lineCostSyp || 0), 0))
  const materialChargeSypTotal = Math.round(materials.reduce((s, m) => s + (m.lineChargeSyp || 0), 0))
  return { materialCostSypTotal, materialChargeSypTotal }
}

export async function loadBillingItemAdminDetail(billingItemId) {
  if (!mongoose.isValidObjectId(billingItemId)) {
    const err = new Error('معرّف غير صالح')
    err.status = 400
    throw err
  }
  const bi = await BillingItem.findById(billingItemId).lean()
  if (!bi) {
    const err = new Error('البند غير موجود')
    err.status = 404
    throw err
  }

  const cs = bi.clinicalSessionId
    ? await ClinicalSession.findById(bi.clinicalSessionId).populate('providerUserId', 'name').lean()
    : null

  let laser = null
  if (cs?.laserSessionId) {
    laser = await LaserSession.findById(cs.laserSessionId).populate('operatorUserId', 'name').lean()
  }
  if (!laser) {
    laser = await LaserSession.findOne({ billingItemId: bi._id }).populate('operatorUserId', 'name').lean()
  }

  const patient = await Patient.findById(bi.patientId).select('name fileNumber gender').lean()

  return {
    billingItem: {
      id: String(bi._id),
      patientId: String(bi.patientId),
      patientName: String(patient?.name || '').trim(),
      fileNumber: String(patient?.fileNumber || '').trim(),
      department: bi.department,
      procedureLabel: String(bi.procedureLabel || ''),
      listAmountDueSyp: Math.round(Number(bi.listAmountDueSyp || bi.amountDueSyp) || 0),
      discountPercent: Number(bi.discountPercent) || 0,
      effectiveAmountDueSyp: Math.round(Number(bi.effectiveAmountDueSyp || bi.amountDueSyp) || 0),
      amountDueSyp: Math.round(Number(bi.amountDueSyp) || 0),
      businessDate: String(bi.businessDate || ''),
      status: bi.status,
      isPackagePrepaid: bi.isPackagePrepaid === true,
      paidAt: bi.paidAt ? new Date(bi.paidAt).toISOString() : null,
    },
    clinicalSession: cs
      ? {
          id: String(cs._id),
          procedureDescription: String(cs.procedureDescription || ''),
          sessionFeeSyp: Math.round(Number(cs.sessionFeeSyp) || 0),
          businessDate: String(cs.businessDate || ''),
          notes: String(cs.notes || ''),
          materialCostSypTotal: Math.round(Number(cs.materialCostSypTotal) || 0),
          materialChargeSypTotal: Math.round(Number(cs.materialChargeSypTotal) || 0),
          materials: Array.isArray(cs.materials) ? cs.materials : [],
          providerName: String(cs.providerUserId?.name || '').trim(),
          isPackageSession: cs.isPackageSession === true,
        }
      : null,
    laserSession: laser
      ? {
          id: String(laser._id),
          laserType: laser.laserType || 'Mix',
          pw: String(laser.pw || ''),
          pulse: String(laser.pulse || ''),
          shotCount: String(laser.shotCount || ''),
          chargeByPulseCount: laser.chargeByPulseCount === true,
          notes: String(laser.notes || ''),
          areaIds: Array.isArray(laser.areaIds) ? laser.areaIds : [],
          manualAreaLabels: Array.isArray(laser.manualAreaLabels) ? laser.manualAreaLabels : [],
          room: String(laser.room || '1'),
          sessionTypeLabel: String(laser.sessionTypeLabel || ''),
          discountPercent: Number(laser.discountPercent) || 0,
          costSyp: Math.round(Number(laser.costSyp) || 0),
          status: laser.status,
          operatorName: String(laser.operatorUserId?.name || '').trim(),
          treatmentNumber: laser.treatmentNumber,
          laserCoverApplied: laser.laserCoverApplied === true,
          laserCoverSyp: Math.max(0, Math.round(Number(laser.laserCoverSyp) || 0)),
          lineItems: (Array.isArray(laser.lineItems) ? laser.lineItems : []).map((row) => ({
            procedureOptionId: String(row.procedureOptionId || ''),
            areaLabel: String(row.areaLabel || ''),
            pw: String(row.pw || ''),
            pulse: String(row.pulse || ''),
            shotCount: String(row.shotCount || ''),
            chargeByPulseCount: row.chargeByPulseCount === true,
            isAddon: row.isAddon === true,
            lineCostSyp: Math.round(Number(row.lineCostSyp) || 0),
          })),
        }
      : null,
  }
}

async function recomputeLaserLineCosts(lineItems, patientGender) {
  const settings = await getOrCreateLaserSettings()
  const ppuSyp = Math.max(0, Math.round(Number(settings.pricePerPulseSyp) || 0))
  const ids = [...new Set(lineItems.map((r) => r.procedureOptionId).filter(Boolean))]
  const options = ids.length
    ? await LaserProcedureOption.find({ _id: { $in: ids }, active: { $ne: false } }).lean()
    : []
  const byId = new Map(options.map((o) => [String(o._id), o]))

  return lineItems.map((row) => {
    const option = row.procedureOptionId ? byId.get(row.procedureOptionId) : null
    const areaLabel = row.areaLabel || String(option?.name || '').trim().slice(0, 120)
    let lineCostSyp = Math.max(0, Math.round(Number(row.lineCostSyp) || 0))
    if (row.chargeByPulseCount && ppuSyp > 0) {
      const shots = parseShotCount(row.shotCount)
      lineCostSyp = shots > 0 ? ppuSyp * shots : 0
    } else if (lineCostSyp <= 0 && option) {
      const male = Math.max(0, Math.round(Number(option.priceMaleSyp ?? option.priceSyp) || 0))
      const female = Math.max(0, Math.round(Number(option.priceFemaleSyp ?? option.priceSyp) || 0))
      lineCostSyp = patientGender === 'male' ? male : patientGender === 'female' ? female : female || male
    }
    return { ...row, areaLabel, lineCostSyp }
  })
}

export async function applyBillingItemAdminFullEdit(billingItemId, body, user) {
  if (user?.role !== 'super_admin') {
    const err = new Error('لا صلاحية — مدير النظام فقط')
    err.status = 403
    throw err
  }
  if (!mongoose.isValidObjectId(billingItemId)) {
    const err = new Error('معرّف غير صالح')
    err.status = 400
    throw err
  }

  const bi = await BillingItem.findById(billingItemId)
  if (!bi) {
    const err = new Error('البند غير موجود')
    err.status = 404
    throw err
  }
  if (bi.status !== 'pending_payment') {
    const err = new Error('يمكن تعديل البنود المعلّقة فقط (قبل التحصيل)')
    err.status = 400
    throw err
  }

  const patient = await Patient.findById(bi.patientId).select('gender name').lean()
  const patientGender = patient?.gender === 'male' || patient?.gender === 'female' ? patient.gender : ''

  const cs = bi.clinicalSessionId ? await ClinicalSession.findById(bi.clinicalSessionId) : null
  let laser = null
  if (cs?.laserSessionId) {
    laser = await LaserSession.findById(cs.laserSessionId)
  }
  if (!laser) {
    laser = await LaserSession.findOne({ billingItemId: bi._id })
  }

  const clinicalBody = body?.clinical && typeof body.clinical === 'object' ? body.clinical : {}
  const laserBody = body?.laser && typeof body.laser === 'object' ? body.laser : {}
  const billingBody = body?.billing && typeof body.billing === 'object' ? body.billing : {}

  if (cs) {
    if (clinicalBody.procedureDescription != null) {
      cs.procedureDescription = String(clinicalBody.procedureDescription).trim().slice(0, 500)
    }
    if (clinicalBody.notes != null) {
      cs.notes = String(clinicalBody.notes).trim().slice(0, 2000)
    }
    if (clinicalBody.businessDate != null) {
      const bd = String(clinicalBody.businessDate).trim()
      if (bd) cs.businessDate = bd
    }
    if (Array.isArray(clinicalBody.materials)) {
      const materials = parseMaterials(clinicalBody.materials)
      const { materialCostSypTotal, materialChargeSypTotal } = materialTotals(materials)
      cs.materials = materials
      cs.materialCostSypTotal = materialCostSypTotal
      cs.materialChargeSypTotal = materialChargeSypTotal
    }
    if (clinicalBody.sessionFeeSyp != null) {
      const fee = parseNonNegativeSypInteger(clinicalBody.sessionFeeSyp)
      if (fee == null) {
        const err = new Error('رسوم الجلسة غير صالحة')
        err.status = 400
        throw err
      }
      cs.sessionFeeSyp = fee
    }
    await cs.save()
  }

  if (laser && bi.department === 'laser') {
    const laserType = String(laserBody.laserType || laser.laserType || 'Mix').trim()
    if (!LASER_TYPES.includes(laserType)) {
      const err = new Error('نوع الليزر غير صالح')
      err.status = 400
      throw err
    }
    laser.laserType = laserType
    if (laserBody.room != null) {
      const room = String(laserBody.room).trim()
      laser.room = room === '2' ? '2' : '1'
    }
    if (laserBody.notes != null) laser.notes = String(laserBody.notes).trim().slice(0, 2000)
    if (laserBody.pw != null) laser.pw = String(laserBody.pw).trim().slice(0, 500)
    if (laserBody.pulse != null) laser.pulse = String(laserBody.pulse).trim().slice(0, 500)
    if (laserBody.shotCount != null) laser.shotCount = String(laserBody.shotCount).trim().slice(0, 500)
    if (laserBody.chargeByPulseCount != null) {
      laser.chargeByPulseCount = laserBody.chargeByPulseCount === true
    }

    if (Array.isArray(laserBody.lineItems)) {
      let lineItems = parseLaserLineItems(laserBody.lineItems)
      lineItems = await recomputeLaserLineCosts(lineItems, patientGender)
      laser.lineItems = lineItems
      const linesPw = lineItems.map((r) => r.pw).filter(Boolean)
      const linesPulse = lineItems.map((r) => r.pulse).filter(Boolean)
      const linesShots = lineItems.map((r) => r.shotCount).filter(Boolean)
      if (linesPw.length) laser.pw = linesPw.join(' | ').slice(0, 500)
      if (linesPulse.length) laser.pulse = linesPulse.join(' | ').slice(0, 500)
      if (linesShots.length) laser.shotCount = linesShots.join(' | ').slice(0, 500)
      laser.chargeByPulseCount = lineItems.some((r) => r.chargeByPulseCount)
    }

    const settings = await getOrCreateLaserSettings()
    let costSyp = laser.costSyp
    if (laserBody.costSyp != null) {
      const c = parseNonNegativeSypInteger(laserBody.costSyp)
      if (c == null) {
        const err = new Error('تكلفة الجلسة غير صالحة')
        err.status = 400
        throw err
      }
      costSyp = c
    } else if (Array.isArray(laser.lineItems) && laser.lineItems.length > 0) {
      costSyp = laser.lineItems.reduce((s, r) => s + (Number(r.lineCostSyp) || 0), 0)
    }
    if (laserBody.laserCoverApplied === true) {
      const cover = Math.max(0, Math.round(Number(settings.laserCoverSyp) || 0))
      laser.laserCoverApplied = true
      laser.laserCoverSyp = cover
      costSyp += cover
    } else if (laserBody.laserCoverApplied === false) {
      laser.laserCoverApplied = false
      laser.laserCoverSyp = 0
    }
    laser.costSyp = Math.max(0, Math.round(costSyp))

    if (laserBody.discountPercent != null) {
      const ld = parseDiscountPercent(laserBody.discountPercent)
      if (ld == null) {
        const err = new Error('نسبة خصم الليزر غير صالحة')
        err.status = 400
        throw err
      }
      laser.discountPercent = ld
    }

    await laser.save()

    if (cs) {
      const desc =
        String(cs.procedureDescription || '').trim() ||
        (Array.isArray(laser.lineItems) && laser.lineItems.length
          ? laser.lineItems.map((r) => r.areaLabel).filter(Boolean).join(' + ')
          : 'ليزر')
      cs.procedureDescription = desc.slice(0, 500)
      const laserDisc = Number(laser.discountPercent) || 0
      const due = Math.round(laser.costSyp * (1 - laserDisc / 100))
      cs.sessionFeeSyp = Math.max(0, due)
      await cs.save()
    }
  }

  let listAmountDueSyp = Math.round(Number(bi.listAmountDueSyp || bi.amountDueSyp) || 0)
  let discountPercent = Number(bi.discountPercent) || 0

  if (billingBody.listAmountDueSyp != null) {
    const list = parseNonNegativeSypInteger(billingBody.listAmountDueSyp)
    if (list == null) {
      const err = new Error('المبلغ المستحق غير صالح')
      err.status = 400
      throw err
    }
    listAmountDueSyp = list
  } else if (cs) {
    listAmountDueSyp = Math.round(Number(cs.sessionFeeSyp) || 0) + Math.round(Number(cs.materialChargeSypTotal) || 0)
    if (laser && bi.department === 'laser') {
      listAmountDueSyp = Math.round(Number(laser.costSyp) || 0)
    }
  }

  if (billingBody.discountPercent != null) {
    const dp = parseDiscountPercent(billingBody.discountPercent)
    if (dp == null) {
      const err = new Error('نسبة الخصم غير صالحة')
      err.status = 400
      throw err
    }
    discountPercent = dp
  } else if (laser && bi.department === 'laser') {
    discountPercent = Number(laser.discountPercent) || 0
  }

  const resolved = resolveBillingDiscount(listAmountDueSyp, discountPercent)

  if (billingBody.procedureLabel != null) {
    bi.procedureLabel = String(billingBody.procedureLabel).trim().slice(0, 200) || bi.procedureLabel
  } else if (cs?.procedureDescription) {
    bi.procedureLabel = String(cs.procedureDescription).trim().slice(0, 200)
  }

  if (billingBody.businessDate != null) {
    const bd = String(billingBody.businessDate).trim()
    if (bd) bi.businessDate = bd
  }

  bi.listAmountDueSyp = resolved.listAmountDueSyp
  bi.discountPercent = resolved.discountPercent
  bi.effectiveAmountDueSyp = resolved.effectiveAmountDueSyp
  bi.amountDueSyp = resolved.amountDueSyp
  await bi.save()

  await writeAudit({
    user,
    action: 'تعديل كامل لبند تحصيل (مدير النظام)',
    entityType: 'BillingItem',
    entityId: bi._id,
    details: {
      department: bi.department,
      amountDueSyp: bi.amountDueSyp,
      listAmountDueSyp: bi.listAmountDueSyp,
      discountPercent: bi.discountPercent,
      clinicalSessionId: cs?._id ? String(cs._id) : undefined,
      laserSessionId: laser?._id ? String(laser._id) : undefined,
    },
  })

  return loadBillingItemAdminDetail(billingItemId)
}
