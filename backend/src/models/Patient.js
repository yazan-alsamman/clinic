import mongoose from 'mongoose'

const paperLaserEntrySchema = new mongoose.Schema(
  {
    therapist: { type: String, default: '' },
    sessionDate: { type: String, default: '' },
    area: { type: String, default: '' },
    laserType: { type: String, default: '' },
    pw: { type: String, default: '' },
    pulse: { type: String, default: '' },
    shots: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: false },
)

const packageSessionSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    completedByReception: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    completedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    linkedLaserSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LaserSession', default: null },
    linkedBillingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null },
    /** عدد مرات «إنقاص منطقة» من الاستقبال لهذه جلسة الباكج (مناطق مُثبَّتة دون إغلاق الجلسة) */
    packagePartialAreasAcknowledgedByReception: { type: Number, default: 0, min: 0 },
    /** إنقاص مناطق فقط (بدون إنقاص جلسة) — تسوية من الاستقبال */
    areasAdjustedOnly: { type: Boolean, default: false },
    /** ملاحظة عند حذف منطقة من باكج أو إضافة من خارج الباكج */
    receptionNote: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { _id: true },
)

const patientPackageSchema = new mongoose.Schema(
  {
    department: { type: String, enum: ['laser', 'solarium'], default: 'laser' },
    /** مرجع قالب الباكج من لوحة المدير (اختياري — أول قالب عند اختيار عدة قوالب) */
    laserPackageTemplateId: { type: String, default: '', trim: true },
    /** قوالب باكج ليزر المدمجة عند البيع (واحد أو أكثر) */
    laserPackageTemplateIds: [{ type: String, trim: true }],
    /** نسخة المناطق وقت البيع — لا تتغير عند تعديل القالب لاحقاً */
    procedureOptionIds: [{ type: String, trim: true }],
    areaCount: { type: Number, default: 0, min: 0 },
    /** إيقاف مؤقت — لا يُستخدم في الحجز أو جلسات الباكج */
    suspended: { type: Boolean, default: false },
    title: { type: String, default: '' },
    sessionsCount: { type: Number, default: 0, min: 1 },
    packageTotalSyp: { type: Number, default: 0, min: 0 },
    paidAmountSyp: { type: Number, default: 0, min: 0 },
    settlementDeltaSyp: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sessions: { type: [packageSessionSchema], default: [] },
  },
  { _id: true, timestamps: true },
)

const dentalChartSurfaceSchema = new mongoose.Schema(
  {
    view: { type: String, enum: ['buccal', 'occlusal'], required: true },
    region: { type: String, enum: ['M', 'D', 'O', 'B', 'L', 'I'], required: true },
    label: { type: String, default: 'حشوة كومبوزيت', trim: true, maxlength: 120 },
  },
  { _id: false },
)

const dentalChartPaymentSchema = new mongoose.Schema(
  {
    amountSyp: { type: Number, required: true, min: 0 },
    amountUsd: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: ['syp', 'usd'], default: 'syp' },
    usdSypRateUsed: { type: Number, default: 0, min: 0 },
    paidAt: { type: String, default: '' },
    note: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { _id: true },
)

const dentalChartTreatmentSchema = new mongoose.Schema(
  {
    procedureDescription: { type: String, default: '', trim: true, maxlength: 2000 },
    totalCostSyp: { type: Number, default: 0, min: 0 },
    totalCostUsd: { type: Number, default: 0, min: 0 },
    /** سعر الصرف المستخدم لتحويل جزء التكلفة بالدولار (ل.س لكل 1 USD) */
    costUsdSypRate: { type: Number, default: 0, min: 0 },
    doctorName: { type: String, default: '', trim: true, maxlength: 160 },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** مفتاح مقدّم افتراضي بدون حساب (مثل elias) */
    providerKey: { type: String, default: '', trim: true, maxlength: 40 },
    /** تاريخ عمل الإجراء للتقارير المالية */
    businessDate: { type: String, default: '' },
    payments: { type: [dentalChartPaymentSchema], default: [] },
  },
  { _id: true },
)

