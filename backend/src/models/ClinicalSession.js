import mongoose from 'mongoose'

const materialLineSchema = new mongoose.Schema(
  {
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    sku: { type: String, default: '' },
    name: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unitCostUsd: { type: Number, default: 0 },
    lineCostUsd: { type: Number, default: 0 },
    chargedUnitPriceUsd: { type: Number, default: 0 },
    lineChargeUsd: { type: Number, default: 0 },
  },
  { _id: false },
)

/** جلسة/إجراء سريري — الرسوم يدوية؛ لا يُعتبر مدفوعاً حتى يؤكد الاستقبال */
const clinicalSessionSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: String, enum: ['laser', 'dermatology', 'dental', 'solarium'], required: true, index: true },
    procedureDescription: { type: String, default: '', trim: true },
    sessionFeeUsd: { type: Number, required: true, min: 0 },
    businessDate: { type: String, required: true, index: true },
    notes: { type: String, default: '' },
    materials: { type: [materialLineSchema], default: [] },
    materialCostUsdTotal: { type: Number, default: 0 },
    materialChargeUsdTotal: { type: Number, default: 0 },
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null },
    /** مَن أنشأ الجلسة من الاستقبال (بدون تفاصيل طبية بعد) */
    createdByReceptionUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: undefined,
    },
    /** ربط بجلسة ليزر عند التسجيل من ملف المريض — بدون default: null حتى لا يُخزَّن null مع فهرس unique+sparse (كان يمنع إنشاء أكثر من جلسة غير ليزر) */
    laserSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LaserSession',
      sparse: true,
      unique: true,
      index: true,
    },
  },
  { timestamps: true },
)

clinicalSessionSchema.index({ billingItemId: 1 })

export const ClinicalSession = mongoose.model('ClinicalSession', clinicalSessionSchema)
