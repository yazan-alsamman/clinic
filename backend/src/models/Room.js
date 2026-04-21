import mongoose from 'mongoose'

const roomSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true, min: 1, max: 99 },
    morningAssignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    eveningAssignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    morningShiftStart: { type: String, default: '09:00' },
    morningShiftEnd: { type: String, default: '15:00' },
    eveningShiftStart: { type: String, default: '15:00' },
    eveningShiftEnd: { type: String, default: '21:00' },
    /** legacy field for old deployments; kept for backward compatibility */
    assignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

export const Room = mongoose.model('Room', roomSchema)
