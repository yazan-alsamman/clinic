export type Role =
  | 'super_admin'
  | 'reception'
  | 'laser'
  | 'dermatology'
  | 'dental_branch'
  | 'solarium'

export type NavKey =
  | 'dashboard'
  | 'patients'
  | 'laser_create_session'
  | 'patients_intake_fast'
  | 'appointments_booked'
  | 'reception_appointment'
  | 'dermatology'
  | 'dental'
  | 'billing_queue'
  | 'inventory'
  | 'reports_daily'
  | 'reports_insights'
  | 'admin_users'
  | 'admin_audit'
  | 'admin_rooms'
  | 'admin_laser'
  | 'admin_accounting'
  | 'admin_financial_balances'
  | 'account_password'

export interface Patient {
  id: string
  fileNumber: string
  name: string
  dob: string
  marital: string
  occupation: string
  medicalHistory: string
  surgicalHistory: string
  allergies: string
  drugHistory?: string
  pregnancyStatus?: '' | 'pregnant' | 'not_pregnant' | 'planning_pregnancy'
  lactationStatus?: '' | 'lactating' | 'not_lactating'
  previousTreatments?: '' | 'yes' | 'no'
  recentDermTreatments?: '' | 'yes' | 'no'
  isotretinoinHistory?: '' | 'yes' | 'no'
  departments: ('laser' | 'dermatology' | 'dental' | 'solarium')[]
  lastVisit: string
  phone?: string
  /** ذكر / أنثى — فارغ إن لم يُحدَّد */
  gender?: 'male' | 'female' | ''
  outstandingDebtUsd?: number
  prepaidCreditUsd?: number
  paperLaserEntries?: Array<{
    therapist: string
    sessionDate: string
    area: string
    laserType: string
    pw: string
    pulse: string
    shots: string
    notes: string
  }>
  sessionPackages?: Array<{
    id: string
    department: 'laser'
    title: string
    sessionsCount: number
    packageTotalUsd: number
    paidAmountUsd: number
    settlementDeltaUsd: number
    notes: string
    createdAt: string | null
    sessions: Array<{
      id: string
      label: string
      completedByReception: boolean
      completedAt: string | null
      completedByUserId: string | null
      linkedLaserSessionId: string | null
      linkedBillingItemId: string | null
    }>
  }>
}

export interface LaserArea {
  id: string
  label: string
  minutes: number
}

export interface LaserCategory {
  id: string
  title: string
  areas: LaserArea[]
}
