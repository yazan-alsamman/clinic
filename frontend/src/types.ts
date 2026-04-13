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
  | 'admin_accounting'
  | 'account_password'

export interface Patient {
  id: string
  name: string
  dob: string
  marital: string
  occupation: string
  medicalHistory: string
  surgicalHistory: string
  allergies: string
  departments: ('laser' | 'dermatology' | 'dental' | 'solarium')[]
  lastVisit: string
  phone?: string
  /** ذكر / أنثى — فارغ إن لم يُحدَّد */
  gender?: 'male' | 'female' | ''
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
