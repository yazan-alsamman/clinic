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

/**
 * منطقة ضمن باكج ليزر برصيد جلسات مستقل (نسخة وقت البيع أو أول إنقاص).
 * المفتاح ثابت: معرّف الخيار + ترتيب تكراره + ترتيب الجزء داخل العرض.
 */
const packageAreaSessionsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 120 },
    procedureOptionId: { type: String, default: '', trim: true },
    label: { type: String, default: '', trim: true, maxlength: 160 },
    sessionsTotal: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

/**
 * إنقاص جلسة واحدة من منطقة واحدة. لا يُحذف أبداً — التصحيح بعلامة reversedAt.
 */
const packageAreaDeductionSchema = new mongoose.Schema(
  {
    areaKey: { type: String, required: true, trim: true },
    areaLabel: { type: String, default: '', trim: true, maxlength: 160 },
    /** laser_visit = من زيارة ليزر مسجّلة، manual = إنقاص يدوي من ملف المريض */
    source: { type: String, enum: ['laser_visit', 'manual'], default: 'laser_visit' },
    laserSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LaserSession', default: null },
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null },
    /** تاريخ الزيارة (يوم العمل) */
    visitDate: { type: String, default: '' },
    deductedAt: { type: Date, default: null },
    deductedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deductedByName: { type: String, default: '' },
    /** معرّف الطلب من الواجهة — إعادة الإرسال بنفس المعرّف لا تُنقص مرة ثانية */
    requestId: { type: String, default: '', trim: true, maxlength: 80 },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    reversedAt: { type: Date, default: null },
    reversedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reverseReason: { type: String, default: '', trim: true, maxlength: 500 },
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
    /** السعر المعتمد للباكج بعد كل الخصومات — هو أساس الذمة/الرصيد */
    packageTotalSyp: { type: Number, default: 0, min: 0 },
    /** السعر قبل الخصم (سعر القالب أو السعر المُدخل قبل الخصم) — 0 في الباكجات القديمة */
    listPriceSyp: { type: Number, default: 0, min: 0 },
    /** إجمالي الخصم على الباكج (تفصيل كل خصم في DiscountRecord) */
    discountAmountSyp: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    paidAmountSyp: { type: Number, default: 0, min: 0 },
    settlementDeltaSyp: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sessions: { type: [packageSessionSchema], default: [] },
    /** ليزر: رصيد كل منطقة على حدة (فارغ في الباكجات القديمة حتى أول إنقاص بالمناطق) */
    areaSessions: { type: [packageAreaSessionsSchema], default: [] },
    /** ليزر: سجل إنقاص جلسات المناطق (جلسة لكل منطقة مُعالَجة) */
    areaDeductions: { type: [packageAreaDeductionSchema], default: [] },
  },
  { _id: true, timestamps: true },
)

const dentalChartSurfaceSchema = new mongoose.Schema(
  {
    view: { type: String, enum: ['buccal', 'occlusal'], required: true },
    region: { type: String, enum: ['M', 'D', 'O', 'B', 'L', 'I'], required: true },
    label: { type: String, default: 'حشوة كومبوزيت', trim: true, maxlength: 120 },
    /** preexisting = عند القدوم، clinic = نُفّذ في العيادة */
    origin: { type: String, enum: ['preexisting', 'clinic'], default: 'preexisting' },
    /** لقطة من خيار لوحة التحكم وقت الرسم */
    markOptionId: { type: String, default: '', trim: true, maxlength: 40 },
    color: { type: String, default: '', trim: true, maxlength: 20 },
    shape: { type: String, enum: ['fill', 'outline', 'cross', 'stripe', 'dot', ''], default: '' },
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
    /** الإجراءات العامة (قاعدة الجلسات): الجلسة التي حُصّلت فيها الدفعة */
    sessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { _id: true },
)

/** مستهلك مستخدم في جلسة إجراء عام — يُطرح من المحصّل قبل احتساب عمولة الطبيب */
const generalSessionConsumableSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true, maxlength: 200 },
    quantity: { type: Number, default: 1, min: 0 },
    amountSyp: { type: Number, default: 0, min: 0 },
    amountUsd: { type: Number, default: 0, min: 0 },
    costUsdSypRate: { type: Number, default: 0, min: 0 },
    /** تاريخ الأثر المالي: تاريخ الجلسة، أو تاريخ التصحيح إن أُضيف بعد إغلاقها */
    effectiveDate: { type: String, default: '' },
    addedAfterClose: { type: Boolean, default: false },
    addedAt: { type: Date, default: null },
    addedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    addedByName: { type: String, default: '' },
    correctionReason: { type: String, default: '', maxlength: 500 },
    /** حذف منطقي — يبقى المستهلك في السجل */
    removedAt: { type: Date, default: null },
    removedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    removedByName: { type: String, default: '' },
    removedReason: { type: String, default: '', maxlength: 500 },
    removedAfterClose: { type: Boolean, default: false },
    removedEffectiveDate: { type: String, default: '' },
  },
  { _id: true },
)

