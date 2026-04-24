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
  },
  { _id: true },
)

const patientPackageSchema = new mongoose.Schema(
  {
    department: { type: String, enum: ['laser'], default: 'laser' },
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
      enum: ['laser', 'dermatology', 'dental', 'solarium'],
      default: [],
    },
    lastVisit: { type: Date, default: null },
    phone: { type: String, default: '' },
    gender: { type: String, default: '' },
    /** رصيد مستحق على المريض (ذمم) */
    outstandingDebtSyp: { type: Number, default: 0, min: 0 },
    /** رصيد إضافي مدفوع مسبقاً للمريض */
    prepaidCreditSyp: { type: Number, default: 0, min: 0 },
    /** إدخالات أرشيف ورقي (ليزر/جلسات قديمة) */
    paperLaserEntries: { type: [paperLaserEntrySchema], default: [] },
    /** باقات جلسات مسبقة الدفع (حالياً: ليزر) */
    sessionPackages: { type: [patientPackageSchema], default: [] },
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
