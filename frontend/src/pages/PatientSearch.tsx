import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { Patient } from '../types'

type Dept = 'laser' | 'dermatology' | 'dental' | 'solarium'

const emptyForm = {
  fileNumber: '',
  name: '',
  dob: '',
  phone: '',
  gender: '' as '' | 'male' | 'female',
  marital: '',
  occupation: '',
  medicalHistory: '',
  surgicalHistory: '',
  allergies: '',
  departments: [] as Dept[],
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return (p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')
}

function canRegisterPatients(role: string | undefined) {
  return role === 'super_admin' || role === 'reception'
}

const PAGE_SIZE = 10

/** أرقام صفحات مع فجوات عند الحاجة (مثال: 1 … 5 6 7 … 20) */
function pageNumbersForDisplay(current: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 0) return []
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const out: (number | 'ellipsis')[] = []
  const edge = 1
  const windowSize = 2
  const push = (n: number | 'ellipsis') => {
    if (out.length && out[out.length - 1] === n) return
    out.push(n)
  }
  for (let p = 1; p <= totalPages; p++) {
    if (
      p <= edge ||
      p > totalPages - edge ||
      (p >= current - windowSize && p <= current + windowSize)
    ) {
      if (out.length && typeof out[out.length - 1] === 'number' && p - (out[out.length - 1] as number) > 1) {
        push('ellipsis')
      }
      push(p)
    }
  }
  return out
}