/** تسوية صريحة عند تصحيح مستهلكات جلسة مغلقة (القيم قبل وبعد + فرق العمولة) */
const generalSessionAdjustmentSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ['consumable_added', 'consumable_removed'], required: true },
    consumableId: { type: mongoose.Schema.Types.ObjectId, default: null },
    consumableName: { type: String, default: '' },
    amountSyp: { type: Number, default: 0 },
    businessDate: { type: String, default: '' },
    reason: { type: String, default: '', maxlength: 500 },
    at: { type: Date, default: null },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    previousConsumablesSyp: { type: Number, default: 0 },
    newConsumablesSyp: { type: Number, default: 0 },
    previousNetSyp: { type: Number, default: 0 },
    newNetSyp: { type: Number, default: 0 },
    previousCommissionSyp: { type: Number, default: 0 },
    newCommissionSyp: { type: Number, default: 0 },
    commissionDeltaSyp: { type: Number, default: 0 },
  },
  { _id: true },
)

/** جلسة ضمن إجراء عام — لكل جلسة مستهلكاتها وحسابها المستقل */
const generalTreatmentSessionSchema = new mongoose.Schema(
  {
    sessionDate: { type: String, default: '' },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    autoCreated: { type: Boolean, default: false },
    consumables: { type: [generalSessionConsumableSchema], default: [] },
    adjustments: { type: [generalSessionAdjustmentSchema], default: [] },
    createdAt: { type: Date, default: null },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
    closedAt: { type: Date, default: null },
    closedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByName: { type: String, default: '' },
    closedAutomatically: { type: Boolean, default: false },
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
    /** بند التحصيل في الاستقبال */
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null },
    clinicalSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalSession', default: null },
    /** تخدير عام — تكلفة تُعامل مالياً مثل المخبر */
    generalAnesthesia: { type: Boolean, default: false },
    generalAnesthesiaAmountSyp: { type: Number, default: 0, min: 0 },
    generalAnesthesiaAmountUsd: { type: Number, default: 0, min: 0 },
    generalAnesthesiaUsdSypRate: { type: Number, default: 0, min: 0 },
    /**
     * قاعدة عمولة الإجراء العام: '' = القاعدة القديمة (سجلات سابقة لا يُعاد احتسابها)،
     * 'cash_sessions_v1' = (المحصّل في الجلسة − مستهلكاتها) ÷ 3
     */
    commissionRule: { type: String, default: '', trim: true, maxlength: 40 },
    sessions: { type: [generalTreatmentSessionSchema], default: [] },
  },
  { _id: true },
)

const dentalChartLabWorkSchema = new mongoose.Schema(
  {
    /** مرجع لمخبر من قائمة المخابر (اختياري للتوافق مع السجلات القديمة) */
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'DentalLab', default: null },
    labName: { type: String, default: '', trim: true, maxlength: 200 },
    procedureDescription: { type: String, default: '', trim: true, maxlength: 1000 },
    amountSyp: { type: Number, default: 0, min: 0 },
    amountUsd: { type: Number, default: 0, min: 0 },
    /** سعر الصرف المستخدم لجزء التكلفة بالدولار (ل.س لكل 1 USD) */
    usdSypRate: { type: Number, default: 0, min: 0 },
    businessDate: { type: String, default: '' },
    doctorName: { type: String, default: '', trim: true, maxlength: 160 },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    providerKey: { type: String, default: '', trim: true, maxlength: 40 },
    /** ربط اختياري بإجراء عام في نفس المخطط */
    linkedGeneralTreatmentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { _id: true },
)