const dentalChartLabWorkSchema = new mongoose.Schema(
  {
    labName: { type: String, default: '', trim: true, maxlength: 200 },
    procedureDescription: { type: String, default: '', trim: true, maxlength: 1000 },
    amountSyp: { type: Number, default: 0, min: 0 },
    businessDate: { type: String, default: '' },
    doctorName: { type: String, default: '', trim: true, maxlength: 160 },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    providerKey: { type: String, default: '', trim: true, maxlength: 40 },
  },
  { _id: true },
)

const dentalChartToothSchema = new mongoose.Schema(
  {
    fdi: { type: Number, required: true, min: 11, max: 48 },
    status: { type: String, enum: ['present', 'missing', 'implant'], default: 'present' },
    implantColor: { type: String, enum: ['teal', 'red'], default: undefined },
    surfaces: { type: [dentalChartSurfaceSchema], default: [] },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    /** إجراءات متعددة على نفس السن — كل إجراء بطبيب وتكلفة ودفعات */
    treatments: { type: [dentalChartTreatmentSchema], default: [] },
    /** أعمال المخابر المرتبطة بهذا السن */
    labWorks: { type: [dentalChartLabWorkSchema], default: [] },
    /** توافق قديم: إجراء واحد — يُرحَّل إلى treatments عند الحفظ */
    treatment: { type: dentalChartTreatmentSchema, default: undefined },
  },
  { _id: false },
)

const dentalChartSchema = new mongoose.Schema(
  {
    teeth: { type: [dentalChartToothSchema], default: [] },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
)

const patientSchema = new mongoose.Schema(
  {
    fileNumber: { type: String, required: true, trim: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    dob: { type: String, default: '' },
    marital: { type: String, default: '' },
    occupation: { type: String, default: '' },
    medicalHistory: { type: String, default: '' },
    surgicalHistory: { type: String, default: '' },
    allergies: { type: String, default: '' },
    drugHistory: { type: String, default: '' },
    pregnancyStatus: { type: String, enum: ['', 'pregnant', 'not_pregnant', 'planning_pregnancy'], default: '' },
    lactationStatus: { type: String, enum: ['', 'lactating', 'not_lactating'], default: '' },
    previousTreatments: { type: String, enum: ['', 'yes', 'no'], default: '' },
    recentDermTreatments: { type: String, enum: ['', 'yes', 'no'], default: '' },
    isotretinoinHistory: { type: String, enum: ['', 'yes', 'no'], default: '' },
    departments: {
      type: [String],
      enum: ['laser', 'dermatology', 'dental', 'solarium', 'skin'],
      default: [],
    },
    lastVisit: { type: Date, default: null },
    phone: { type: String, default: '' },
    gender: { type: String, default: '' },
    /** رصيد مستحق على المريض (ذمم) بالليرة */
    outstandingDebtSyp: { type: Number, default: 0, min: 0 },
    /** ذمم مسجّلة بالدولار (جلسات مسعّرة بالـ USD) — تُحفظ بالدولار ولا تُحوَّل لليرة */
    outstandingDebtUsd: { type: Number, default: 0, min: 0 },
    /** رصيد إضافي مدفوع مسبقاً للمريض */
    prepaidCreditSyp: { type: Number, default: 0, min: 0 },
    /** إدخالات أرشيف ورقي (ليزر/جلسات قديمة) */
    paperLaserEntries: { type: [paperLaserEntrySchema], default: [] },
    /** باقات جلسات مسبقة الدفع (حالياً: ليزر) */
    sessionPackages: { type: [patientPackageSchema], default: [] },
    /** مخطط الأسنان التفاعلي (FDI) */
    dentalChart: { type: dentalChartSchema, default: () => ({ teeth: [] }) },
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
