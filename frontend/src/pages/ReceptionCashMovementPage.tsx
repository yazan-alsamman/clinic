import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../types'

type MovementKind = 'expense' | 'receipt'
type CashMovementRow = {
  id: string
  businessDate: string
  kind: MovementKind
  reason: string
  amountSyp: number
  amountUsd: number
  createdAt: string | null
}
type CashMovementPayload = { businessDate: string; rows: CashMovementRow[] }
type DraftRow = { rowId: string; reason: string; amountSyp: string; amountUsd: string; saving: boolean }

const ACCESS: Role[] = ['reception', 'super_admin']

function createDraftRow(): DraftRow {
  return {
    rowId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reason: '',
    amountSyp: '',
    amountUsd: '',
    saving: false,
  }
}

function formatSyp(n: number) {
  return `${Math.round(n).toLocaleString('ar-SY')} ل.س`
}

function formatUsd(n: number) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`
}

function formatCreatedAt(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ar-SY', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    })
  } catch {
    return '—'
  }
}

export function ReceptionCashMovementPage() {
  const { user } = useAuth()
  const allowed = user?.role && ACCESS.includes(user.role as Role)
  const [businessDate, setBusinessDate] = useState('')
  const [rows, setRows] = useState<CashMovementRow[]>([])
  const [expenseDrafts, setExpenseDrafts] = useState<DraftRow[]>([createDraftRow()])
  const [receiptDrafts, setReceiptDrafts] = useState<DraftRow[]>([createDraftRow()])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    setLoading(true)
    try {
      const data = await api<CashMovementPayload>('/api/billing/cash-movements')
      setRows(Array.isArray(data.rows) ? data.rows : [])
      setBusinessDate(String(data.businessDate || ''))
    } catch (e) {
      setRows([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل حركة الصندوق')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  const saveDraft = useCallback(
    async (kind: MovementKind, rowId: string) => {
      const setDrafts = kind === 'expense' ? setExpenseDrafts : setReceiptDrafts
      const sourceDrafts = kind === 'expense' ? expenseDrafts : receiptDrafts
      const row = sourceDrafts.find((r) => r.rowId === rowId)
      if (!row) return
      const payload = {
        reason: row.reason.trim(),
        amountSyp: Math.round(Number(row.amountSyp) || 0),
        amountUsd: Math.round((Number(row.amountUsd) || 0) * 100) / 100,
      }
      setDrafts((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, saving: true } : r)))
      if (!payload.reason) {
        setErr('يرجى إدخال السبب قبل الحفظ')
        setDrafts((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, saving: false } : r)))
        return
      }
      if (!(payload.amountSyp > 0 || payload.amountUsd > 0)) {
        setErr('يرجى إدخال مبلغ بالليرة أو بالدولار')
        setDrafts((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, saving: false } : r)))
        return
      }
      try {
        setErr('')
        await api('/api/billing/cash-movements', {
          method: 'POST',
          body: JSON.stringify({
            kind,
            reason: payload.reason,
            amountSyp: payload.amountSyp,
            amountUsd: payload.amountUsd,
          }),
        })
        setDrafts((prev) => {
          const next = prev.filter((r) => r.rowId !== rowId)
          return next.length ? next : [createDraftRow()]
        })
        await load()
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : 'تعذر حفظ الحركة')
        setDrafts((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, saving: false } : r)))
      }
    },
    [expenseDrafts, load, receiptDrafts],
  )

  const totals = useMemo(() => {
    const expense = { syp: 0, usd: 0 }
    const receipt = { syp: 0, usd: 0 }
    for (const r of rows) {
      if (r.kind === 'expense') {
        expense.syp += Math.round(Number(r.amountSyp) || 0)
        expense.usd += Number(r.amountUsd) || 0
      } else {
        receipt.syp += Math.round(Number(r.amountSyp) || 0)
        receipt.usd += Number(r.amountUsd) || 0
      }
    }
    return {
      expense: { syp: expense.syp, usd: Math.round(expense.usd * 100) / 100 },
      receipt: { syp: receipt.syp, usd: Math.round(receipt.usd * 100) / 100 },
    }
  }, [rows])

  const expenseRows = rows.filter((r) => r.kind === 'expense')
  const receiptRows = rows.filter((r) => r.kind === 'receipt')

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">حركة الصندوق</h1>
        <p className="page-desc">هذه الصفحة متاحة للاستقبال ومدير النظام فقط.</p>
      </>
    )
  }

  const renderTable = (
    kind: MovementKind,
    title: string,
    reasonLabel: string,
    drafts: DraftRow[],
    setDrafts: Dispatch<SetStateAction<DraftRow[]>>,
    savedRows: CashMovementRow[],
  ) => (
    <section className="card" style={{ marginBottom: '1rem' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}
      >
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h2>
        <button type="button" className="btn btn-secondary" onClick={() => setDrafts((prev) => [...prev, createDraftRow()])}>
          إضافة
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{reasonLabel}</th>
              <th>المبلغ بالليرة السورية</th>
              <th>المبلغ بالدولار</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((r) => (
              <tr key={r.rowId}>
                <td>
                  <input
                    className="input"
                    value={r.reason}
                    onChange={(e) =>
                      setDrafts((prev) => prev.map((x) => (x.rowId === r.rowId ? { ...x, reason: e.target.value } : x)))
                    }
                    placeholder={reasonLabel}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={1}
                    value={r.amountSyp}
                    onChange={(e) =>
                      setDrafts((prev) => prev.map((x) => (x.rowId === r.rowId ? { ...x, amountSyp: e.target.value } : x)))
                    }
                    placeholder="0"
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.01}
                    value={r.amountUsd}
                    onChange={(e) =>
                      setDrafts((prev) => prev.map((x) => (x.rowId === r.rowId ? { ...x, amountUsd: e.target.value } : x)))
                    }
                    placeholder="0.00"
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-primary" disabled={r.saving} onClick={() => void saveDraft(kind, r.rowId)}>
                    {r.saving ? 'جاري الحفظ…' : 'حفظ'}
                  </button>
                </td>
              </tr>
            ))}
            {savedRows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                  لا توجد حركات مسجّلة بعد.
                </td>
              </tr>
            ) : (
              savedRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.reason}</td>
                  <td>{r.amountSyp > 0 ? formatSyp(r.amountSyp) : '—'}</td>
                  <td dir="ltr">{r.amountUsd > 0 ? formatUsd(r.amountUsd) : '—'}</td>
                  <td>{formatCreatedAt(r.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">حركة الصندوق</h1>
          <p className="page-desc">
            تاريخ العمل: <strong>{businessDate || '—'}</strong> — أي حركة تُضاف هنا تنعكس مباشرة على صفحة{' '}
            <Link to="/reception/daily-inventory">الجرد المالي اليومي</Link>.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'جاري التحديث…' : 'تحديث'}
        </button>
      </div>

      {err ? (
        <p className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {err}
        </p>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.7rem', marginBottom: '1rem' }}>
        <div className="card">
          <p style={{ margin: 0, color: 'var(--danger)', fontWeight: 700 }}>إجمالي المصاريف — ل.س</p>
          <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{formatSyp(totals.expense.syp)}</p>
        </div>
        <div className="card" dir="ltr">
          <p style={{ margin: 0, color: 'var(--danger)', fontWeight: 700 }}>Total Expenses — USD</p>
          <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{formatUsd(totals.expense.usd)}</p>
        </div>
        <div className="card">
          <p style={{ margin: 0, color: 'var(--success)', fontWeight: 700 }}>إجمالي المقبوضات — ل.س</p>
          <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{formatSyp(totals.receipt.syp)}</p>
        </div>
        <div className="card" dir="ltr">
          <p style={{ margin: 0, color: 'var(--success)', fontWeight: 700 }}>Total Receipts — USD</p>
          <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{formatUsd(totals.receipt.usd)}</p>
        </div>
      </div>

      {renderTable('expense', 'جدول المصاريف', 'سبب الصرف', expenseDrafts, setExpenseDrafts, expenseRows)}
      {renderTable('receipt', 'جدول مبالغ مستلمة', 'سبب القبض', receiptDrafts, setReceiptDrafts, receiptRows)}
    </div>
  )
}
