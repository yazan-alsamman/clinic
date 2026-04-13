import mongoose from 'mongoose'

const ROLES = [
  'super_admin',
  'reception',
  'laser',
  'dermatology',
  'dental_branch',
  'solarium',
]

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    active: { type: Boolean, default: true },
    /** نسبة استحقاق الطبيب/الأخصائي من صافي سطر الإجراء (لليزر / جلدية / أسنان) */
    doctorSharePercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true },
)

export const User = mongoose.model('User', userSchema)
export { ROLES }
