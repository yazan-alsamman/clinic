import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

type PopoverBox = { top: number; left: number; width: number; maxHeight: number }

/** يبقى داخل نافذة العرض (يتفادى قصّ body overflow-x / شريط التنقل على التاب) */
function computePopoverBox(trigger: DOMRect): PopoverBox {
  const vv = window.visualViewport
  const vw = Math.min(vv?.width ?? window.innerWidth, window.innerWidth)
  const vh = Math.min(vv?.height ?? window.innerHeight, window.innerHeight)
  const margin = 14

  const maxW = Math.min(440, Math.max(220, vw - margin * 2))
  const maxH = Math.min(560, Math.max(160, vh - margin * 2 - 12))

  const spaceBelow = vh - trigger.bottom - margin
  const spaceAbove = trigger.top - margin
  const openBelow = spaceBelow >= Math.min(200, maxH * 0.38) || spaceBelow >= spaceAbove

  let top = openBelow ? trigger.bottom + 6 : trigger.top - 6 - maxH
  top = Math.max(margin, Math.min(top, vh - margin - maxH))

  let left = trigger.left
  let width = maxW
  if (left + width > vw - margin) left = vw - margin - width
  if (left < margin) left = margin
  if (left + width > vw - margin) {
    width = Math.max(200, vw - margin - left)
  }

  return { top, left, width, maxHeight: maxH }
}

export function NotificationBell() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [popover, setPopover] = useState<PopoverBox | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const reposition = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !open) return
    setPopover(computePopoverBox(wrap.getBoundingClientRect()))
  }, [open])

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

  useLayoutEffect(() => {
    if (!open) {
      setPopover(null)
      return
    }
    reposition()
  }, [open, reposition, items.length, loading])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent | PointerEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('pointerdown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('pointerdown', onDoc)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => reposition()) : null
    ro?.observe(document.documentElement)
    const onWin = () => reposition()
    window.addEventListener('resize', onWin)
    window.visualViewport?.addEventListener('resize', onWin)
    window.visualViewport?.addEventListener('scroll', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', onWin)
      window.visualViewport?.removeEventListener('resize', onWin)
      window.visualViewport?.removeEventListener('scroll', onWin)
      window.removeEventListener('scroll', onWin, true)
    }
  }, [open, reposition])

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
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="الإشعارات"
        onClick={() =>
          setOpen((prev) => {
            if (prev) {
              setPopover(null)
              return false
            }
            if (wrapRef.current) setPopover(computePopoverBox(wrapRef.current.getBoundingClientRect()))
            return true
          })
        }
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
      {open && popover
        ? createPortal(
            <div
              ref={panelRef}
              className="card notification-popover"
              role="dialog"
              aria-label="قائمة الإشعارات"
              style={{
                position: 'fixed',
                top: popover.top,
                left: popover.left,
                width: popover.width,
                maxHeight: popover.maxHeight,
                overflow: 'auto',
                zIndex: 400,
                boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
                padding: '0.65rem 0.75rem',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: '0.5rem', flexWrap: 'wrap' }}>
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
                        className="notification-popover__item"
                        style={{
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          padding: '0.5rem 0.55rem',
                          background: n.read ? 'transparent' : 'var(--surface-solid)',
                          minWidth: 0,
                        }}
                      >
                        <div className="notification-popover__title">{n.title}</div>
                        <p className="notification-popover__body">{n.body}</p>
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
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
