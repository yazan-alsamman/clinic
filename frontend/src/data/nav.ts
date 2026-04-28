import type { NavKey, Role } from '../types'

export const navItems: { key: NavKey; path: string; label: string }[] = [
  { key: 'dashboard', path: '/', label: 'لوحة التحكم' },
  { key: 'admin_send_notifications', path: '/admin/send-notifications', label: 'إرسال إشعارات' },
  { key: 'patients', path: '/patients', label: 'المرضى' },
  { key: 'laser_create_session', path: '/laser/create-session', label: 'إنشاء جلسة' },
  { key: 'patients_intake_fast', path: '/patients/intake-fast', label: 'إدخال سريع للأضابير' },
  { key: 'appointments_booked', path: '/appointments', label: 'المواعيد المحجوزة' },
  { key: 'reception_appointment', path: '/reception/appointment', label: 'إضافة موعد' },
  { key: 'dermatology', path: '/dermatology', label: 'الجلدية' },
  { key: 'dental', path: '/dental', label: 'الأسنان' },
  { key: 'billing_queue', path: '/billing', label: 'التحصيل' },
  { key: 'reception_cash_movement', path: '/reception/cash-movement', label: 'حركة الصندوق' },
  { key: 'reception_daily_inventory', path: '/reception/daily-inventory', label: 'جرد مالي يومي' },
  { key: 'inventory', path: '/inventory', label: 'المستودع' },
  { key: 'reports_daily', path: '/reports/daily', label: 'تقرير الجرد اليومي' },
  { key: 'reports_insights', path: '/reports/insights', label: 'ذكاء الأعمال' },
  { key: 'admin_users', path: '/admin/users', label: 'المستخدمون' },
  { key: 'admin_audit', path: '/admin/audit', label: 'سجل النشاط' },
  { key: 'admin_rooms', path: '/admin/rooms', label: 'الغرف والتخصيص' },
  { key: 'admin_laser', path: '/admin/laser', label: 'ليزر' },
  { key: 'admin_accounting', path: '/admin/accounting', label: 'المحاسبة والترحيل' },
  { key: 'admin_financial_balances', path: '/admin/financial-balances', label: 'ذمم مالية' },
  { key: 'account_password', path: '/account/password', label: 'كلمة المرور' },
]

const roleNav: Record<Role, NavKey[]> = {
  super_admin: navItems.filter((n) => n.key !== 'laser_create_session').map((n) => n.key),
  reception: [
    'dashboard',
    'patients',
    'patients_intake_fast',
    'appointments_booked',
    'reception_appointment',
    'billing_queue',
    'reception_cash_movement',
    'reception_daily_inventory',
    'inventory',
    'account_password',
  ],
  laser: ['dashboard', 'appointments_booked', 'laser_create_session', 'account_password'],
  dermatology: ['dashboard', 'patients', 'appointments_booked', 'dermatology', 'account_password'],
  dental_branch: ['dashboard', 'patients', 'appointments_booked', 'dental', 'account_password'],
  solarium: ['dashboard', 'patients', 'appointments_booked', 'account_password'],
}

export function visibleNavForRole(role: Role) {
  /** مباشرة من القائمة لتفادي أي اختلاف بين roleNav و navItems */
  if (role === 'super_admin') {
    return navItems.filter((n) => n.key !== 'laser_create_session')
  }
  const keysArr = roleNav[role]
  if (!keysArr?.length) return []
  const keys = new Set(keysArr)
  return navItems.filter((n) => keys.has(n.key))
}

export function roleLabel(role: Role): string {
  const map: Record<Role, string> = {
    super_admin: 'مدير النظام',
    reception: 'استقبال',
    laser: 'ليزر',
    dermatology: 'جلدية',
    dental_branch: 'أسنان — فرع',
    solarium: 'سولاريوم',
  }
  return map[role]
}

export function canAccessTab(
  role: Role,
  tab: 'laser' | 'dermatology' | 'dental' | 'solarium',
): boolean {
  if (role === 'super_admin') return true
  /** الاستقبال: نظرة عامة + الحساب فقط — بدون تبويبات ليزر/جلدية/أسنان */
  if (role === 'reception') return false
  if (role === 'laser') return tab === 'laser'
  if (role === 'dermatology') return tab === 'dermatology'
  if (role === 'dental_branch') return tab === 'dental'
  if (role === 'solarium') return tab === 'solarium'
  return false
}
