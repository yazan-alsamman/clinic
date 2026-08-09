import mongoose from 'mongoose'
import { Patient } from '../models/Patient.js'
import { DentalLab } from '../models/DentalLab.js'

function round6(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6
}

export function labWorkEffectiveSyp(row) {
  const syp = Math.max(0, Math.round(Number(row?.amountSyp) || 0))
  const usd = Math.max(0, Number(row?.amountUsd) || 0)
  const rate = Math.max(0, Number(row?.usdSypRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? Math.round(usd * rate) : 0
  return syp + fromUsd
}

export function labPaymentEffectiveSyp(row) {
  const syp = Math.max(0, Math.round(Number(row?.amountSyp) || 0))
  const usd = Math.max(0, Number(row?.amountUsd) || 0)
  const rate = Math.max(0, Number(row?.usdSypRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? Math.round(usd * rate) : 0
  return syp + fromUsd
}

function normalizeLabNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * يجمع أعمال المخابر من مخططات المرضى ويربطها بحسابات المخابر المسجّلة.
 */
export async function listDentalLabAccounts({ includeInactive = true } = {}) {
  const labs = await DentalLab.find(includeInactive ? {} : { active: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean()

  const labById = new Map(labs.map((l) => [String(l._id), l]))
  const labByName = new Map()
  for (const l of labs) {
    const key = normalizeLabNameKey(l.name)
    if (key && !labByName.has(key)) labByName.set(key, l)
  }

  /** @type {Map<string, { works: any[], orphan?: boolean, orphanName?: string }>} */
  const bucket = new Map()
  for (const l of labs) {
    bucket.set(String(l._id), { works: [] })
  }

  const patients = await Patient.find({
    'dentalChart.teeth.labWorks.0': { $exists: true },
  })
    .select('fullName fileNumber phone dentalChart.teeth')
    .lean()

  for (const p of patients) {
    const patientId = String(p._id)
    const patientName = String(p.fullName || '').trim() || '—'
    const fileNumber = String(p.fileNumber || '').trim()
    const phone = String(p.phone || '').trim()
    const teeth = Array.isArray(p.dentalChart?.teeth) ? p.dentalChart.teeth : []
    for (const tooth of teeth) {
      const fdi = Number(tooth?.fdi) || 0
      const labWorks = Array.isArray(tooth?.labWorks) ? tooth.labWorks : []
      for (const lw of labWorks) {
        const amountSyp = Math.max(0, Math.round(Number(lw.amountSyp) || 0))
        const amountUsd = Math.max(0, round6(Number(lw.amountUsd) || 0))
        const usdSypRate = Math.max(0, Number(lw.usdSypRate) || 0)
        const effectiveSyp = labWorkEffectiveSyp(lw)
        if (!(amountSyp > 0 || amountUsd > 0 || String(lw.labName || '').trim() || String(lw.procedureDescription || '').trim())) {
          continue
        }
        const labIdRaw = lw.labId != null ? String(lw.labId).trim() : ''
        const labName = String(lw.labName || '').trim()
        let targetId = ''
        if (labIdRaw && labById.has(labIdRaw)) {
          targetId = labIdRaw
        } else {
          const byName = labByName.get(normalizeLabNameKey(labName))
          if (byName) targetId = String(byName._id)
        }

        const workRow = {
          id: lw._id ? String(lw._id) : `${patientId}-${fdi}-${labName}-${lw.businessDate || ''}`,
          patientId,
          patientName,
          fileNumber,
          phone,
          fdi,
          labName: labName || (targetId ? labById.get(targetId)?.name : '') || '—',
          procedureDescription: String(lw.procedureDescription || '').trim(),
          amountSyp,
          amountUsd,
          usdSypRate,
          effectiveSyp,
          businessDate: String(lw.businessDate || '').trim(),
          doctorName: String(lw.doctorName || '').trim(),
        }

        if (targetId) {
          bucket.get(targetId)?.works.push(workRow)
        } else if (labName) {
          const orphanKey = `orphan:${normalizeLabNameKey(labName)}`
          if (!bucket.has(orphanKey)) {
            bucket.set(orphanKey, { works: [], orphan: true, orphanName: labName })
          }
          bucket.get(orphanKey).works.push(workRow)
        }
      }
    }
  }

  const accounts = []
  let totalsWorksSyp = 0
  let totalsPaidSyp = 0

  for (const l of labs) {
    const id = String(l._id)
    const works = bucket.get(id)?.works || []
    works.sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate)))
    const totalSyp = works.reduce((s, w) => s + (Number(w.effectiveSyp) || 0), 0)
    const payments = (Array.isArray(l.payments) ? l.payments : []).map((pay) => ({
      id: String(pay._id),
      amountSyp: Math.max(0, Math.round(Number(pay.amountSyp) || 0)),
      amountUsd: Math.max(0, round6(Number(pay.amountUsd) || 0)),
      usdSypRate: Math.max(0, Number(pay.usdSypRate) || 0),
      effectiveSyp: labPaymentEffectiveSyp(pay),
      businessDate: String(pay.businessDate || '').trim(),
      note: String(pay.note || '').trim(),
      createdByName: String(pay.createdByName || '').trim(),
      createdAt: pay.createdAt || null,
    }))
    payments.sort((a, b) => String(b.businessDate || b.createdAt || '').localeCompare(String(a.businessDate || a.createdAt || '')))
    const paidSyp = payments.reduce((s, p) => s + (Number(p.effectiveSyp) || 0), 0)
    const remainingSyp = Math.max(0, totalSyp - paidSyp)
    totalsWorksSyp += totalSyp
    totalsPaidSyp += paidSyp
    accounts.push({
      id,
      name: String(l.name || '').trim(),
      notes: String(l.notes || '').trim(),
      active: l.active !== false,
      sortOrder: Number(l.sortOrder) || 0,
      workCount: works.length,
      totalSyp,
      paidSyp,
      remainingSyp,
      works,
      payments,
      orphan: false,
    })
  }

  for (const [key, val] of bucket.entries()) {
    if (!val.orphan) continue
    const works = val.works || []
    works.sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate)))
    const totalSyp = works.reduce((s, w) => s + (Number(w.effectiveSyp) || 0), 0)
    totalsWorksSyp += totalSyp
    accounts.push({
      id: key,
      name: val.orphanName || 'مخبر غير مسجّل',
      notes: 'أعمال مرتبطة باسم مخبر غير موجود في القائمة — أضف المخبر لربطها.',
      active: false,
      sortOrder: 9999,
      workCount: works.length,
      totalSyp,
      paidSyp: 0,
      remainingSyp: totalSyp,
      works,
      payments: [],
      orphan: true,
    })
  }

  accounts.sort((a, b) => {
    if (a.orphan !== b.orphan) return a.orphan ? 1 : -1
    if (a.active !== b.active) return a.active ? -1 : 1
    return String(a.name).localeCompare(String(b.name), 'ar')
  })

  return {
    labs: accounts,
    totals: {
      labCount: accounts.filter((a) => !a.orphan).length,
      workCount: accounts.reduce((s, a) => s + a.workCount, 0),
      totalSyp: totalsWorksSyp,
      paidSyp: totalsPaidSyp,
      remainingSyp: Math.max(0, totalsWorksSyp - totalsPaidSyp),
    },
  }
}

export async function listActiveDentalLabs() {
  const rows = await DentalLab.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean()
  return rows.map((l) => ({
    id: String(l._id),
    name: String(l.name || '').trim(),
  }))
}

export function dentalLabToAdminDto(doc) {
  if (!doc) return null
  return {
    id: String(doc._id),
    name: String(doc.name || '').trim(),
    notes: String(doc.notes || '').trim(),
    active: doc.active !== false,
    sortOrder: Number(doc.sortOrder) || 0,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  }
}
