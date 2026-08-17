import { User } from '../models/User.js'
import { DoctorShareSettings } from '../models/DoctorShareSettings.js'
import { DENTAL_ELIAS_DISPLAY_NAME } from './dentalDoctorConstants.js'

export const SHARE_DEPARTMENTS = ['laser', 'dermatology', 'dental', 'skin', 'solarium']

export const CLINICAL_SHARE_ROLES = [
  'laser',
  'dermatology',
  'dermatology_manager',
  'dermatology_assistant_manager',
  'dental_branch',
]

export const ROLE_DEPARTMENT = {
  laser: 'laser',
  dermatology: 'dermatology',
  dermatology_manager: 'dermatology',
  dermatology_assistant_manager: 'dermatology',
  dental_branch: 'dental',
}

export const HARD_DEFAULTS = {
  laser: 0,
  dermatology: 50,
  dental: 40,
  skin: 0,
  solarium: 0,
}

export const DEPT_ROLES = {
  laser: ['laser'],
  dermatology: ['dermatology', 'dermatology_manager', 'dermatology_assistant_manager'],
  dental: ['dental_branch'],
  skin: [],
  solarium: [],
}

export function clampSharePercent(n, fallback = 0) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  return Math.min(100, Math.max(0, Math.round(x)))
}

function publicSettings(doc) {
  const d = doc?.departmentDefaults || {}
  const v = doc?.virtualProviders || {}
  return {
    departmentDefaults: {
      laser: clampSharePercent(d.laser, HARD_DEFAULTS.laser),
      dermatology: clampSharePercent(d.dermatology, HARD_DEFAULTS.dermatology),
      dental: clampSharePercent(d.dental, HARD_DEFAULTS.dental),
      skin: clampSharePercent(d.skin, HARD_DEFAULTS.skin),
      solarium: clampSharePercent(d.solarium, HARD_DEFAULTS.solarium),
    },
    virtualProviders: {
      elias: clampSharePercent(v.elias, 0),
    },
  }
}

export async function getOrCreateDoctorShareSettings() {
  let doc = await DoctorShareSettings.findById('default')
  if (!doc) {
    doc = await DoctorShareSettings.create({
      _id: 'default',
      departmentDefaults: { ...HARD_DEFAULTS },
      virtualProviders: { elias: 0 },
      seededClinicalDefaults: false,
    })
  }
  return doc
}

export async function ensureDoctorShareDefaults() {
  const settings = await getOrCreateDoctorShareSettings()
  if (settings.seededClinicalDefaults) return { seeded: false, usersUpdated: 0 }

  const dentalDef = clampSharePercent(settings.departmentDefaults?.dental, HARD_DEFAULTS.dental)
  const dermDef = clampSharePercent(settings.departmentDefaults?.dermatology, HARD_DEFAULTS.dermatology)

  const dentalRes = await User.updateMany(
    { role: 'dental_branch', doctorSharePercent: 0 },
    { $set: { doctorSharePercent: dentalDef } },
  )
  const dermRes = await User.updateMany(
    {
      role: { $in: DEPT_ROLES.dermatology },
      doctorSharePercent: 0,
    },
    { $set: { doctorSharePercent: dermDef } },
  )

  settings.seededClinicalDefaults = true
  await settings.save()

  const usersUpdated = (dentalRes.modifiedCount || 0) + (dermRes.modifiedCount || 0)
  return { seeded: true, usersUpdated }
}

export async function loadDoctorShareContext() {
  const settingsDoc = await getOrCreateDoctorShareSettings()
  const settings = publicSettings(settingsDoc)
  const users = await User.find({ role: { $in: CLINICAL_SHARE_ROLES } })
    .select('name role doctorSharePercent active')
    .lean()
  const usersById = new Map(users.map((u) => [String(u._id), u]))
  return { settings, users, usersById }
}

export async function defaultPercentForRole(role) {
  const dept = ROLE_DEPARTMENT[role]
  if (!dept) return 0
  const settings = publicSettings(await getOrCreateDoctorShareSettings())
  return settings.departmentDefaults[dept] ?? HARD_DEFAULTS[dept] ?? 0
}

export function dentalSharePercentFor({ isElias = false, userId = '', name = '' } = {}, ctx) {
  const dentalDefault = ctx?.settings?.departmentDefaults?.dental ?? HARD_DEFAULTS.dental
  if (isElias) return clampSharePercent(ctx?.settings?.virtualProviders?.elias, 0)
  const uid = String(userId || '').trim()
  if (uid && ctx?.usersById?.has(uid)) {
    return clampSharePercent(ctx.usersById.get(uid).doctorSharePercent)
  }
  const n = String(name || '').trim()
  if (n && Array.isArray(ctx?.users)) {
    const exact = ctx.users.find(
      (u) => u.role === 'dental_branch' && String(u.name || '').trim() === n,
    )
    if (exact) return clampSharePercent(exact.doctorSharePercent)
  }
  return clampSharePercent(dentalDefault, HARD_DEFAULTS.dental)
}

