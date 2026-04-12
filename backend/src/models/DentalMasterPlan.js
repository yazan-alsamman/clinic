import mongoose from 'mongoose'

const dentalMasterPlanSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, unique: true },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    items: [
      {
        label: String,
        note: String,
        tooth: Number,
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export const DentalMasterPlan = mongoose.model('DentalMasterPlan', dentalMasterPlanSchema)
