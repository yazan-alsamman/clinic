import mongoose from 'mongoose'
import { User } from '../models/User.js'
import { UserNotification } from '../models/UserNotification.js'

const PROVIDER_MATCH_ROLES = ['laser', 'dermatology', 'dental_branch', 'solarium']

function isLaserSlot(slot) {
  const st = String(slot.serviceType || '').toLowerCase()
  if (st === 'laser') return true
  return /^laser\s+room\s*\d+$/i.test(String(slot.providerName || '').trim())
}

/**
 * يُنشئ إشعاراً للمقدّم المعني فقط (موعد محجوز بمريض).
 * لا يُشعر من قام بالإلغاء إن كان هو نفس المستخدم المعني.
 */
export async function notifyAppointmentCancelled(slot, cancelledByUser) {
  if (!slot?.patientId) return

  const cancellerId = String(cancelledByUser?._id || '')
  const cancellerName = String(cancelledByUser?.name || '').trim() || 'مستخدم'

  const recipientIds = new Set()

  const assignedRaw = slot.assignedSpecialistUserId
  if (assignedRaw) {
    const id = String(assignedRaw)
    if (mongoose.isValidObjectId(id) && id !== cancellerId) recipientIds.add(id)
  }

  if (recipientIds.size === 0 && !isLaserSlot(slot)) {
    const pn = String(slot.providerName || '').trim()
    if (pn) {
      const u = await User.findOne({
        name: pn,
        role: { $in: PROVIDER_MATCH_ROLES },
        active: true,
      })
        .select('_id')
        .lean()
      if (u?._id && String(u._id) !== cancellerId) recipientIds.add(String(u._id))
    }
  }

  if (recipientIds.size === 0 && isLaserSlot(slot)) {
    const nm = String(slot.assignedSpecialistName || '').trim()
    if (nm) {
      const u = await User.findOne({ name: nm, role: 'laser', active: true }).select('_id').lean()
      if (u?._id && String(u._id) !== cancellerId) recipientIds.add(String(u._id))
    }
  }

  if (recipientIds.size === 0) return

  const patientName = String(slot.patientName || '').trim() || 'مريض'
  const businessDate = String(slot.businessDate || '')
  const time = String(slot.time || '').trim()
  const procedureType = String(slot.procedureType || '').trim()

  const title = 'إلغاء موعد محجوز'
  const segs = [
    `أُلغي موعد للمريض «${patientName}»`,
    businessDate ? `يوم ${businessDate}` : null,
    time ? `الساعة ${time}` : null,
    procedureType ? `الإجراء: ${procedureType}` : null,
    `بواسطة ${cancellerName}`,
  ].filter(Boolean)
  const body = segs.join(' — ')

  const meta = {
    kind: 'appointment_cancelled',
    businessDate,
    time,
    patientName,
    procedureType,
    providerName: String(slot.providerName || ''),
    serviceType: String(slot.serviceType || ''),
  }

  const docs = [...recipientIds].map((userId) => ({
    userId: new mongoose.Types.ObjectId(userId),
    type: 'appointment_cancelled',
    read: false,
    title,
    body,
    meta,
  }))
  await UserNotification.insertMany(docs)
}
