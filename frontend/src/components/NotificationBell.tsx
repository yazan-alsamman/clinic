import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

type NotificationItem = {
  id: string
  type: string
  read: boolean
  title: string
  body: string
  meta: {
    kind?: string
    businessDate?: string
    time?: string
    patientName?: string
    procedureType?: string
    providerName?: string
    serviceType?: string
  }
  createdAt: string | null
}

const POLL_MS = 25000

export function NotificationBell() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const data = await api<{ notifications: NotificationItem[]; unreadCount: number }>(
        '/api/notifications?limit=50',
      )
      setItems(data.notifications || [])
      setUnreadCount(Number(data.unreadCount || 0))
    } catch {
      /* تجاهل أخطاء الشبكة أثناء التصفح */
    }
  }, [user])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void (async () => {
      await load()
      setLoading(false)
    })()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function markRead(id: string) {
    try {
      const data = await api<{ unreadCount: number }>(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
      })
      setUnreadCount(Number(data.unreadCount ?? 0))
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    } catch {
      /* ignore */
    }
  }

  async function markAllRead() {
    try {
      await api('/api/notifications/read-all', { method: 'POST' })
      setUnreadCount(0)
      setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch {
      /* ignore */
    }
  }

  if (!user) return null

  const canPickHistoryDate = user.role === 'super_admin' || user.role === 'reception'

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="الإشعارات"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'relative',
          fontSize: '1.05rem',
          padding: '0.35rem 0.55rem',
          lineHeight: 1,
        }}
      >
        🔔
        {unreadCount > 0 ? (
          <span
            className="sidebar-link-badge"
            style={{ position: 'absolute', top: -2, left: -2, minWidth: 18, textAlign: 'center', fontSize: '0.7rem' }}
            aria-label={`${unreadCount} غير مقروء`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: '100%',
            insetInlineEnd: 0,
            marginTop: 6,
            width: 'min(360px, calc(100vw - 2rem))',
            maxHeight: '70vh',
            overflow: 'auto',
            zIndex: 200,
            boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
            padding: '0.65rem 0.75rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: '0.95rem' }}>الإشعارات</strong>
            {unreadCount > 0 ? (
              <button type="button" className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => void markAllRead()}>
                تعيين الكل كمقروء
              </button>
            ) : null}
          </div>
          {loading ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>جاري التحميل…</p>
          ) : items.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>لا توجد إشعارات.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
              {items.map((n) => {
                const isAppointmentCancel =
                  n.type === 'appointment_cancelled' || n.meta?.kind === 'appointment_cancelled'
                const dateQ =
                  isAppointmentCancel &&
                  canPickHistoryDate &&
                  n.meta?.businessDate &&
                  /^\d{4}-\d{2}-\d{2}$/.test(n.meta.businessDate)
                    ? `?date=${encodeURIComponent(n.meta.businessDate)}`
                    : ''
                return (
                  <li
                    key={n.id}
                    style={{
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      padding: '0.5rem 0.55rem',
                      background: n.read ? 'transparent' : 'var(--surface-solid)',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.86rem', marginBottom: 4 }}>{n.title}</div>
                    <p style={{ margin: '0 0 0.45rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      {n.body}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                      {isAppointmentCancel ? (
                        <Link
                          to={`/appointments${dateQ}`}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.45rem' }}
                          onClick={() => {
                            void markRead(n.id)
                            setOpen(false)
                          }}
                        >
                          المواعيد المحجوزة
                        </Link>
                      ) : null}
                      {!n.read ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.75rem' }}
                          onClick={() => void markRead(n.id)}
                        >
                          مقروء
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
