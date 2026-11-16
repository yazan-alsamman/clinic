import mongoose from 'mongoose'

/**
 * سجل خصم مستقل — سطر لكل خصم يُطبَّق على خدمة/جلسة/باكج.
 *
 * هذا السجل للتتبع والعرض فقط: لا يُنشئ أي قيد في الصندوق ولا يغيّر ذمة المريض.
 * المبالغ المعتمدة مالياً تبقى في BillingItem / BillingPayment / الباكج نفسه.
 * لا يُحذف السجل ولا يُعدّل عند تصحيح الخصم: يُعلَّم «ملغى» ويُنشأ سجل جديد يشير إليه.
 */
const discountRecordSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    department: { type: String, default: '' },
    /** نوع الهدف الذي يتبع له الخصم */
    targetType: {
      type: String,
      enum: ['billing_item', 'patient_package', 'dermatology_visit'],
      required: true,
    },
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null, index: true },
    clinicalSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalSession', default: null },
    laserSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LaserSession', default: null },
    dermatologyVisitId: { type: mongoose.Schema.Types.ObjectId, ref: 'DermatologyVisit', default: null },
    /** معرّف الباكج داخل Patient.sessionPackages */
    packageId: { type: String, default: '', index: true },
    serviceLabel: { type: String, default: '' },

    /** ترتيب الخصم على نفس الهدف (1، 2، …) */
    sequence: { type: Number, default: 1, min: 1 },
    /** list = محسوب على السعر الأصلي، remaining = على السعر المتبقي بعد الخصومات السابقة */
    basis: { type: String, enum: ['list', 'remaining'], default: 'list' },
    /** كيف أُدخل الخصم */
    entryMode: { type: String, enum: ['percent', 'amount'], default: 'percent' },

    /** السعر الأصلي للخدمة (قبل أي خصم) — لقطة */
    listPriceSyp: { type: Number, default: 0, min: 0 },
    /** السعر الذي حُسب عليه هذا الخصم */
    priceBeforeSyp: { type: Number, default: 0, min: 0 },
    /** النسبة الدقيقة (تُقرَّب عند العرض فقط) */
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    /** المبلغ المخصوم فعلياً — هو المرجع */
    discountAmountSyp: { type: Number, default: 0, min: 0 },
    priceAfterSyp: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'SYP' },

    /** مصدر التسجيل */
    source: {
      type: String,
      enum: ['payment', 'laser_session', 'dermatology_session', 'dermatology_visit', 'package_sale', 'package_price', 'admin_edit'],
      required: true,
    },
    appliedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** لقطة اسم المستخدم وقت التطبيق */
    appliedByName: { type: String, default: '' },
    appliedAt: { type: Date, default: () => new Date() },
    note: { type: String, default: '' },

    status: { type: String, enum: ['active', 'reversed'], default: 'active', index: true },
    reversedAt: { type: Date, default: null },
    reversedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reversedByName: { type: String, default: '' },
    reversalReason: { type: String, default: '' },
    /** السجل الذي حلّ محل هذا السجل بعد التصحيح (إن وجد) */
    replacedByRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'DiscountRecord', default: null },
    /** السجلات التي يصحّحها هذا السجل */
    correctsRecordIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DiscountRecord' }],
  },
  { timestamps: true },
)

discountRecordSchema.index({ patientId: 1, appliedAt: 1 })

export const DiscountRecord = mongoose.model('DiscountRecord', discountRecordSchema)
