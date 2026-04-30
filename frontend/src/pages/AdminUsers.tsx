import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { roleLabel } from '../data/nav'
import type { Role } from '../types'

const ROLES: Role[] = [
  'super_admin',
  'reception',
  'laser',
  'dermatology',
  'dermatology_manager',
  'dermatology_assistant_manager',
  'dental_branch',
  'solarium',
  'skin_specialist',
]

type Row = {
  id: string
  email: string
  name: string
  role: Role
  active: boolean
  doctorSharePercent?: number
}

const emptyCreate = {
  email: '',
  password: '',
  name: '',
  role: 'reception' as Role,
}

export function AdminUsers() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [freezeOpen, setFreezeOpen] = useState<Row | null>(null)
  const [freezeConfirm, setFreezeConfirm] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [editOpen, setEditOpen] = useState<Row | null>(null)
  const [editForm, setEditForm] = useState({
    email: '',
    name: '',
    role: 'reception' as Role,
    password: '',
    doctorSharePercent: '0',
  })
  const [formErr, setFormErr] = useState('')
  const [freezeErr, setFreezeErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const data = await api<{ users: Row[] }>('/api/users')
      setUsers(data.users)
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const clinicalRole = (r: Role) =>
    r === 'laser' ||
    r === 'dermatology' ||
    r === 'dermatology_manager' ||
    r === 'dermatology_assistant_manager' ||
    r === 'dental_branch' ||
    r === 'solarium' ||
    r === 'skin_specialist'

  function openEdit(u: Row) {
    setFormErr('')
    setEditOpen(u)
    setEditForm({
      email: u.email,
      name: u.name,
      role: u.role,
      password: '',
      doctorSharePercent: String(u.doctorSharePercent ?? 0),
    })
  }

  const canFreeze = (u: Row) => u.active && u.id !== me?.id
  const freezeCanSubmit = freezeConfirm.trim().toUpperCase() === 'FREEZE'

  return (
    <>
      <h1 className="page-title">المستخدمون</h1>
      <p className="page-desc">إنشاء، تعديل، تجميد — مع تأكيد صريح على التجميد</p>
      <div className="toolbar">
        <button type="button" className="btn btn-primary" onClick={() => {
          setFormErr('')
          setCreateForm(emptyCreate)
          setCreateOpen(true)
        }}>
          مستخدم جديد
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>البريد</th>
              <th>الدور</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5}>جاري التحميل…</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{u.email}</td>
                  <td>{roleLabel(u.role)}</td>
                  <td>
                    <span
                      className="chip"
                      style={
                        !u.active
                          ? { background: 'var(--danger-bg)', color: 'var(--danger)' }
                          : {}
                      }
                    >
                      {!u.active ? 'مجمّد' : 'نشط'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.8rem' }}
                      onClick={() => openEdit(u)}
                    >
                      تعديل
                    </button>
                    {u.active ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem' }}
                        onClick={() => {
                          setFreezeErr('')
                          setFreezeConfirm('')
                          setFreezeOpen(u)
                        }}
                        disabled={!canFreeze(u)}
                        title={u.id === me?.id ? 'لا يمكنك تجميد حسابك الحالي' : ''}
                      >
                        تجميد
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem' }}
                        disabled={saving}
                        onClick={async () => {
                          setSaving(true)
                          try {
                            await api(`/api/users/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ active: true }),
                            })
                            await load()
                          } finally {
                            setSaving(false)
                          }
                        }}
                      >
                        إلغاء التجميد
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal" style={{ maxWidth: 420 }}>
            <h3>مستخدم جديد</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              أدخل البيانات الأساسية. يستطيع المستخدم تسجيل الدخول فوراً إن كان الحساب نشطاً.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
              <div>
                <label className="form-label" htmlFor="nu-name">الاسم الكامل</label>
                <input
                  id="nu-name"
                  className="input"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="nu-email">البريد</label>
                <input
                  id="nu-email"
                  className="input"
                  type="email"
                  dir="ltr"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="nu-pass">كلمة المرور</label>
                <input
                  id="nu-pass"
                  className="input"
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="nu-role">الدور</label>
                <select
                  id="nu-role"
                  className="select"
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, role: e.target.value as Role }))
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              {formErr ? (
                <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{formErr}</p>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreateOpen(false)}
                disabled={saving}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  setFormErr('')
                  if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
                    setFormErr('املأ الاسم والبريد وكلمة المرور')
                    return
                  }
                  if (createForm.password.length < 6) {
                    setFormErr('كلمة المرور 6 أحرف على الأقل')
                    return
                  }
                  setSaving(true)
                  try {
                    await api('/api/users', {
                      method: 'POST',
                      body: JSON.stringify({
                        name: createForm.name.trim(),
                        email: createForm.email.trim(),
                        password: createForm.password,
                        role: createForm.role,
                      }),
                    })
                    setCreateOpen(false)
                    setCreateForm(emptyCreate)
                    await load()
                  } catch (e) {
                    setFormErr(e instanceof ApiError ? e.message : 'فشل الإنشاء')
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'جاري الحفظ…' : 'إنشاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal" style={{ maxWidth: 420 }}>
            <h3>تعديل مستخدم</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {editOpen.name} — اترك كلمة المرور فارغة إن لم ترد تغييرها.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
              <div>
                <label className="form-label" htmlFor="eu-name">الاسم</label>
                <input
                  id="eu-name"
                  className="input"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="eu-email">البريد</label>
                <input
                  id="eu-email"
                  className="input"
                  type="email"
                  dir="ltr"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="eu-role">الدور</label>
                <select
                  id="eu-role"
                  className="select"
                  value={editForm.role}
                  disabled={editOpen.id === me?.id}
                  title={editOpen.id === me?.id ? 'لا يمكن تغيير دورك الحالي من هنا' : undefined}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, role: e.target.value as Role }))
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="eu-pass">كلمة مرور جديدة (اختياري)</label>
                <input
                  id="eu-pass"
                  className="input"
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                />
              </div>
              {clinicalRole(editForm.role) ? (
                <div>
                  <label className="form-label" htmlFor="eu-dsp">
                    نسبة الاستحقاق من صافي الإجراء (0–100%)
                  </label>
                  <input
                    id="eu-dsp"
                    className="input"
                    inputMode="numeric"
                    dir="ltr"
                    value={editForm.doctorSharePercent}
                    onChange={(e) => setEditForm((f) => ({ ...f, doctorSharePercent: e.target.value }))}
                  />
                </div>
              ) : null}
              {formErr ? (
                <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{formErr}</p>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditOpen(null)}
                disabled={saving}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  setFormErr('')
                  if (!editForm.name.trim() || !editForm.email.trim()) {
                    setFormErr('الاسم والبريد مطلوبان')
                    return
                  }
                  if (editForm.password && editForm.password.length < 6) {
                    setFormErr('كلمة المرور 6 أحرف على الأقل')
                    return
                  }
                  setSaving(true)
                  try {
                    const body: Record<string, unknown> = {
                      name: editForm.name.trim(),
                      email: editForm.email.trim(),
                      role: editForm.role,
                    }
                    if (editForm.password) body.password = editForm.password
                    if (clinicalRole(editForm.role)) {
                      const dsp = Number(editForm.doctorSharePercent)
                      if (!Number.isFinite(dsp) || dsp < 0 || dsp > 100) {
                        setFormErr('نسبة الاستحقاق بين 0 و 100')
                        setSaving(false)
                        return
                      }
                      body.doctorSharePercent = dsp
                    } else {
                      body.doctorSharePercent = 0
                    }
                    await api(`/api/users/${editOpen.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify(body),
                    })
                    setEditOpen(null)
                    await load()
                  } catch (e) {
                    setFormErr(e instanceof ApiError ? e.message : 'فشل الحفظ')
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'جاري الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {freezeOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>تجميد المستخدم</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              المستخدم: <strong>{freezeOpen.name}</strong> ({freezeOpen.email})
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              لن يتمكن من تسجيل الدخول حتى يتم إلغاء التجميد. للمتابعة اكتب{' '}
              <strong>FREEZE</strong> بالإنجليزية.
            </p>
            <input
              className="input"
              placeholder="FREEZE"
              value={freezeConfirm}
              onChange={(e) => setFreezeConfirm(e.target.value)}
              autoComplete="off"
              dir="ltr"
            />
            {freezeErr ? (
              <p style={{ margin: '0.5rem 0 0', color: 'var(--danger)', fontSize: '0.85rem' }}>{freezeErr}</p>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setFreezeOpen(null)
                  setFreezeConfirm('')
                  setFreezeErr('')
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!freezeCanSubmit || saving}
                onClick={async () => {
                  setFreezeErr('')
                  setSaving(true)
                  try {
                    await api(`/api/users/${freezeOpen.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ active: false }),
                    })
                    setFreezeOpen(null)
                    setFreezeConfirm('')
                    await load()
                  } catch (e) {
                    setFreezeErr(e instanceof ApiError ? e.message : 'فشل التجميد')
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                تأكيد التجميد
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