export function namedDentalPercent(matcher, ctx) {
  const dentalDefault = ctx?.settings?.departmentDefaults?.dental ?? HARD_DEFAULTS.dental
  if (typeof matcher !== 'function' || !Array.isArray(ctx?.users)) {
    return clampSharePercent(dentalDefault, HARD_DEFAULTS.dental)
  }
  const u = ctx.users.find((x) => x.role === 'dental_branch' && matcher(x.name))
  if (u) return clampSharePercent(u.doctorSharePercent)
  return clampSharePercent(dentalDefault, HARD_DEFAULTS.dental)
}

export async function buildDoctorSharesAdminPayload() {
  const ctx = await loadDoctorShareContext()
  const doctorsByDept = {
    laser: [],
    dermatology: [],
    dental: [],
    skin: [],
    solarium: [],
  }
  for (const u of ctx.users) {
    const dept = ROLE_DEPARTMENT[u.role]
    if (!dept || !doctorsByDept[dept]) continue
    doctorsByDept[dept].push({
      id: String(u._id),
      name: String(u.name || '').trim() || '—',
      role: u.role,
      active: u.active !== false,
      sharePercent: clampSharePercent(u.doctorSharePercent),
    })
  }
  for (const key of Object.keys(doctorsByDept)) {
    doctorsByDept[key].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }

  const departments = SHARE_DEPARTMENTS.map((key) => ({
    key,
    defaultPercent: ctx.settings.departmentDefaults[key],
    doctors: doctorsByDept[key],
    virtualProviders:
      key === 'dental'
        ? [
            {
              key: 'elias',
              name: DENTAL_ELIAS_DISPLAY_NAME,
              sharePercent: ctx.settings.virtualProviders.elias,
            },
          ]
        : [],
  }))

  return {
    departmentDefaults: ctx.settings.departmentDefaults,
    departments,
  }
}

export async function saveDepartmentDefault(department, percent) {
  const key = String(department || '').trim()
  if (!SHARE_DEPARTMENTS.includes(key)) {
    const err = new Error('قسم غير صالح')
    err.status = 400
    throw err
  }
  const pct = Number(percent)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    const err = new Error('النسبة يجب أن تكون بين 0 و 100')
    err.status = 400
    throw err
  }
  const doc = await getOrCreateDoctorShareSettings()
  doc.departmentDefaults[key] = clampSharePercent(pct)
  doc.markModified('departmentDefaults')
  await doc.save()
  return publicSettings(doc)
}

export async function saveVirtualProviderPercent(key, percent) {
  const k = String(key || '').trim()
  if (k !== 'elias') {
    const err = new Error('مقدّم غير صالح')
    err.status = 400
    throw err
  }
  const pct = Number(percent)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    const err = new Error('النسبة يجب أن تكون بين 0 و 100')
    err.status = 400
    throw err
  }
  const doc = await getOrCreateDoctorShareSettings()
  doc.virtualProviders.elias = clampSharePercent(pct)
  doc.markModified('virtualProviders')
  await doc.save()
  return publicSettings(doc)
}

export async function saveUserSharePercent(userId, percent) {
  const u = await User.findById(userId)
  if (!u) {
    const err = new Error('المستخدم غير موجود')
    err.status = 404
    throw err
  }
  if (!CLINICAL_SHARE_ROLES.includes(u.role)) {
    const err = new Error('هذا الحساب ليست له نسبة طبية')
    err.status = 400
    throw err
  }
  const pct = Number(percent)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    const err = new Error('النسبة يجب أن تكون بين 0 و 100')
    err.status = 400
    throw err
  }
  u.doctorSharePercent = clampSharePercent(pct)
  await u.save()
  return {
    id: String(u._id),
    name: u.name,
    role: u.role,
    active: u.active,
    sharePercent: clampSharePercent(u.doctorSharePercent),
  }
}

export async function applyDepartmentDefaultToDoctors(department) {
  const key = String(department || '').trim()
  const roles = DEPT_ROLES[key]
  if (!roles?.length) {
    const err = new Error('لا يوجد أطباء مرتبطون بهذا القسم')
    err.status = 400
    throw err
  }
  const settings = publicSettings(await getOrCreateDoctorShareSettings())
  const pct = settings.departmentDefaults[key]
  const res = await User.updateMany({ role: { $in: roles } }, { $set: { doctorSharePercent: pct } })
  return { department: key, sharePercent: pct, usersUpdated: res.modifiedCount || 0 }
}
