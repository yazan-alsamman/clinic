import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type ExpenseCategory = 'laser' | 'dermatology' | 'skin' | 'solarium' | 'dental' | 'general' | 'salaries'

type ExpenseEntry = {
  id: string
  category: ExpenseCategory
  reason: string
  amountSyp: number
  amountUsd: number
  usdSypRate: number
  effectiveAmountSyp: number
  businessDate: string
  createdAt?: string
}

type DraftRow = {
  reason: string
  amountSyp: string
  amountUsd: string
  businessDate: string
}

const CATEGORY_META: { key: ExpenseCategory; title: string; reasonPlaceholder?: string }[] = [
  { key: 'laser', title: 'مصاريف الليزر' },
  { key: 'dermatology', title: 'مصاريف الجلدية' },
  { key: 'skin', title: 'مصاريف العناية بالبشرة' },
  { key: 'solarium', title: 'مصاريف السولاريوم' },
  { key: 'dental', title: 'مصاريف الأسنان' },
  { key: 'general', title: 'مصاريف عامة' },
  { key: 'salaries', title: 'رواتب الموظفين', reasonPlaceholder: 'اسم الموظف / المسمى الوظيفي' },
]

function emptyDraft(businessDate: string): DraftRow {
  return { reason: '', amountSyp: '', amountUsd: '', businessDate: businessDate || '' }
}

function monthStartYmd(businessDate: string) {
  const d = String(businessDate || '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d.slice(0, 7)}-01`
  const x = new Date()
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(Math.round(n || 0))} ل.س`
}

function fmtUsd(n: number) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`
}

function formatAmountCell(row: ExpenseEntry) {
  const parts: string[] = []
  if (row.amountSyp > 0) parts.push(fmtSyp(row.amountSyp))
  if (row.amountUsd > 0) parts.push(fmtUsd(row.amountUsd))
  if (parts.length === 0) return '—'
  return parts.join(' + ')
}

