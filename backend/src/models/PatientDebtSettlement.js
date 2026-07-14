import mongoose from 'mongoose'

const patientDebtSettlementSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    businessDate: { type: String, required: true, trim: true, index: true },
    /** المبلغ المستلم نقداً من المريض */
    enteredSyp: { type: Number, required: true, min: 0 },
    appliedToDebtSyp: { type: Number, required: true, min: 0 },
    extraToCreditSyp: { type: Number, default: 0, min: 0 },
    debtBefore: { type: Number, default: 0, min: 0 },
    debtAfter: { type: Number, default: 0, min: 0 },
    paymentChannel: { type: String, enum: ['cash', 'bank'], default: 'cash' },
    bankName: { type: String, default: '', trim: true },
    /** عملة التحصيل الفعلية من المريض */
    payCurrency: { type: String, enum: ['SYP', 'USD', 'MIXED'], default: 'SYP' },
    /** عند الدفع بالدولار أو مختلط: مبلغ الدولار المستلم */
    receivedAmountUsd: { type: Number, default: 0, min: 0 },
    /** جزء الليرة النقدي المستلم عند مختلط؛ عند USD كامل يبقى عادة 0 مقابل السعر المحفوظ في enteredSyp */
    receivedAmountSypCash: { type: Number, default: 0, min: 0 },
    patientRefundSyp: { type: Number, default: 0, min: 0 },
    patientRefundUsd: { type: Number, default: 0, min: 0 },
    usdSypRateUsed: { type: Number, default: 0, min: 0 },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receivedAt: { type: Date, default: () => new Date(), index: true },
    /** توزيع المبلغ المخصوم من الذمة على الأقسام (ليزر، جلدية، …) */
    departmentAllocations: [
      {
        department: { type: String, required: true, trim: true },
        amountSyp: { type: Number, required: true, min: 0 },
        procedureLabel: { type: String, default: '', trim: true },
        billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null },
        clinicalSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalSession', default: null },
        providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      },
    ],
  },
  { timestamps: true },
)

patientDebtSettlementSchema.index({ businessDate: 1, receivedAt: 1 })

export const PatientDebtSettlement = mongoose.model('PatientDebtSettlement', patientDebtSettlementSchema)
