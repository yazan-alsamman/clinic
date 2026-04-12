import mongoose from 'mongoose'

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    dob: { type: String, default: '' },
    marital: { type: String, default: '' },
    occupation: { type: String, default: '' },
    medicalHistory: { type: String, default: '' },
    surgicalHistory: { type: String, default: '' },
    allergies: { type: String, default: '' },
    departments: {
      type: [String],
      enum: ['laser', 'dermatology', 'dental'],
      default: [],
    },
    lastVisit: { type: Date, default: null },
    phone: { type: String, default: '' },
    gender: { type: String, default: '' },
    /** بوابة المريض — تسجيل دخول منفصل عن موظفي العيادة */
    portalUsername: { type: String, trim: true, sparse: true, unique: true },
    portalPasswordHash: { type: String, default: undefined },
    portalEnabled: { type: Boolean, default: true },
    portalMustChangePassword: { type: Boolean, default: false },
    portalLastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
)

patientSchema.index({ name: 'text' })

export const Patient = mongoose.model('Patient', patientSchema)