export function AdminExpensesPage() {
  const { user } = useAuth()
  const { businessDate, usdSypRate } = useClinic()
  const allowed = user?.role === 'super_admin'

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState<ExpenseEntry[]>([])

  const [draftByCat, setDraftByCat] = useState<Record<ExpenseCategory, DraftRow>>(() =>
    Object.fromEntries(CATEGORY_META.map(({ key }) => [key, emptyDraft(businessDate || '')])) as Record<
      ExpenseCategory,
      DraftRow
    >,
  )

  const [editing, setEditing] = useState<ExpenseEntry | null>(null)
  const [editSyp, setEditSyp] = useState('')
  const [editUsd, setEditUsd] = useState('')

  useEffect(() => {
    if (!from && businessDate) setFrom(monthStartYmd(businessDate))
    if (!to && businessDate) setTo(businessDate)
  }, [businessDate, from, to])

  useEffect(() => {
    if (!allowed || !businessDate) return
    setDraftByCat((prev) => {
      const next = { ...prev }
      for (const { key } of CATEGORY_META) {
        if (!next[key]?.businessDate) next[key] = { ...next[key], businessDate }
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
        setEntries(
          (data.entries || []).map((e) => ({
            ...e,
            amountUsd: Number(e.amountUsd) || 0,
            usdSypRate: Number(e.usdSypRate) || 0,
            effectiveAmountSyp:
              Number(e.effectiveAmountSyp) ||
              Math.round(Number(e.amountSyp) || 0) +
                Math.round((Number(e.amountUsd) || 0) * (Number(e.usdSypRate) || 0)),
          })),
        )
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
    Math.round((byCategory[cat] || []).reduce((a, r) => a + (Number(r.effectiveAmountSyp) || 0), 0))

  const openEdit = (row: ExpenseEntry) => {
    setEditing(row)
    setEditSyp(row.amountSyp > 0 ? String(row.amountSyp) : '')
    setEditUsd(row.amountUsd > 0 ? String(row.amountUsd) : '')
  }

  const saveEdit = async () => {
    if (!editing) return
    const amountSyp = Math.round(Number(editSyp) || 0)
    const amountUsd = Math.round((Number(editUsd) || 0) * 100) / 100
    if (!(amountSyp > 0 || amountUsd > 0)) {
      setErr('أدخل مبلغاً بالليرة أو بالدولار على الأقل')
      return
    }
    try {
      await api(`/api/finance/expenses/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          reason: editing.reason,
          amountSyp,
          amountUsd,
          businessDate: editing.businessDate,
          usdSypRate: amountUsd > 0 ? usdSypRate || editing.usdSypRate || undefined : 0,
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
    const amountSyp = Math.round(Number(d.amountSyp) || 0)
    const amountUsd = Math.round((Number(d.amountUsd) || 0) * 100) / 100
    if (!reason) {
      setErr('أدخل سبب المصروف')
      return
    }
    if (!(amountSyp > 0 || amountUsd > 0)) {
      setErr('أدخل مبلغاً بالليرة أو بالدولار على الأقل')
      return
    }
    try {
      await api('/api/finance/expenses', {
        method: 'POST',
        body: JSON.stringify({
          category: cat,
          reason,
          amountSyp,
          amountUsd,
          businessDate: d.businessDate || businessDate,
          usdSypRate: amountUsd > 0 ? usdSypRate || undefined : 0,
        }),
      })
      setDraftByCat((prev) => ({
        ...prev,
        [cat]: emptyDraft(businessDate || prev[cat].businessDate),
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
        سجلات مصاريف الأقسام ورواتب الموظفين. يمكن إدخال المبلغ بالليرة السورية أو بالدولار (أو الاثنين معاً). دولار
        يُحوَّل للتقارير بسعر صرف يوم العمل
        {usdSypRate != null ? ` (حالياً ${usdSypRate.toLocaleString('ar-SY')} ل.س)` : ''}. بند «رواتب الموظفين»
        يُخصم من صافي أرباح المركز في لوحة المالية العامة.
      </p>

      <div
        className="toolbar"
        style={{ marginTop: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}
      >
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
                value={editSyp}
                onChange={(e) => setEditSyp(e.target.value)}
                placeholder="0"
              />
            </label>
            <label>
              المبلغ (USD)
              <input
                className="input"
                type="number"
                min={0}
                step={0.01}
                style={{ width: '100%' }}
                value={editUsd}
                onChange={(e) => setEditUsd(e.target.value)}
                placeholder="0.00"
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
        {CATEGORY_META.map(({ key, title, reasonPlaceholder }) => (
          <section key={key} className="card" style={{ overflow: 'auto' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h2>
              <div style={{ fontWeight: 800, color: 'var(--accent-strong, #0d9488)' }}>
                الإجمالي (مكافئ ل.س): {fmtSyp(totalFor(key))}
              </div>
            </div>

            <table className="table" style={{ marginTop: '0.75rem', minWidth: 560 }}>
              <thead>
                <tr>
                  <th>{key === 'salaries' ? 'الموظف / الوصف' : 'سبب المصروف'}</th>
                  <th>المبلغ</th>
                  <th>مكافئ ل.س</th>
                  <th>التاريخ</th>
                  <th style={{ width: 140 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {(byCategory[key] || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      لا توجد سجلات في النطاق.
                    </td>
                  </tr>
                ) : (
                  (byCategory[key] || []).map((row) => (
                    <tr key={row.id}>
                      <td>{row.reason}</td>
                      <td>
                        {formatAmountCell(row)}
                        {row.amountUsd > 0 && row.usdSypRate > 0 ? (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            سعر الصرف: {row.usdSypRate.toLocaleString('ar-SY')}
                          </div>
                        ) : null}
                      </td>
                      <td>{fmtSyp(row.effectiveAmountSyp)}</td>
                      <td>{row.businessDate}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.8rem' }}
                          onClick={() => openEdit(row)}
                        >
                          تعديل
                        </button>{' '}
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.8rem' }}
                          onClick={() => void del(row.id)}
                        >
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
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '0.5rem',
                alignItems: 'end',
              }}
            >
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>{key === 'salaries' ? 'موظف / وصف جديد' : 'سبب جديد'}</span>
                <input
                  className="input"
                  value={draftByCat[key].reason}
                  onChange={(e) =>
                    setDraftByCat((p) => ({ ...p, [key]: { ...p[key], reason: e.target.value } }))
                  }
                  placeholder={reasonPlaceholder || ''}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>مبلغ (ل.س)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={draftByCat[key].amountSyp}
                  onChange={(e) =>
                    setDraftByCat((p) => ({ ...p, [key]: { ...p[key], amountSyp: e.target.value } }))
                  }
                  placeholder="0"
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>مبلغ (USD)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.01}
                  value={draftByCat[key].amountUsd}
                  onChange={(e) =>
                    setDraftByCat((p) => ({ ...p, [key]: { ...p[key], amountUsd: e.target.value } }))
                  }
                  placeholder="0.00"
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
