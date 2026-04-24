import mongoose from 'mongoose'

/** سطر مالي / إجراء جلدية يظهر في تقرير الجرد اليومي */
const dermatologyVisitSchema = new mongoose.Schema(
  {
    businessDate: { type: String, required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    areaTreatment: { type: String, default: '' },
    sessionType: { type: String, default: 'جلدية / تجميل' },
    costSyp: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    /** تكلفة المواد (مستودع) — تُخصم من الأساس قبل نسبة الطبيب وفق ملف الحساب */
    materialCostSyp: { type: Number, default: 0, min: 0 },
    /** cosmetic | ortho — لربط أسنان تقويم لاحقاً */
    procedureClass: { type: String, enum: ['cosmetic', 'ortho', 'general'], default: 'cosmetic' },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
)

dermatologyVisitSchema.index({ businessDate: 1, createdAt: 1 })

export const DermatologyVisit = mongoose.model('DermatologyVisit', dermatologyVisitSchema)
