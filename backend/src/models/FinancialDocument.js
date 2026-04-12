import mongoose from 'mongoose'

const financialLineSchema = new mongoose.Schema(
  {
    lineType: {
      type: String,
      required: true,
      /** net_revenue, material_cost, doctor_share, clinic_net, discount_memo */
    },
    amountUsd: { type: Number, required: true },
    amountSyp: { type: Number, default: null },
    glAccountCode: { type: String, default: '' },
    dimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
)

const financialDocumentSchema = new mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    sourceType: {
      type: String,
      enum: [
        'laser_session',
        'dermatology_visit',
        'dental_procedure',
        'manual_adjustment',
        'billing_payment',
      ],
      required: true,
    },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    businessDate: { type: String, required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    department: { type: String, required: true, index: true },
    exchangeRate: { type: Number, default: null },
    calculationProfileCode: { type: String, default: '' },
    parameterSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** مدخلات التسعير عند الترحيل (للتقارير دون إعادة قراءة المصدر) */
    sourceInputSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    stepResults: { type: mongoose.Schema.Types.Mixed, default: {} },
    lines: { type: [financialLineSchema], default: [] },
    status: { type: String, enum: ['posted', 'voided'], default: 'posted' },
    postedAt: { type: Date, default: () => new Date() },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

financialDocumentSchema.index({ businessDate: 1, department: 1 })
financialDocumentSchema.index({ sourceType: 1, sourceId: 1 })

export const FinancialDocument = mongoose.model('FinancialDocument', financialDocumentSchema)
