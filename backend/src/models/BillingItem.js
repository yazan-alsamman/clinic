import mongoose from 'mongoose'

const billingItemSchema = new mongoose.Schema(
  {
    clinicalSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClinicalSession',
      required: true,
      unique: true,
      index: true,
    },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    department: { type: String, enum: ['laser', 'dermatology', 'dental', 'solarium'], required: true },
    procedureLabel: { type: String, default: '' },
    amountDueUsd: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },
    businessDate: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingPayment', default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
)

billingItemSchema.index({ status: 1, businessDate: -1 })

export const BillingItem = mongoose.model('BillingItem', billingItemSchema)
