import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import logoEliasClinic from '../assets/logo-elias-clinic.png'
import { useClinic } from '../context/ClinicContext'
import { useAuth } from '../context/AuthContext'
import { visibleNavForRole, roleLabel } from '../data/nav'
import { DayBanner } from './DayBanner'
import { CloseDayModal } from './CloseDayModal'
import { LaserHalfDayMeterModal } from './LaserHalfDayMeterModal'
import { LaserMeterMismatchOverlay, laserMeterRoomsMismatch } from './LaserMeterMismatchOverlay'
import { NotificationBell } from './NotificationBell'

export function AppShell() {
  const { user, logout } = useAuth()
  const { dayActive, room1HalfDayPending, room2HalfDayPending, refreshSystem } = useClinic()
  const location = useLocation()
  const navigate = useNavigate()
  const [closeOpen, setCloseOpen] = useState(false)
  const [laserMeterMismatchOpen, setLaserMeterMismatchOpen] = useState(false)
  const [laserMismatchDateLabel, setLaserMismatchDateLabel] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [pendingBillingCount, setPendingBillingCount] = useState(0)
  const role = user?.role
  const nav = role ? visibleNavForRole(role) : []
  const canSeeBillingCount = role === 'super_admin' || role === 'reception'

  const laserHalfDayTargetRoom: 1 | 2 | null =
    role === 'reception' || role === 'super_admin'
      ? room1HalfDayPending
        ? 1
        : room2HalfDayPending
          ? 2
          : null
      : null
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!navOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [navOpen])

  useEffect(() => {
    if (!canSeeBillingCount) {
      setPendingBillingCount(0)
      return
    }
    let cancelled = false
    const loadCount = async () => {
      try {
        const qs = role === 'super_admin' ? '?all=1' : ''
        const data = await api<{ count?: number }>(`/api/billing/pending-count${qs}`)
        if (!cancelled) setPendingBillingCount(Number(data.count || 0))
      } catch {
        if (!cancelled) setPendingBillingCount(0)
      }
    }
    void loadCount()
    const id = window.setInterval(() => void loadCount(), 20000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [canSeeBillingCount, role, dayActive])

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  const onBusinessDayArchived = useCallback(
    async (info: { businessDate: string }) => {
      if (role !== 'super_admin') return
      const bd = String(info.businessDate || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) return
      try {
        const data = await api<{
          meterReconciliation?: {
            room1?: { complete?: boolean; matched?: boolean | null }
            room2?: { complete?: boolean; matched?: boolean | null }
          }
        }>(`/api/laser/shots-daily?date=${encodeURIComponent(bd)}`)
        if (!laserMeterRoomsMismatch(data.meterReconciliation)) return
        setLaserMismatchDateLabel(bd)
        setLaserMeterMismatchOpen(true)
        navigate(
          `/admin/laser?tab=shots&period=daily&date=${encodeURIComponent(bd)}&highlight=meters`,
          { replace: true },
        )
      } catch {
        /* تجاهل — لا نمنع الإغلاق */
      }
    },
    [navigate, role],
  )

  useEffect(() => {
    if (!laserMeterMismatchOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [laserMeterMismatchOpen])

  return (
    <div className={`app-layout${navOpen ? ' app-layout--nav-open' : ''}`}>
      {navOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="إغلاق القائمة"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside className="sidebar" id="app-sidebar" aria-label="التنقل">
        <div className="sidebar-brand">
          <img className="brand-logo-img" src={logoEliasClinic} alt="Elias dahdal clinic" />
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
              onClick={() => setNavOpen(false)}
            >
              <span>{item.label}</span>
              {item.key === 'billing_queue' && pendingBillingCount > 0 ? (
                <span className="sidebar-link-badge" aria-label={`${pendingBillingCount} بانتظار التحصيل`}>
                  {pendingBillingCount > 99 ? '99+' : pendingBillingCount}
                </span>
              ) : null}
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
          <div className="topbar-leading">
            <button
              type="button"
              className="sidebar-menu-btn"
              aria-expanded={navOpen}
              aria-controls="app-sidebar"
              onClick={() => setNavOpen((v) => !v)}
            >
              <span className="sidebar-menu-btn__bars" aria-hidden />
              <span className="sr-only">القائمة</span>
            </button>
            <div className="topbar-meta">
              <span style={{ fontWeight: 600 }}>{user?.name ?? '—'}</span>
              {role ? <span className="role-pill">{roleLabel(role)}</span> : null}
            </div>
            <NotificationBell />
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.85rem' }}
            onClick={() => {
              void (async () => {
                await logout()
                navigate('/login', { replace: true })
              })()
            }}
          >
            تسجيل الخروج
          </button>
        </header>

        <main className="main-content">
          <DayBanner />
          <Outlet key={location.pathname} />
        </main>
      </div>

      <CloseDayModal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onArchived={onBusinessDayArchived}
      />

      <LaserMeterMismatchOverlay
        open={laserMeterMismatchOpen}
        businessDateLabel={laserMismatchDateLabel}
        onDismiss={() => setLaserMeterMismatchOpen(false)}
      />

      <LaserHalfDayMeterModal
        open={laserHalfDayTargetRoom != null}
        room={laserHalfDayTargetRoom ?? 1}
        onRecorded={() => void refreshSystem()}
      />
    </div>
  )
}
