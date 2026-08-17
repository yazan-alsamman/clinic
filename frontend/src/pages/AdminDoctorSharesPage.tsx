import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { roleLabel } from '../data/nav'
import type { Role } from '../types'

type ShareDoctor = {
  id: string
  name: string
  role: Role
  active: boolean
  sharePercent: number
}

type VirtualProvider = {
  key: string
  name: string
  sharePercent: number
}

type ShareDepartment = {
  key: string
  defaultPercent: number
  doctors: ShareDoctor[]
  virtualProviders: VirtualProvider[]
}

type Payload = {
  departments: ShareDepartment[]
}

const DEPT_LABEL: Record<string, string> = {
  dental: 'قسم الأسنان',
  dermatology: 'قسم الجلدية',
  laser: 'قسم الليزر',
  skin: 'قسم العناية بالبشرة',
  solarium: 'السولاريوم',
}

const DEPT_HINT: Record<string, string> = {
  dental: 'حصة الطبيب من تكلفة إجراءاته. نسبة 0 تعني أن المبلغ بالكامل للقسم بعد خصم المخابر.',
  dermatology: 'حصة الطبيب من صافي الجلسة بعد خصم المواد.',
  laser: 'تُستخدم عند ترحيل جلسات الليزر في المحاسبة.',
  skin: 'النسبة الافتراضية لأي حساب مرتبط بهذا القسم لاحقاً.',
  solarium: 'النسبة الافتراضية لأي حساب مرتبط بهذا القسم لاحقاً.',
}

function parsePercent(raw: string): number | null {
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n)
}

