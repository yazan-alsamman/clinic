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
    department: { type: String, enum: ['laser', 'dermatology', 'dental', 'solarium', 'skin'], required: true },
    procedureLabel: { type: String, default: '' },
    amountDueSyp: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'SYP' },
    businessDate: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingPayment', default: null },
    paidAt: { type: Date, default: null },
    /** جلسة ضمن باكج مدفوع مسبقاً — لا تستقبل دفعة نقدية من شاشة التحصيل */
    isPackagePrepaid: { type: Boolean, default: false, index: true },
    patientPackageId: { type: String, default: '' },
    patientPackageSessionId: { type: String, default: '' },
  },
  { timestamps: true },
)

billingItemSchema.index({ status: 1, businessDate: -1 })

export const BillingItem = mongoose.model('BillingItem', billingItemSchema)
