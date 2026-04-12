import mongoose from 'mongoose'

const LASER_TYPES = ['Mix', 'Yag', 'Alex']

const laserSessionSchema = new mongoose.Schema(
  {
    treatmentNumber: { type: Number, required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    operatorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    room: { type: String, default: '1' },
    laserType: { type: String, enum: LASER_TYPES, required: true },
    pw: { type: String, default: '' },
    pulse: { type: String, default: '' },
    shotCount: { type: String, default: '' },
    notes: { type: String, default: '' },
    areaIds: [{ type: String }],
    /** مناطق مذكورة يدوياً (نص حر) */
    manualAreaLabels: [{ type: String, trim: true }],
    costUsd: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    sessionTypeLabel: { type: String, default: '' },
    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'completed_pending_collection', 'completed'],
      default: 'scheduled',
    },
    /** يُملأ عند الحفظ مع مسار الفوترة — الترحيل عند الاستقبال عبر billing_payment */
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null },
    clinicalSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalSession', default: null },
  },
  { timestamps: true },
)

laserSessionSchema.index({ patientId: 1, createdAt: -1 })

export const LaserSession = mongoose.model('LaserSession', laserSessionSchema)
export { LASER_TYPES }
