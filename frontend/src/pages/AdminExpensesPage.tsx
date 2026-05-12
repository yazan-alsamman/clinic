import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type ExpenseCategory = 'laser' | 'dermatology' | 'skin' | 'solarium' | 'dental' | 'general'

type ExpenseEntry = {
  id: string
  category: ExpenseCategory
  reason: string
  amountSyp: number
  businessDate: string
  createdAt?: string
}

const CATEGORY_META: { key: ExpenseCategory; title: string }[] = [
  { key: 'laser', title: 'مصاريف الليزر' },
  { key: 'dermatology', title: 'مصاريف الجلدية' },
  { key: 'skin', title: 'مصاريف العناية بالبشرة' },
  { key: 'solarium', title: 'مصاريف السولاريوم' },
  { key: 'dental', title: 'مصاريف الأسنان' },
  { key: 'general', title: 'مصاريف عامة' },
]

function monthStartYmd(businessDate: string) {
  const d = String(businessDate || '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d.slice(0, 7)}-01`
  const x = new Date()
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(Math.round(n || 0))} ل.س`
}

export function AdminExpensesPage() {
  const { user } = useAuth()
  const { businessDate } = useClinic()
  const allowed = user?.role === 'super_admin'

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState<ExpenseEntry[]>([])

  const [draftByCat, setDraftByCat] = useState<
    Record<ExpenseCategory, { reason: string; amount: string; businessDate: string }>
  >(() =>
    Object.fromEntries(
      CATEGORY_META.map(({ key }) => [
        key,
        { reason: '', amount: '', businessDate: businessDate || '' },
      ]),
    ) as Record<ExpenseCategory, { reason: string; amount: string; businessDate: string }>,
  )

  const [editing, setEditing] = useState<ExpenseEntry | null>(null)

  useEffect(() => {
    if (!from && businessDate) setFrom(monthStartYmd(businessDate))
    if (!to && businessDate) setTo(businessDate)
  }, [businessDate, from, to])

  useEffect(() => {
    if (!allowed || !businessDate) return
    setDraftByCat((prev) => {
      const next = { ...prev }
      for (const { key } of CATEGORY_META) {
        if (!next[key]?.businessDate) next[key] = { ...next[key], businessDate: businessDate }
      }
      return next
    })
  }, [allowed, businessDate])

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!allowed || !from || !to) return
      const silent = Boolean(opts?.silent)
      if (!silent) {
        setLoading(true)
        setErr('')
      }
      try {
        const data = await api<{ entries: ExpenseEntry[] }>(
          `/api/finance/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        )
        setEntries(data.entries || [])
        if (!silent) setErr('')
      } catch (e) {
        if (!silent) {
          setEntries([])
          setErr(e instanceof ApiError ? e.message : 'تعذر تحميل المصاريف')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [allowed, from, to],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!allowed) return
    const id = window.setInterval(() => void load({ silent: true }), 8000)
    return () => window.clearInterval(id)
  }, [allowed, load])

  useEffect(() => {
    if (!allowed) return
    const onVis = () => {
      if (document.visibilityState === 'visible') void load({ silent: true })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [allowed, load])

  const byCategory = useMemo(() => {
    const m: Record<string, ExpenseEntry[]> = {}
    for (const c of CATEGORY_META.map((x) => x.key)) m[c] = []
    for (const e of entries) {
      if (!m[e.category]) m[e.category] = []
      m[e.category].push(e)
    }
    return m
  }, [entries])

  const totalFor = (cat: ExpenseCategory) =>
    Math.round((byCategory[cat] || []).reduce((a, r) => a + (Number(r.amountSyp) || 0), 0))

  const saveEdit = async () => {
    if (!editing) return
    try {
      await api(`/api/finance/expenses/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          reason: editing.reason,
          amountSyp: Math.round(Number(editing.amountSyp) || 0),
          businessDate: editing.businessDate,
        }),
      })
      setEditing(null)
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر الحفظ')
    }
  }

  const addRow = async (cat: ExpenseCategory) => {
    const d = draftByCat[cat]
    const reason = String(d.reason || '').trim()
    const amountSyp = Math.round(Number(d.amount))
    if (!reason) {
      setErr('أدخل سبب المصروف')
      return
    }
    if (!Number.isFinite(amountSyp) || amountSyp < 0) {
      setErr('المبلغ غير صالح')
      return
    }
    try {
      await api('/api/finance/expenses', {
        method: 'POST',
        body: JSON.stringify({
          category: cat,
          reason,
          amountSyp,
          businessDate: d.businessDate || businessDate,
        }),
      })
      setDraftByCat((prev) => ({
        ...prev,
        [cat]: { reason: '', amount: '', businessDate: businessDate || prev[cat].businessDate },
      }))
      setErr('')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر الإضافة')
    }
  }

  const del = async (id: string) => {
    if (!window.confirm('حذف هذا السطر؟')) return
    try {
      await api(`/api/finance/expenses/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر الحذف')
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">المصاريف</h1>
        <p className="page-desc">هذه الصفحة متاحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">المصاريف</h1>
      <p className="page-desc">
        سجلات مصاريف الأقسام الستة. تُحدَّث القيم تلقائياً مع التحصيل والتعديلات. المبالغ بالليرة السورية.
      </p>

      <div className="toolbar" style={{ marginTop: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <span>من</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <span>إلى</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load({})}>
          {loading ? 'جاري التحديث…' : 'تحديث'}
        </button>
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p> : null}

      {editing ? (
        <div className="card" style={{ marginTop: '1rem', borderColor: 'var(--accent)' }}>
          <h3 style={{ marginTop: 0 }}>تعديل مصروف</h3>
          <div style={{ display: 'grid', gap: '0.5rem', maxWidth: 520 }}>
            <label>
              السبب
              <input
                className="input"
                style={{ width: '100%' }}
                value={editing.reason}
                onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
              />
            </label>
            <label>
              المبلغ (ل.س)
              <input
                className="input"
                type="number"
                min={0}
                style={{ width: '100%' }}
                value={editing.amountSyp}
                onChange={(e) => setEditing({ ...editing, amountSyp: Number(e.target.value) })}
              />
            </label>
            <label>
              التاريخ
              <input
                className="input"
                type="date"
                value={editing.businessDate}
                onChange={(e) => setEditing({ ...editing, businessDate: e.target.value })}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn" onClick={() => void saveEdit()}>
                حفظ
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '1.25rem', display: 'grid', gap: '1.25rem' }}>
        {CATEGORY_META.map(({ key, title }) => (
          <section key={key} className="card" style={{ overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h2>
              <div style={{ fontWeight: 800, color: 'var(--accent-strong, #0d9488)' }}>
                الإجمالي: {fmtSyp(totalFor(key))}
              </div>
            </div>

            <table className="table" style={{ marginTop: '0.75rem', minWidth: 480 }}>
              <thead>
                <tr>
                  <th>سبب المصروف</th>
                  <th>المبلغ</th>
                  <th>التاريخ</th>
                  <th style={{ width: 140 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {(byCategory[key] || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                      لا توجد سجلات في النطاق.
                    </td>
                  </tr>
                ) : (
                  (byCategory[key] || []).map((row) => (
                    <tr key={row.id}>
                      <td>{row.reason}</td>
                      <td>{fmtSyp(row.amountSyp)}</td>
                      <td>{row.businessDate}</td>
                      <td>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setEditing(row)}>
                          تعديل
                        </button>{' '}
                        <button type="button" className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => void del(row.id)}>
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div
              style={{
                marginTop: '0.85rem',
                paddingTop: '0.85rem',
                borderTop: '1px solid var(--border, #e5e7eb)',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '0.5rem',
                alignItems: 'end',
              }}
            >
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>سبب جديد</span>
                <input
                  className="input"
                  value={draftByCat[key].reason}
                  onChange={(e) =>
                    setDraftByCat((p) => ({ ...p, [key]: { ...p[key], reason: e.target.value } }))
                  }
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>مبلغ (ل.س)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={draftByCat[key].amount}
                  onChange={(e) =>
                    setDraftByCat((p) => ({ ...p, [key]: { ...p[key], amount: e.target.value } }))
                  }
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>التاريخ</span>
                <input
                  className="input"
                  type="date"
                  value={draftByCat[key].businessDate}
                  onChange={(e) =>
                    setDraftByCat((p) => ({ ...p, [key]: { ...p[key], businessDate: e.target.value } }))
                  }
                />
              </label>
              <button type="button" className="btn" onClick={() => void addRow(key)}>
                إضافة
              </button>
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
