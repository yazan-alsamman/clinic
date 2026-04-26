import { Link } from 'react-router-dom'
import { useClinic } from '../context/ClinicContext'
import { useAuth } from '../context/AuthContext'
import { roleLabel } from '../data/nav'

export function Dashboard() {
  const { user } = useAuth()
  const { dayActive } = useClinic()
  const role = user?.role

  return (
    <>
      <h1 className="page-title">لوحة التحكم</h1>
      <p className="page-desc">
        نظرة سريعة حسب دورك:{' '}
        <strong>{role ? roleLabel(role) : '—'}</strong>
      </p>
      <div className="grid-2">
        <div className="stat-card">
          <div className="lbl">حالة اليوم</div>
          <div className="val" style={{ fontSize: '1.1rem', marginTop: '0.35rem' }}>
            {dayActive ? 'نشط' : 'متوقف'}
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">العملة</div>
          <div className="val" style={{ marginTop: '0.35rem' }}>
            ليرة سورية (ل.س) فقط
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">اختصارات</h2>
        <ul style={{ margin: 0, paddingRight: '1.25rem', color: 'var(--text-muted)' }}>
          <li>
            <Link to="/patients">البحث عن مريض</Link>
          </li>
          {(role === 'super_admin' || role === 'reception') && (
            <li>
              <Link to="/appointments">المواعيد المحجوزة</Link>
            </li>
          )}
          {role === 'super_admin' && (
            <li>
              <Link to="/admin/send-notifications">إرسال إشعارات للموظفين</Link>
            </li>
          )}
          {role === 'super_admin' && (
            <li>
              <Link to="/reports/daily">تقرير الجرد اليومي</Link>
            </li>
          )}
        </ul>
      </div>
    </>
  )
}