export function PatientSearch() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<Patient[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formErr, setFormErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [portalCreds, setPortalCreds] = useState<{ username: string; password: string } | null>(null)
  const [createdPatientId, setCreatedPatientId] = useState<string | null>(null)

  const allowAdd = canRegisterPatients(user?.role)

  useEffect(() => {
    if (!q.trim()) {
      setDebouncedQ('')
      return
    }
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => window.clearTimeout(t)
  }, [q])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
        if (debouncedQ) params.set('q', debouncedQ)
        const data = await api<{
          patients: Patient[]
          total: number
          totalPages: number
        }>(`/api/patients?${params.toString()}`)
        const rows = Array.isArray(data.patients) ? data.patients : []
        const tot = Number(data.total || 0)
        const tp = Number(data.totalPages || 0)
        if (cancelled) return
        if (tp >= 1 && page > tp) {
          setPage(tp)
          return
        }
        setList(rows)
        setTotal(tot)
        setTotalPages(tp)
      } catch {
        if (!cancelled) {
          setList([])
          setTotal(0)
          setTotalPages(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedQ, page])

  const filtered = useMemo(() => list, [list])
  const searchActive = debouncedQ.length > 0
  const pageButtons = useMemo(() => pageNumbersForDisplay(page, totalPages), [page, totalPages])

  function toggleDept(d: Dept) {
    setForm((f) => ({
      ...f,
      departments: f.departments.includes(d)
        ? f.departments.filter((x) => x !== d)
        : [...f.departments, d],
    }))
  }

  function openAddModal() {
    setFormErr('')
    setForm({ ...emptyForm, name: q.trim() })
    setAddOpen(true)
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.5rem',
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
            المرضى
          </h1>
          <p className="page-desc" style={{ margin: 0 }}>
            قائمة بالصفحات (١٠ مرضى لكل صفحة). اكتب اسماً أو رقم إضبارة لتضييق النتائج — يدعم العربية واللاتينية.
          </p>
        </div>
        {allowAdd ? (
          <button type="button" className="btn btn-primary" onClick={openAddModal}>
            إضافة مريض
          </button>
        ) : (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
            إضافة المرضى متاحة للاستقبال والمدير فقط
          </span>
        )}
      </div>

      <div className="card search-hero">
        <label className="form-label" htmlFor="patient-q">
          اسم المريض
        </label>
        <input
          id="patient-q"
          className="input"
          placeholder="ابحث بالاسم..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.5rem' }}>
          <span>النتائج</span>
          {!loading ? (
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              إجمالي المرضى:{' '}
              <strong style={{ color: 'var(--text)' }}>{total.toLocaleString('ar-SY')}</strong>
              {totalPages > 1 ? (
                <>
                  {' '}
                  — الصفحة {page.toLocaleString('ar-SY')} من {totalPages.toLocaleString('ar-SY')}
                </>
              ) : null}
            </span>
          ) : null}
        </h2>
        {loading ? (
          <div className="empty-state">جاري التحميل…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            {searchActive ? (
              <>لا يوجد مريض مطابق لبحثك</>
            ) : (
              <>لا يوجد مرضى مسجّلون في النظام بعد</>
            )}
            {allowAdd ? (
              <div style={{ marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={openAddModal}>
                  تسجيل مريض جديد
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            {filtered.map((p) => (
              <Link key={p.id} to={`/patients/${p.id}`} className="patient-row">
                <div className="patient-avatar">{initials(p.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  رقم الإضبارة: {p.fileNumber || '—'} ·
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    الميلاد: {p.dob || '—'} · آخر زيارة: {p.lastVisit || '—'}
                  </div>
                  <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {p.departments.includes('laser') && (
                      <span className="chip chip-laser">ليزر</span>
                    )}
                    {p.departments.includes('dermatology') && (
                      <span className="chip chip-derm">جلدية</span>
                    )}
                    {p.departments.includes('dental') && (
                      <span className="chip chip-dental">أسنان</span>
                    )}
                    {p.departments.includes('solarium') && (
                      <span className="chip">سولاريوم</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
            {totalPages > 1 ? (
              <nav
                aria-label="ترقيم صفحات المرضى"
                style={{
                  marginTop: '1rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem' }}
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  السابق
                </button>
                {pageButtons.map((item, idx) =>
                  item === 'ellipsis' ? (
                    <span key={`e-${idx}`} style={{ padding: '0 0.2rem', color: 'var(--text-muted)' }}>
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={item === page ? 'btn btn-primary' : 'btn btn-ghost'}
                      style={{ minWidth: 40, fontSize: '0.82rem' }}
                      disabled={loading}
                      onClick={() => setPage(item)}
                      aria-current={item === page ? 'page' : undefined}
                    >
                      {item.toLocaleString('ar-SY')}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem' }}
                  disabled={page >= totalPages || loading || totalPages === 0}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  التالي
                </button>
              </nav>
            ) : null}
          </div>
        )}
      </div>

      {portalCreds && createdPatientId ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>بيانات دخول البوابة</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.55 }}>
              تم إنشاء حساب للمريض في بوابة المريض. انسخ البيانات الآن — لن تُعرض كلمة المرور مرة أخرى بهذا
              الشكل. يمكن لاحقاً إعادة إنشائها من تبويب «الحساب» في ملف المريض.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
              <div>
                <span className="form-label">اسم المستخدم</span>
                <div
                  dir="ltr"
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius-sm)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {portalCreds.username}
                </div>
              </div>
              <div>
                <span className="form-label">كلمة المرور</span>
                <div
                  dir="ltr"
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'monospace',
                  }}
                >
                  {portalCreds.password}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `اسم المستخدم: ${portalCreds.username}\nكلمة المرور: ${portalCreds.password}`,
                  )
                }}
              >
                نسخ الكل
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPortalCreds(null)
                  navigate(`/patients/${createdPatientId}`)
                  setCreatedPatientId(null)
                }}
              >
                فتح ملف المريض
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addOpen && allowAdd && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div
            className="modal"
            style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
          >
            <h3 style={{ marginTop: 0 }}>إضافة مريض</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              البطاقة العامة — يمكن لاحقاً ربط الأقسام عند أول زيارة.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div>
                <label className="form-label" htmlFor="np-file-number">
                  رقم الإضبارة <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  id="np-file-number"
                  className="input"
                  value={form.fileNumber}
                  onChange={(e) => setForm((f) => ({ ...f, fileNumber: e.target.value }))}
                  placeholder="مثال: D-000123"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="np-name">
                  الاسم الكامل <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  id="np-name"
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  autoComplete="name"
                />
              </div>
              <div className="grid-2" style={{ gap: '0.75rem' }}>
                <div>
                  <label className="form-label" htmlFor="np-dob">
                    تاريخ الميلاد
                  </label>
                  <input
                    id="np-dob"
                    className="input"
                    type="date"
                    value={form.dob}
                    onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="np-phone">
                    الهاتف
                  </label>
                  <input
                    id="np-phone"
                    className="input"
                    dir="ltr"
                    placeholder="+963..."
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="np-gender">
                    الجنس
                  </label>
                  <select
                    id="np-gender"
                    className="input"
                    value={form.gender}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        gender: e.target.value as '' | 'male' | 'female',
                      }))
                    }
                  >
                    <option value="">غير محدد</option>
                    <option value="male">ذكر</option>
                    <option value="female">أنثى</option>
                  </select>
                </div>
              </div>
              <div className="grid-2" style={{ gap: '0.75rem' }}>
                <div>
                  <label className="form-label" htmlFor="np-marital">
                    الحالة الاجتماعية
                  </label>
                  <input
                    id="np-marital"
                    className="input"
                    placeholder="مثال: متزوج / عزباء"
                    value={form.marital}
                    onChange={(e) => setForm((f) => ({ ...f, marital: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="np-job">
                    المهنة
                  </label>
                  <input
                    id="np-job"
                    className="input"
                    value={form.occupation}
                    onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="np-med">
                  سوابق مرضية
                </label>
                <textarea
                  id="np-med"
                  className="textarea"
                  rows={2}
                  value={form.medicalHistory}
                  onChange={(e) => setForm((f) => ({ ...f, medicalHistory: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="np-surg">
                  سوابق جراحية
                </label>
                <textarea
                  id="np-surg"
                  className="textarea"
                  rows={2}
                  value={form.surgicalHistory}
                  onChange={(e) => setForm((f) => ({ ...f, surgicalHistory: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="np-all">
                  تحسس
                </label>
                <textarea
                  id="np-all"
                  className="textarea"
                  rows={2}
                  value={form.allergies}
                  onChange={(e) => setForm((f) => ({ ...f, allergies: e.target.value }))}
                />
              </div>
              <div>
                <span className="form-label">أقسام مبدئية (اختياري)</span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                  {(
                    [
                      { key: 'laser' as const, label: 'ليزر', cls: 'chip-laser' },
                      { key: 'dermatology' as const, label: 'جلدية', cls: 'chip-derm' },
                      { key: 'dental' as const, label: 'أسنان', cls: 'chip-dental' },
                      { key: 'solarium' as const, label: 'سولاريوم', cls: 'chip' },
                    ] as const
                  ).map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      className={`chip ${d.cls}`}
                      style={{
                        cursor: 'pointer',
                        border: form.departments.includes(d.key) ? undefined : '1px solid var(--border)',
                        opacity: form.departments.includes(d.key) ? 1 : 0.55,
                        filter: form.departments.includes(d.key) ? undefined : 'grayscale(0.35)',
                      }}
                      onClick={() => toggleDept(d.key)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              {formErr ? (
                <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{formErr}</p>
              ) : null}
            </div>
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginTop: '1.25rem',
                justifyContent: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => setAddOpen(false)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  setFormErr('')
                  const name = form.name.trim()
                  const fileNumber = form.fileNumber.trim()
                  if (!fileNumber) {
                    setFormErr('رقم الإضبارة مطلوب')
                    return
                  }
                  if (!name) {
                    setFormErr('الاسم مطلوب')
                    return
                  }
                  setSaving(true)
                  try {
                    const data = await api<{
                      patient: Patient
                      portalCredentials?: { username: string; password: string }
                    }>('/api/patients', {
                      method: 'POST',
                      body: JSON.stringify({
                        fileNumber,
                        name,
                        dob: form.dob,
                        phone: form.phone.trim(),
                        gender: form.gender,
                        marital: form.marital.trim(),
                        occupation: form.occupation.trim(),
                        medicalHistory: form.medicalHistory.trim(),
                        surgicalHistory: form.surgicalHistory.trim(),
                        allergies: form.allergies.trim(),
                        departments: form.departments,
                      }),
                    })
                    setAddOpen(false)
                    setForm(emptyForm)
                    setQ('')
                    setDebouncedQ('')
                    setPage(1)
                    if (data.portalCredentials) {
                      setPortalCreds(data.portalCredentials)
                      setCreatedPatientId(data.patient.id)
                    } else {
                      navigate(`/patients/${data.patient.id}`)
                    }
                  } catch (e) {
                    setFormErr(e instanceof ApiError ? e.message : 'تعذر الحفظ')
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? 'جاري الحفظ…' : 'حفظ وفتح الملف'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
