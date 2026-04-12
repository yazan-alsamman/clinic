import { AuditLog } from '../models/AuditLog.js'

export async function writeAudit({ user, action, entityType = '', entityId = '', details = null }) {
  await AuditLog.create({
    userId: user?._id ?? null,
    userName: user?.name ?? '',
    action,
    entityType,
    entityId: entityId != null ? String(entityId) : '',
    details,
  })
}
