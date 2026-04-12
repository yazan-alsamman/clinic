import bcrypt from 'bcryptjs'
import { Patient } from '../models/Patient.js'

/** كلمة المرور الافتراضية لجميع حسابات بوابة المريض التي يولّدها النظام */
export const DEFAULT_PORTAL_PASSWORD = 'client1234'

/**
 * اسم المستخدم = اسم المريض كما في السجل؛ عند التكرار يُضاف لاحقة (1)، (2)، …
 * @param {import('mongoose').Document} patient
 */
async function uniquePortalUsername(patient) {
  const base = String(patient.name ?? '').trim() || `مريض_${String(patient._id).slice(-6)}`
  let candidate = base
  let suffix = 0
  for (let i = 0; i < 500; i += 1) {
    const clash = await Patient.findOne({ portalUsername: candidate }).select('_id').lean()
    if (!clash || String(clash._id) === String(patient._id)) {
      return candidate
    }
    suffix += 1
    candidate = `${base} (${suffix})`
  }
  throw new Error('تعذر اختيار اسم مستخدم فريد — عدّل اسم المريض أو احذف حساباً مكرراً')
}

/**
 * @param {import('mongoose').Document} patient
 * @returns {Promise<{ username: string, plainPassword: string }>}
 */
export async function provisionPortalCredentials(patient) {
  const username = await uniquePortalUsername(patient)
  const plainPassword = DEFAULT_PORTAL_PASSWORD
  const portalPasswordHash = await bcrypt.hash(plainPassword, 10)
  patient.portalUsername = username
  patient.portalPasswordHash = portalPasswordHash
  patient.portalEnabled = true
  patient.portalMustChangePassword = false
  await patient.save()
  return { username, plainPassword }
}

/** لإعادة إنشاء كلمة المرور من الاستقبال — نفس القيمة الثابتة */
export function randomPasswordPlain() {
  return DEFAULT_PORTAL_PASSWORD
}
