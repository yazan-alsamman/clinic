import mongoose from 'mongoose'

const scheduleSlotSchema = new mongoose.Schema(
  {
    businessDate: { type: String, required: true, index: true },
    /** وقت بداية الموعد HH:mm */
    time: { type: String, required: true },
    /** وقت نهاية الموعد HH:mm (بعد time) */
    endTime: { type: String, default: '', trim: true },
    providerName: { type: String, required: true, trim: true },
    serviceType: {
      type: String,
      enum: ['laser', 'dental', 'dermatology', 'solarium', 'other'],
      default: 'other',
      index: true,
    },
    roomNumber: { type: Number, default: null },
    assignedSpecialistUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedSpecialistName: { type: String, default: '', trim: true },
    /** نوع الإجراء (كشف، جلسة، …) */
    procedureType: { type: String, default: '', trim: true, maxlength: 200 },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    patientName: { type: String, default: '' },
    arrivedAt: { type: Date, default: null, index: true },
    arrivedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    arrivedByName: { type: String, default: '', trim: true },
  },
  { timestamps: true },
)

scheduleSlotSchema.index({ businessDate: 1, time: 1, providerName: 1 }, { unique: true })
scheduleSlotSchema.index({ patientId: 1 })

export const ScheduleSlot = mongoose.model('ScheduleSlot', scheduleSlotSchema)