/** قسط تقويم — يُرسل للتحصيل؛ حصة الطبيب تُحسب من المبلغ المسدّد فقط */
const dentalOrthoInstallmentSchema = new mongoose.Schema(
  {
    amountSyp: { type: Number, default: 0, min: 0 },
    amountUsd: { type: Number, default: 0, min: 0 },
    costUsdSypRate: { type: Number, default: 0, min: 0 },
    businessDate: { type: String, default: '' },
    note: { type: String, default: '', trim: true, maxlength: 300 },
    payments: { type: [dentalChartPaymentSchema], default: [] },
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', default: null },
    clinicalSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalSession', default: null },
  },
  { _id: true },
)

/** مستلزم تقويم — يُطرح من أساس حصة الطبيب مثل تكلفة المخبر */
const dentalOrthoSupplySchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true, maxlength: 200 },
    amountSyp: { type: Number, default: 0, min: 0 },
    amountUsd: { type: Number, default: 0, min: 0 },
    costUsdSypRate: { type: Number, default: 0, min: 0 },
    businessDate: { type: String, default: '' },
  },
  { _id: true },
)

/** حالة تقويم لمريض — مرتبطة بطبيب أسنان؛ التسديد على دفعات */
const dentalOrthoCaseSchema = new mongoose.Schema(
  {
    title: { type: String, default: 'تقويم', trim: true, maxlength: 200 },
    doctorName: { type: String, default: '', trim: true, maxlength: 160 },
    providerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    providerKey: { type: String, default: '', trim: true, maxlength: 40 },
    /** إجمالي خطة التقويم للعرض (اختياري) — لا يُحسب كله لحصة الطبيب دفعة واحدة */
    totalCostSyp: { type: Number, default: 0, min: 0 },
    totalCostUsd: { type: Number, default: 0, min: 0 },
    costUsdSypRate: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '', trim: true, maxlength: 2000 },
    startedAt: { type: String, default: '' },
    active: { type: Boolean, default: true },
    installments: { type: [dentalOrthoInstallmentSchema], default: [] },
    supplies: { type: [dentalOrthoSupplySchema], default: [] },
  },
  { _id: true },
)

const dentalChartToothSchema = new mongoose.Schema(
  {
    fdi: { type: Number, required: true, min: 11, max: 48 },
    status: { type: String, enum: ['present', 'missing', 'implant'], default: 'present' },
    /** preexisting = جاء هكذا، clinic = تغيّر في هذه العيادة (خلع/زراعة هنا) */
    statusOrigin: { type: String, enum: ['preexisting', 'clinic'], default: 'preexisting' },
    /** تبقى إشارة الخلع حتى بعد الزراعة، ولا تُمسح إلا بحذف الطبيب */
    extractionMark: { type: Boolean, default: false },
    extractionOrigin: { type: String, enum: ['preexisting', 'clinic'], default: 'preexisting' },
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
    /** إجراءات عامة (تنظيف، تبييض، …) — ليست مرتبطة بسن محدد */
    generalTreatments: { type: [dentalChartTreatmentSchema], default: [] },
    /** مخابر مرتبطة بالإجراءات العامة (وليست بسن محدد) */
    generalLabWorks: { type: [dentalChartLabWorkSchema], default: [] },
    /** حالات التقويم — تسديد على دفعات؛ حصة الطبيب من كل دفعة مسدّدة */
    orthodonticCases: { type: [dentalOrthoCaseSchema], default: [] },
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
    /** رصيد إضافي مدفوع مسبقاً للمريض (ليزر / جلدية / بشرة / سولاريوم) */
    prepaidCreditSyp: { type: Number, default: 0, min: 0 },
    /** رصيد إضافي للأسنان فقط — لا يُخصم إلا عند تحصيل إجراء أسنان */
    prepaidCreditDentalSyp: { type: Number, default: 0, min: 0 },
    /** إدخالات أرشيف ورقي (ليزر/جلسات قديمة) */
    paperLaserEntries: { type: [paperLaserEntrySchema], default: [] },
    /** باقات جلسات مسبقة الدفع (حالياً: ليزر) */
    sessionPackages: { type: [patientPackageSchema], default: [] },
    /** يزداد مع كل إنقاص مناطق باكج — يمنع الإنقاص المزدوج عند طلبين متزامنين */
    laserAreaLedgerRev: { type: Number, default: 0 },
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
