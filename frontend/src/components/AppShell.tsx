import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useClinic } from '../context/ClinicContext'
import { useAuth } from '../context/AuthContext'
import { visibleNavForRole, roleLabel } from '../data/nav'
import { DayBanner } from './DayBanner'
import { CloseDayModal } from './CloseDayModal'

export function AppShell() {
  const { user, logout } = useAuth()
  const { dayActive } = useClinic()
  const location = useLocation()
  const navigate = useNavigate()
  const [closeOpen, setCloseOpen] = useState(false)
  const role = user?.role
  const nav = role ? visibleNavForRole(role) : []
  const gated = !dayActive && role !== 'super_admin'

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">ED</div>
          <div className="sidebar-brand-title">مركز الدكتور إلياس دحدل</div>
          <div className="sidebar-brand-sub">نظام تشغيل العيادة</div>
        </div>
        <nav className="sidebar-nav" aria-label="القائمة الرئيسية">
          {nav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {role === 'super_admin' && dayActive && (
          <div style={{ padding: '0 1rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '0.8rem' }}
              onClick={() => setCloseOpen(true)}
            >
              إغلاق اليوم
            </button>
          </div>
        )}
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <div className="topbar-meta">
            <span style={{ fontWeight: 600 }}>{user?.name ?? '—'}</span>
            {role ? <span className="role-pill">{roleLabel(role)}</span> : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.85rem' }}
            onClick={() => {
              logout()
              navigate('/login', { replace: true })
            }}
          >
            تسجيل الخروج
          </button>
        </header>

        <main className="main-content">
          <DayBanner />
          {gated ? (
            <div className="gate-overlay">
              <div className="gate-card">
                <h2 style={{ marginTop: 0 }}>النظام متوقف</h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  لم يبدأ يوم العمل بعد. تواصل مع المدير لتفعيل اليوم وإدخال سعر
                  الصرف.
                </p>
              </div>
            </div>
          ) : (
            <Outlet key={location.pathname} />
          )}
        </main>
      </div>

      <CloseDayModal open={closeOpen} onClose={() => setCloseOpen(false)} />
    </div>
  )
}