export function AdminDoctorSharesPage() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [departments, setDepartments] = useState<ShareDepartment[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState('')

  const applyPayload = useCallback((payload: Payload) => {
    const next: ShareDepartment[] = payload.departments || []
    setDepartments(next)
    const map: Record<string, string> = {}
    for (const d of next) {
      map[`dept:${d.key}`] = String(d.defaultPercent ?? 0)
      for (const doc of d.doctors || []) map[`user:${doc.id}`] = String(doc.sharePercent ?? 0)
      for (const v of d.virtualProviders || []) map[`virtual:${v.key}`] = String(v.sharePercent ?? 0)
    }
    setDrafts(map)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await api<Payload>('/api/admin/doctor-shares')
      applyPayload(data)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر تحميل النسب')
    } finally {
      setLoading(false)
    }
  }, [applyPayload])

  useEffect(() => {
    if (allowed) void load()
  }, [allowed, load])

  function setDraft(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }))
  }

  async function runSave(key: string, fn: () => Promise<Payload>) {
    const pct = parsePercent(drafts[key] ?? '')
    if (pct == null) {
      setErr('النسبة يجب أن تكون رقماً بين 0 و 100')
      return
    }
    setSavingKey(key)
    setErr('')
    setOkMsg('')
    try {
      const data = await fn()
      applyPayload(data)
      setOkMsg('تم حفظ النسبة.')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر الحفظ')
    } finally {
      setSavingKey('')
    }
  }

  async function saveDefault(department: string) {
    const key = `dept:${department}`
    await runSave(key, () =>
      api<Payload>(`/api/admin/doctor-shares/defaults/${department}`, {
        method: 'PATCH',
        body: JSON.stringify({ sharePercent: parsePercent(drafts[key] ?? '') }),
      }),
    )
  }

  async function saveVirtual(virtualKey: string) {
    const key = `virtual:${virtualKey}`
    await runSave(key, () =>
      api<Payload>(`/api/admin/doctor-shares/virtual/${virtualKey}`, {
        method: 'PATCH',
        body: JSON.stringify({ sharePercent: parsePercent(drafts[key] ?? '') }),
      }),
    )
  }

  async function saveDoctor(id: string) {
    const key = `user:${id}`
    await runSave(key, () =>
      api<Payload>(`/api/admin/doctor-shares/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sharePercent: parsePercent(drafts[key] ?? '') }),
      }),
    )
  }

  async function applyDefaultToDoctors(department: string) {
    const label = DEPT_LABEL[department] || department
    if (!window.confirm(`تعيين النسبة الافتراضية لكل أطباء «${label}»؟`)) return
    setSavingKey(`apply:${department}`)
    setErr('')
    setOkMsg('')
    try {
      const data = await api<Payload & { usersUpdated?: number }>('/api/admin/doctor-shares/apply-default', {
        method: 'POST',
        body: JSON.stringify({ department }),
      })
      applyPayload(data)
      setOkMsg(`تم تطبيق النسبة على ${data.usersUpdated ?? 0} حساباً.`)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر التطبيق')
    } finally {
      setSavingKey('')
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">نسب الأطباء</h1>
        <p className="page-desc">هذه الصفحة مخصصة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">نسب الأطباء</h1>
      <p className="page-desc">
        تغيير نسبة كل طبيب في قسمه، والنسبة الافتراضية للقسم، وأي نسبة أخرى مستخدمة في المالية (مثل د. الياس). التغيير
        ينعكس فوراً على لوحات المالية وحصص التحصيل.
      </p>

      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}
      {okMsg ? <p style={{ color: 'var(--success, #047857)' }}>{okMsg}</p> : null}

      {loading && departments.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
      ) : (
        departments.map((dept) => (
          <section key={dept.key} className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{DEPT_LABEL[dept.key] || dept.key}</h2>
            <p className="page-desc" style={{ margin: '0 0 0.85rem' }}>
              {DEPT_HINT[dept.key] || 'يمكن تغيير النسبة الافتراضية ونسب الأطباء المرتبطين بالقسم.'}
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.65rem',
                alignItems: 'end',
                marginBottom: '0.85rem',
              }}
            >
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span className="form-label">النسبة الافتراضية %</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="numeric"
                  style={{ width: 110 }}
                  value={drafts[`dept:${dept.key}`] ?? ''}
                  onChange={(e) => setDraft(`dept:${dept.key}`, e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={Boolean(savingKey)}
                onClick={() => void saveDefault(dept.key)}
              >
                {savingKey === `dept:${dept.key}` ? 'جاري الحفظ…' : 'حفظ الافتراضي'}
              </button>
              {dept.doctors.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(savingKey)}
                  onClick={() => void applyDefaultToDoctors(dept.key)}
                >
                  {savingKey === `apply:${dept.key}` ? 'جاري التطبيق…' : 'تطبيق على كل أطباء القسم'}
                </button>
              ) : null}
            </div>

            {dept.virtualProviders.length > 0 || dept.doctors.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>الدور</th>
                      <th>الحالة</th>
                      <th>النسبة %</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dept.virtualProviders.map((v) => (
                      <tr key={`v-${v.key}`}>
                        <td>{v.name}</td>
                        <td>مقدّم ثابت</td>
                        <td>—</td>
                        <td>
                          <input
                            className="input"
                            dir="ltr"
                            inputMode="numeric"
                            style={{ width: 90 }}
                            value={drafts[`virtual:${v.key}`] ?? ''}
                            onChange={(e) => setDraft(`virtual:${v.key}`, e.target.value)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={Boolean(savingKey)}
                            onClick={() => void saveVirtual(v.key)}
                          >
                            {savingKey === `virtual:${v.key}` ? '…' : 'حفظ'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {dept.doctors.map((doc) => (
                      <tr key={doc.id} style={{ opacity: doc.active ? 1 : 0.65 }}>
                        <td>{doc.name}</td>
                        <td>{roleLabel(doc.role)}</td>
                        <td>{doc.active ? 'نشط' : 'مجمّد'}</td>
                        <td>
                          <input
                            className="input"
                            dir="ltr"
                            inputMode="numeric"
                            style={{ width: 90 }}
                            value={drafts[`user:${doc.id}`] ?? ''}
                            onChange={(e) => setDraft(`user:${doc.id}`, e.target.value)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={Boolean(savingKey)}
                            onClick={() => void saveDoctor(doc.id)}
                          >
                            {savingKey === `user:${doc.id}` ? '…' : 'حفظ'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                لا يوجد حسابات أطباء مربوطة بهذا القسم حالياً. يمكن حفظ النسبة الافتراضية أعلاه لتُستخدم عند إنشاء
                حساب جديد.
              </p>
            )}
          </section>
        ))
      )}
    </>
  )
}
