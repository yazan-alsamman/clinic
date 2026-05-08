import mongoose from 'mongoose'

/** مستند واحد: تعيين سكرتارية الاستقبال للورديتين الصباحية والمسائية */
const secretaryShiftSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    morningAssignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    eveningAssignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    morningShiftStart: { type: String, default: '09:00' },
    morningShiftEnd: { type: String, default: '15:00' },
    eveningShiftStart: { type: String, default: '15:00' },
    eveningShiftEnd: { type: String, default: '21:00' },
  },
  { collection: 'secretaryshiftsettings' },
)

export const SecretaryShiftSettings = mongoose.model('SecretaryShiftSettings', secretaryShiftSchema)
