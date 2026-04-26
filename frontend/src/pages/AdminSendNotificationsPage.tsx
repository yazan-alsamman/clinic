import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { roleLabel } from '../data/nav'
import type { Role } from '../types'

type UserRow = {
  id: string
  email: string
  name: string
  role: Role
  active: boolean
}

export function AdminSendNotificationsPage() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'

  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    try {
      setLoading(true)
      const data = await api<{ users: UserRow[] }>('/api/users')
      setUsers(data.users || [])
    } catch (e) {
      setUsers([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل المستخدمين')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    )
  }, [users, filter])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectFiltered() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const u of filteredUsers) next.add(u.id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  async function submit() {
    setErr('')
    setOkMsg('')
    const ids = [...selected]
    if (ids.length === 0) {
      setErr('اختر مستخدماً واحداً على الأقل.')
      return
    }
    const text = body.trim()
    if (!text) {
      setErr('أدخل نص الإشعار.')
      return
    }
    setSending(true)
    try {
      const data = await api<{ sent: number }>('/api/notifications/admin-send', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim() || undefined,
          body: text,
          userIds: ids,
        }),
      })
      setOkMsg(`تم إرسال الإشعار إلى ${data.sent} مستخدم.`)
      setBody('')
      setTitle('')
      setSelected(new Set())
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر الإرسال')
    } finally {
      setSending(false)
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">إرسال إشعارات</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">إرسال إشعارات</h1>
      <p className="page-desc">
        إنشاء إشعار يظهر في قائمة الجرس لدى الموظفين المحددين. لا يُرسل خارج النظام (بريد أو رسائل نصية).
      </p>

      <div className="card" style={{ marginTop: '1rem', maxWidth: 720 }}>
        <h2 className="card-title" style={{ marginBottom: '0.5rem' }}>
          محتوى الإشعار
        </h2>
        <label className="form-label" htmlFor="admin-notif-title">
          عنوان (اختياري)
        </label>
        <input
          id="admin-notif-title"
          className="input"
          dir="rtl"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="يُستخدم «إشعار من مدير النظام» إذا تركت الحقل فارغاً"
          style={{ marginBottom: '0.65rem' }}
        />
        <label className="form-label" htmlFor="admin-notif-body">
          نص الإشعار <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <textarea
          id="admin-notif-body"
          className="input"
          dir="rtl"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="اكتب الرسالة التي ستظهر للمستخدمين…"
          style={{ resize: 'vertical', minHeight: 120 }}
        />
      </div>

      <div className="card" style={{ marginTop: '1rem', maxWidth: 720 }}>
        <h2 className="card-title" style={{ marginBottom: '0.5rem' }}>
          المستلمون
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
          <input
            className="input"
            dir="rtl"
            placeholder="بحث بالاسم أو البريد أو الدور…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: '1 1 200px', minWidth: 180 }}
          />
          <button type="button" className="btn btn-secondary" onClick={selectFiltered}>
            تحديد المعروض
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearSelection}>
            إلغاء التحديد
          </button>
        </div>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          محدد: <strong>{selected.size}</strong> — إجمالي المستخدمين: {users.length}
        </p>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
        ) : (
          <div
            className="table-wrap"
            style={{
              maxHeight: 320,
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }} />
                  <th>الاسم</th>
                  <th>البريد</th>
                  <th>الدور</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      لا يوجد مستخدمون يطابقون البحث.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(u.id)}
                          onChange={() => toggle(u.id)}
                          aria-label={`تحديد ${u.name}`}
                        />
                      </td>
                      <td>{u.name}</td>
                      <td dir="ltr" style={{ fontSize: '0.88rem' }}>
                        {u.email}
                      </td>
                      <td>{roleLabel(u.role)}</td>
                      <td>{u.active ? 'نشط' : 'مجمّد'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p> : null}
      {okMsg ? <p style={{ color: 'var(--success)', marginTop: '0.75rem' }}>{okMsg}</p> : null}

      <div style={{ marginTop: '1rem' }}>
        <button type="button" className="btn btn-primary" disabled={sending || loading} onClick={() => void submit()}>
          {sending ? 'جاري الإرسال…' : 'إرسال'}
        </button>
      </div>
    </>
  )
}
