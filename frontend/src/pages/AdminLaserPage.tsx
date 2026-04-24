import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'

type DailyRow = {
  userId: string
  name: string
  active: boolean
  totalShots: number
  sessionsCount: number
}
type FinanceRow = {
  userId: string
  name: string
  active: boolean
  totalAmountSyp: number
  sessionsCount: number
}
type LaserTab = 'shots' | 'expenses' | 'financial'
type ReportPeriod = 'daily' | 'monthly'

type LocalExpenseRow = { clientKey: string; reason: string; amountSypInput: string }

type FinanceMonthlyExtras = {
  totalSessionRevenueSyp: number
  totalExpensesSyp: number
  netProfitSyp: number
}

type LaserPaymentBreakdown = {
  cash: { totalSyp: number }
  banks: { bankName: string; totalSyp: number }[]
}

type BankEditorRow = { clientKey: string; name: string; active: boolean; sortOrder: string }

type MeterReconciliationRow = {
  complete: boolean
  delta: number | null
  matched: boolean | null
}

function ShotsMeterMatchBox({ roomLabel, row }: { roomLabel: string; row: MeterReconciliationRow }) {
  if (!row.complete) {
    return (
      <div
        role="status"
        style={{
          borderRadius: 10,
          padding: '0.55rem 0.85rem',
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'var(--text-muted)',
          fontSize: '0.86rem',
          minWidth: 160,
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: '0.15rem' }}>{roomLabel}</div>
        التحقق غير متاح (يُحتاج قراءة عداد بداية ونهاية هذا اليوم في إعدادات اليوم).
      </div>
    )
  }
  if (row.matched) {
    return (
      <div
        role="status"
        style={{
          borderRadius: 10,
          padding: '0.55rem 0.85rem',
          border: '1px solid var(--success)',
          background: 'var(--success-bg)',
          color: 'var(--success)',
          fontWeight: 800,
          fontSize: '0.95rem',
          minWidth: 160,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.2rem', opacity: 0.9 }}>{roomLabel}</div>
        متطابق
      </div>
    )
  }
  return (
    <div
      role="status"
      style={{
        borderRadius: 10,
        padding: '0.55rem 0.85rem',
        border: '1px solid var(--danger)',
        background: 'var(--danger-bg)',
        color: 'var(--danger)',
        fontWeight: 800,
        fontSize: '0.95rem',
        minWidth: 160,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.2rem', opacity: 0.9 }}>{roomLabel}</div>
      لا يوجد تطابق
    </div>
  )
}

export function AdminLaserPage() {
  const { user } = useAuth()
  const { businessDate } = useClinic()
  const allowed = user?.role === 'super_admin'
  const [tab, setTab] = useState<LaserTab>('shots')
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [date, setDate] = useState('')
  const [month, setMonth] = useState('')
  const [shotRows, setShotRows] = useState<DailyRow[]>([])
  const [roomTotals, setRoomTotals] = useState<{ room1Shots: number; room2Shots: number }>({ room1Shots: 0, room2Shots: 0 })
  const [meterReconciliation, setMeterReconciliation] = useState<{
    room1: MeterReconciliationRow
    room2: MeterReconciliationRow
  } | null>(null)
  const [shotLoading, setShotLoading] = useState(false)
  const [shotErr, setShotErr] = useState('')
  const [financeRows, setFinanceRows] = useState<FinanceRow[]>([])
  const [financeLoading, setFinanceLoading] = useState(false)
  const [financeErr, setFinanceErr] = useState('')
  const [topSpecialist, setTopSpecialist] = useState<{ name: string; totalAmountSyp: number } | null>(null)
  const [financeMonthlyExtras, setFinanceMonthlyExtras] = useState<FinanceMonthlyExtras | null>(null)
  const [laserPaymentBreakdown, setLaserPaymentBreakdown] = useState<LaserPaymentBreakdown | null>(null)
  const [bankRows, setBankRows] = useState<BankEditorRow[]>([])
  const [bankLoading, setBankLoading] = useState(false)
  const [bankSaving, setBankSaving] = useState(false)
  const [bankErr, setBankErr] = useState('')
  const [expenseRows, setExpenseRows] = useState<LocalExpenseRow[]>([])
  const [expenseLoading, setExpenseLoading] = useState(false)
  const [expenseErr, setExpenseErr] = useState('')
  const [expenseSaveBusy, setExpenseSaveBusy] = useState(false)

  useEffect(() => {
    if (!date && businessDate) setDate(businessDate)
  }, [businessDate, date])
  useEffect(() => {
    if (!month && businessDate) setMonth(String(businessDate).slice(0, 7))
  }, [businessDate, month])

  const expenseMonth = useMemo(() => {
    if (period === 'monthly' && month && /^\d{4}-\d{2}$/.test(month)) return month
    return ''
  }, [period, month])

  useEffect(() => {
    if (period === 'daily' && tab === 'expenses') setTab('shots')
  }, [period, tab])

  const previewExpenseTotalSyp = useMemo(() => {
    let sum = 0
    for (const r of expenseRows) {
      sum += Math.max(0, parseFloat(normalizeDecimalDigits(r.amountSypInput)) || 0)
    }
    return Math.round(sum)
  }, [expenseRows])

  const totalFinanceSyp = useMemo(
    () => financeRows.reduce((sum, r) => sum + (Number(r.totalAmountSyp) || 0), 0),
    [financeRows],
  )
  const totalLaserReceivedSyp = useMemo(() => {
    const b = laserPaymentBreakdown
    if (!b) return 0
    let s = Number(b.cash?.totalSyp) || 0
    for (const row of b.banks || []) s += Number(row.totalSyp) || 0
    return Math.round(s)
  }, [laserPaymentBreakdown])
  const renderMoneySyp = (sypValue: number) => {
    const n = Math.round(Number(sypValue) || 0)
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString('ar-SY')} ل.س</span>
    )
  }

  const loadShots = useCallback(async () => {
    if (!allowed) return
    setShotErr('')
    setShotLoading(true)
    try {
      const q =
        period === 'daily'
          ? date
            ? `?date=${encodeURIComponent(date)}`
            : ''
          : month
            ? `?month=${encodeURIComponent(month)}`
            : ''
      const endpoint = period === 'daily' ? '/api/laser/shots-daily' : '/api/laser/shots-monthly'
      const data = await api<{
        date?: string
        month?: string
        rows: DailyRow[]
        roomTotals?: { room1Shots?: number; room2Shots?: number }
        meterReconciliation?: { room1?: MeterReconciliationRow; room2?: MeterReconciliationRow }
      }>(`${endpoint}${q}`)
      setShotRows(data.rows || [])
      setRoomTotals({
        room1Shots: Number(data.roomTotals?.room1Shots) || 0,
        room2Shots: Number(data.roomTotals?.room2Shots) || 0,
      })
      const emptyRec: MeterReconciliationRow = { complete: false, delta: null, matched: null }
      if (period === 'daily') {
        const mr = data.meterReconciliation
        setMeterReconciliation({
          room1: mr?.room1 ?? emptyRec,
          room2: mr?.room2 ?? emptyRec,
        })
      } else {
        setMeterReconciliation(null)
      }
      if (period === 'daily' && !date && data.date) setDate(data.date)
      if (period === 'monthly' && !month && data.month) setMonth(data.month)
    } catch (e) {
      setShotRows([])
      setRoomTotals({ room1Shots: 0, room2Shots: 0 })
      setMeterReconciliation(null)
      setShotErr(e instanceof ApiError ? e.message : 'تعذر تحميل تقرير الضربات')
    } finally {
      setShotLoading(false)
    }
  }, [allowed, date, month, period])

  const loadFinancial = useCallback(async () => {
    if (!allowed) return
    setFinanceErr('')
    setFinanceLoading(true)
    try {
      const q =
        period === 'daily'
          ? date
            ? `?date=${encodeURIComponent(date)}`
            : ''
          : month
            ? `?month=${encodeURIComponent(month)}`
            : ''
      const endpoint = period === 'daily' ? '/api/laser/finance-daily' : '/api/laser/finance-monthly'
      const data = await api<{
        date?: string
        month?: string
        rows: FinanceRow[]
        topSpecialist: { userId: string; name: string; totalAmountSyp: number } | null
        totalSessionRevenueSyp?: number
        totalExpensesSyp?: number
        netProfitSyp?: number
        laserPaymentBreakdown?: LaserPaymentBreakdown
      }>(`${endpoint}${q}`)
      setFinanceRows(data.rows || [])
      setLaserPaymentBreakdown(data.laserPaymentBreakdown ?? { cash: { totalSyp: 0 }, banks: [] })
      setTopSpecialist(
        data.topSpecialist
          ? { name: data.topSpecialist.name, totalAmountSyp: data.topSpecialist.totalAmountSyp }
          : null,
      )
      if (
        period === 'monthly' &&
        data.totalSessionRevenueSyp != null &&
        data.totalExpensesSyp != null &&
        data.netProfitSyp != null
      ) {
        setFinanceMonthlyExtras({
          totalSessionRevenueSyp: Number(data.totalSessionRevenueSyp) || 0,
          totalExpensesSyp: Number(data.totalExpensesSyp) || 0,
          netProfitSyp: Number(data.netProfitSyp) || 0,
        })
      } else {
        setFinanceMonthlyExtras(null)
      }
      if (period === 'daily' && !date && data.date) setDate(data.date)
      if (period === 'monthly' && !month && data.month) setMonth(data.month)
    } catch (e) {
      setFinanceRows([])
      setTopSpecialist(null)
      setFinanceMonthlyExtras(null)
      setLaserPaymentBreakdown(null)
      setFinanceErr(e instanceof ApiError ? e.message : 'تعذر تحميل التقرير المالي')
    } finally {
      setFinanceLoading(false)
    }
  }, [allowed, date, month, period])

  const loadBankSettings = useCallback(async () => {
    if (!allowed) return
    setBankErr('')
    setBankLoading(true)
    try {
      const data = await api<{
        banksAll: { id: string; name: string; active: boolean; sortOrder: number }[]
      }>('/api/billing/payment-bank-options?admin=1')
      const rows = (data.banksAll || []).map((b, i) => ({
        clientKey: b.id,
        name: b.name,
        active: b.active !== false,
        sortOrder: String(Number.isFinite(Number(b.sortOrder)) ? b.sortOrder : i),
      }))
      setBankRows(
        rows.length > 0
          ? rows
          : [{ clientKey: crypto.randomUUID(), name: '', active: true, sortOrder: '0' }],
      )
    } catch (e) {
      setBankErr(e instanceof ApiError ? e.message : 'تعذر تحميل قائمة البنوك')
    } finally {
      setBankLoading(false)
    }
  }, [allowed])

  const saveBankSettings = useCallback(async () => {
    if (!allowed) return
    setBankErr('')
    setBankSaving(true)
    try {
      const banks = bankRows
        .map((r, i) => ({
          name: r.name.trim(),
          active: r.active,
          sortOrder: Math.max(0, parseInt(r.sortOrder, 10) || i),
        }))
        .filter((b) => b.name.length > 0)
      if (banks.length === 0) {
        setBankErr('أضف اسماً لبنك واحد على الأقل.')
        return
      }
      await api('/api/billing/payment-bank-options', {
        method: 'PUT',
        body: JSON.stringify({ banks }),
      })
      await loadBankSettings()
    } catch (e) {
      setBankErr(e instanceof ApiError ? e.message : 'تعذر حفظ البنوك')
    } finally {
      setBankSaving(false)
    }
  }, [allowed, bankRows, loadBankSettings])

  useEffect(() => {
    if (tab === 'financial' && allowed) void loadBankSettings()
  }, [tab, allowed, loadBankSettings])

  const loadExpenses = useCallback(async () => {
    if (!allowed || !expenseMonth) return
    setExpenseErr('')
    setExpenseLoading(true)
    try {
      const data = await api<{
        month: string
        lines: { id: string; reason: string; amountSyp: number }[]
        totalExpensesSyp: number
      }>(`/api/laser/monthly-expenses?month=${encodeURIComponent(expenseMonth)}`)
      const lines = data.lines || []
      setExpenseRows(
        lines.length > 0
          ? lines.map((l) => ({
              clientKey: l.id,
              reason: l.reason,
              amountSypInput: (l.amountSyp ?? 0) === 0 ? '' : String(l.amountSyp),
            }))
          : [{ clientKey: crypto.randomUUID(), reason: '', amountSypInput: '' }],
      )
    } catch (e) {
      setExpenseRows([{ clientKey: crypto.randomUUID(), reason: '', amountSypInput: '' }])
      setExpenseErr(e instanceof ApiError ? e.message : 'تعذر تحميل المصاريف')
    } finally {
      setExpenseLoading(false)
    }
  }, [allowed, expenseMonth])

  const saveExpenses = useCallback(async () => {
    if (!allowed || !expenseMonth) return
    setExpenseSaveBusy(true)
    setExpenseErr('')
    try {
      const lines = expenseRows.map((r) => ({
        reason: r.reason.trim(),
        amountSyp: Math.max(0, Math.round(parseFloat(normalizeDecimalDigits(r.amountSypInput)) || 0)),
      }))
      const data = await api<{
        month: string
        lines: { id: string; reason: string; amountSyp: number }[]
        totalExpensesSyp: number
      }>('/api/laser/monthly-expenses', {
        method: 'PUT',
        body: JSON.stringify({ month: expenseMonth, lines }),
      })
      const out = data.lines || []
      setExpenseRows(
        out.length > 0
          ? out.map((l) => ({
              clientKey: l.id,
              reason: l.reason,
              amountSypInput: (l.amountSyp ?? 0) === 0 ? '' : String(l.amountSyp),
            }))
          : [{ clientKey: crypto.randomUUID(), reason: '', amountSypInput: '' }],
      )
    } catch (e) {
      setExpenseErr(e instanceof ApiError ? e.message : 'تعذر حفظ المصاريف')
    } finally {
      setExpenseSaveBusy(false)
    }
  }, [allowed, expenseMonth, expenseRows])

  useEffect(() => {
    if (tab === 'shots') {
      void loadShots()
      return
    }
    if (tab === 'expenses') {
      void loadExpenses()
      return
    }
    void loadFinancial()
  }, [tab, loadShots, loadFinancial, loadExpenses])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">ليزر</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">ليزر</h1>
      <p className="page-desc">متابعة يومية وشهرية لأداء الأخصائيين (ضربات ومالية).</p>

      <div
        className="toolbar"
        style={{ marginTop: '0.95rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        {period === 'daily' ? (
          <>
            <label className="form-label" htmlFor="laser-day" style={{ margin: 0 }}>
              تاريخ اليوم
            </label>
            <input
              id="laser-day"
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ maxWidth: 220 }}
            />
          </>
        ) : (
          <>
            <label className="form-label" htmlFor="laser-month" style={{ margin: 0 }}>
              الشهر
            </label>
            <input
              id="laser-month"
              className="input"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ maxWidth: 220 }}
            />
          </>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={
            tab === 'shots' ? shotLoading : tab === 'expenses' ? expenseLoading : financeLoading
          }
          onClick={() => {
            if (tab === 'shots') {
              void loadShots()
              return
            }
            if (tab === 'expenses') {
              void loadExpenses()
              return
            }
            void loadFinancial()
          }}
        >
          {tab === 'shots'
            ? shotLoading
              ? 'جاري التحديث…'
              : 'تحديث'
            : tab === 'expenses'
              ? expenseLoading
                ? 'جاري التحديث…'
                : 'تحديث'
              : financeLoading
                ? 'جاري التحديث…'
                : 'تحديث'}
        </button>
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: '0.65rem' }}>
        <button
          type="button"
          role="tab"
          aria-selected={period === 'daily'}
          className={`tab${period === 'daily' ? ' active' : ''}`}
          onClick={() => {
            setPeriod('daily')
            setTab((t) => (t === 'expenses' ? 'shots' : t))
          }}
        >
          تقارير يومية
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={period === 'monthly'}
          className={`tab${period === 'monthly' ? ' active' : ''}`}
          onClick={() => setPeriod('monthly')}
        >
          تقارير شهرية
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'shots'}
          className={`tab${tab === 'shots' ? ' active' : ''}`}
          onClick={() => setTab('shots')}
        >
          الضربات
        </button>
        {period === 'monthly' ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'expenses'}
            className={`tab${tab === 'expenses' ? ' active' : ''}`}
            onClick={() => setTab('expenses')}
          >
            مصاريف
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'financial'}
          className={`tab${tab === 'financial' ? ' active' : ''}`}
          onClick={() => setTab('financial')}
        >
          مالية
        </button>
      </div>

      {tab === 'shots' && shotErr ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{shotErr}</p> : null}
      {tab === 'expenses' && expenseErr ? (
        <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{expenseErr}</p>
      ) : null}
      {tab === 'financial' && financeErr ? (
        <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{financeErr}</p>
      ) : null}

      {tab === 'shots' ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2 className="card-title" style={{ marginBottom: '0.55rem' }}>
            {period === 'daily' ? `تاريخ التقرير: ${date || '—'}` : `شهر التقرير: ${month || '—'}`}
          </h2>
          <div style={{ marginBottom: '0.8rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            ضربات الغرفة الأولى: <strong style={{ color: 'var(--text)' }}>{roomTotals.room1Shots}</strong> — ضربات الغرفة
            الثانية: <strong style={{ color: 'var(--text)' }}>{roomTotals.room2Shots}</strong>
          </div>
          {period === 'daily' && meterReconciliation ? (
            <div style={{ marginBottom: '0.95rem' }}>
              <p style={{ margin: '0 0 0.45rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                مطابقة العداد: (قراءة بداية اليوم + ضربات الجلسات المسجّلة) − قراءة نهاية اليوم — يجب أن يساوي{' '}
                <strong>0</strong> عند التطابق مع الجهاز.
              </p>
              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
                <ShotsMeterMatchBox roomLabel="الغرفة 1" row={meterReconciliation.room1} />
                <ShotsMeterMatchBox roomLabel="الغرفة 2" row={meterReconciliation.room2} />
              </div>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الأخصائي</th>
                  <th>مجموع الضربات</th>
                  <th>عدد الجلسات المنتهية</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {shotLoading ? (
                  <tr>
                    <td colSpan={4}>جاري التحميل…</td>
                  </tr>
                ) : shotRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                      لا يوجد أخصائيو ليزر مسجلون.
                    </td>
                  </tr>
                ) : (
                  shotRows.map((r) => (
                    <tr key={r.userId}>
                      <td>{r.name}</td>
                      <td>{Number(r.totalShots) || 0}</td>
                      <td>{Number(r.sessionsCount) || 0}</td>
                      <td>{r.active ? 'فعّال' : 'غير فعّال'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'expenses' && period === 'monthly' ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2 className="card-title" style={{ marginBottom: '0.45rem' }}>
            مصاريف الليزر — شهر {expenseMonth || '—'}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '0.65rem' }}>
            تُسجّل المصاريف <strong>شهرياً فقط</strong> بالليرة السورية وتُطرح من{' '}
            <strong>مجموع أسعار جلسات الليزر</strong> في التقرير المالي الشهري ليظهر <strong>الربح الصافي</strong>.
          </p>
          {!expenseMonth ? (
            <p style={{ color: 'var(--warning)', fontSize: '0.9rem' }}>حدّد الشهر من الشريط أعلاه.</p>
          ) : expenseLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 200 }}>سبب الصرف</th>
                      <th style={{ minWidth: 130 }}>المبلغ (ل.س)</th>
                      <th style={{ width: 88 }}> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseRows.map((row) => (
                      <tr key={row.clientKey}>
                        <td>
                          <input
                            className="input"
                            dir="rtl"
                            value={row.reason}
                            onChange={(e) => {
                              const v = e.target.value
                              setExpenseRows((prev) =>
                                prev.map((r) => (r.clientKey === row.clientKey ? { ...r, reason: v } : r)),
                              )
                            }}
                            placeholder="مثال: صيانة، مستهلكات…"
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            dir="ltr"
                            inputMode="decimal"
                            value={row.amountSypInput}
                            onChange={(e) => {
                              const v = e.target.value
                              setExpenseRows((prev) =>
                                prev.map((r) => (r.clientKey === row.clientKey ? { ...r, amountSypInput: v } : r)),
                              )
                            }}
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: '0.82rem' }}
                            onClick={() => {
                              setExpenseRows((prev) => {
                                if (prev.length <= 1) {
                                  return [
                                    {
                                      clientKey: crypto.randomUUID(),
                                      reason: '',
                                      amountSypInput: '',
                                    },
                                  ]
                                }
                                return prev.filter((r) => r.clientKey !== row.clientKey)
                              })
                            }}
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  marginTop: '0.85rem',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.6rem',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setExpenseRows((prev) => [
                      ...prev,
                      { clientKey: crypto.randomUUID(), reason: '', amountSypInput: '' },
                    ])
                  }
                >
                  + صف جديد
                </button>
                <button type="button" className="btn btn-primary" disabled={expenseSaveBusy} onClick={() => void saveExpenses()}>
                  {expenseSaveBusy ? 'جاري الحفظ…' : 'حفظ المصاريف'}
                </button>
              </div>
              <p style={{ marginTop: '0.75rem', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                مجموع المصاريف (تقديري قبل الحفظ):{' '}
                <strong style={{ color: 'var(--text)' }}>{previewExpenseTotalSyp.toLocaleString('ar-SY')} ل.س</strong>
              </p>
            </>
          )}
        </div>
      ) : tab === 'financial' ? (
        <>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title" style={{ marginBottom: '0.35rem' }}>
              الأعلى مبلغًا — {period === 'daily' ? `تاريخ ${date || '—'}` : `شهر ${month || '—'}`}
            </h2>
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '0.75rem',
                background: 'var(--bg)',
                display: 'inline-block',
                minWidth: 260,
              }}
            >
              {financeLoading ? (
                <span style={{ color: 'var(--text-muted)' }}>جاري التحميل…</span>
              ) : topSpecialist ? (
                <>
                  <div style={{ fontWeight: 800, marginBottom: '0.2rem' }}>{topSpecialist.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {renderMoneySyp(topSpecialist.totalAmountSyp || 0)}
                  </div>
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>لا يوجد بيانات مالية لهذا اليوم.</span>
              )}
            </div>
          </div>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title" style={{ marginBottom: '0.55rem' }}>
              مالية جلسات الليزر — {period === 'daily' ? `تاريخ ${date || '—'}` : `شهر ${month || '—'}`}
            </h2>
            {laserPaymentBreakdown && !financeLoading ? (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-solid)',
                }}
              >
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>تفصيل التحصيل (ليزر)</h3>
                <p style={{ margin: '0.25rem 0', fontSize: '0.88rem', lineHeight: 1.55 }}>
                  <strong>كاش:</strong>{' '}
                  <span dir="ltr">{(Number(laserPaymentBreakdown.cash.totalSyp) || 0).toLocaleString('ar-SY')} ل.س</span>
                </p>
                {laserPaymentBreakdown.banks.length > 0 ? (
                  <ul style={{ margin: '0.35rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.88rem' }}>
                    {laserPaymentBreakdown.banks.map((bk) => (
                      <li key={bk.bankName} style={{ marginBottom: '0.25rem' }}>
                        <strong>بنك ({bk.bankName}):</strong>{' '}
                        <span dir="ltr">{(Number(bk.totalSyp) || 0).toLocaleString('ar-SY')} ل.س</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    لا توجد دفعات مسجّلة كـ «بنك» في هذه الفترة.
                  </p>
                )}
                {period === 'daily' ? (
                  <>
                    <p style={{ margin: '0.65rem 0 0.35rem', fontSize: '0.88rem', fontWeight: 700 }}>
                      إجمالي المُحصَّل اليوم (كاش + بنوك): {renderMoneySyp(totalLaserReceivedSyp)}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        lineHeight: 1.55,
                        maxWidth: 640,
                      }}
                    >
                      <strong>لماذا قد يختلف عن «مجموع أسعار الجلسات»؟</strong> المجموع أسفل الجدول هو مجموع{' '}
                      <strong>رسوم الجلسات المسجّلة</strong> في سجل كل أخصائي لجلسات ليزر <strong>منتهية تنفيذياً</strong> في
                      هذا التاريخ — ويشمل الجلسات التي <strong>لم يُؤكَّد تحصيلها بعد</strong>. أما كاش/بنك فيحسب من
                      بنود ليزر أصبحت <strong>مدفوعة</strong> فعلاً في التحصيل، أي المبلغ <strong>الذي دخل</strong> ذلك
                      اليوم. يتطابق الرقمان تقريباً فقط عندما يُحصَّل كل المستحق لكل الجلسات المنتهية في نفس اليوم
                      وبنفس المبالغ المسجّلة.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            {period === 'monthly' && financeMonthlyExtras ? (
              <div style={{ marginBottom: '1.35rem' }}>
                <p
                  style={{
                    margin: '0 0 0.85rem',
                    fontSize: '0.84rem',
                    color: 'var(--text-muted)',
                    lineHeight: 1.5,
                  }}
                >
                  ملخص الشهر: مقارنة بين إيراد الجلسات والمصاريف المسجّلة، ثم <strong style={{ color: 'var(--text)' }}>الربح الصافي</strong>.
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
                    gap: '0.75rem',
                    marginBottom: '0.85rem',
                  }}
                >
                  <div
                    style={{
                      borderRadius: 14,
                      padding: '1rem 1.05rem',
                      background: 'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 55%, #a7f3d0 100%)',
                      border: '1px solid #34d399',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.12)',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#065f46',
                        background: 'rgba(255,255,255,0.65)',
                        padding: '0.2rem 0.55rem',
                        borderRadius: 999,
                        marginBottom: '0.45rem',
                      }}
                    >
                      <span aria-hidden>↑</span> إيراد الجلسات
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#047857', fontWeight: 700, marginBottom: '0.2rem' }}>
                      مجموع أسعار الجلسات
                    </div>
                    <div style={{ fontWeight: 800, color: '#064e3b', fontSize: '0.95rem' }}>
                      {renderMoneySyp(financeMonthlyExtras.totalSessionRevenueSyp)}
                    </div>
                  </div>
                  <div
                    style={{
                      borderRadius: 14,
                      padding: '1rem 1.05rem',
                      background: 'linear-gradient(160deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%)',
                      border: '1px solid #fb923c',
                      boxShadow: '0 4px 14px rgba(249, 115, 22, 0.12)',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#9a3412',
                        background: 'rgba(255,255,255,0.7)',
                        padding: '0.2rem 0.55rem',
                        borderRadius: 999,
                        marginBottom: '0.45rem',
                      }}
                    >
                      <span aria-hidden>−</span> المصاريف
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#c2410c', fontWeight: 700, marginBottom: '0.2rem' }}>
                      من تبويب «مصاريف» لهذا الشهر
                    </div>
                    <div style={{ fontWeight: 800, color: '#7c2d12', fontSize: '0.95rem' }}>
                      {renderMoneySyp(financeMonthlyExtras.totalExpensesSyp)}
                    </div>
                  </div>
                </div>
                <div
                  role="region"
                  aria-label="الربح الصافي"
                  style={{
                    borderRadius: 16,
                    padding: '1.1rem 1.2rem',
                    border: '2px solid #818cf8',
                    background: 'linear-gradient(145deg, #eef2ff 0%, #e0e7ff 40%, #c7d2fe 100%)',
                    boxShadow: '0 8px 24px rgba(99, 102, 241, 0.18)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 900,
                        letterSpacing: '0.02em',
                        color: '#3730a3',
                        background: 'rgba(255,255,255,0.75)',
                        padding: '0.25rem 0.65rem',
                        borderRadius: 999,
                      }}
                    >
                      الربح الصافي
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#4f46e5', fontWeight: 600 }}>
                      إيراد الجلسات − المصاريف
                    </span>
                  </div>
                  <div
                    style={{
                      fontWeight: 900,
                      fontSize: '1.18rem',
                      color: '#312e81',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {renderMoneySyp(financeMonthlyExtras.netProfitSyp)}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '0.8rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                مجموع رسوم الجلسات المنفّذة (كل الأخصائيين — حسب السجل، قد يشمل غير المحصّل):{' '}
                <strong style={{ color: 'var(--text)' }}>{renderMoneySyp(totalFinanceSyp)}</strong>
              </div>
            )}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الأخصائي</th>
                    <th>مجموع رسوم الجلسات (السجل)</th>
                    <th>عدد الجلسات المنتهية</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {financeLoading ? (
                    <tr>
                      <td colSpan={4}>جاري التحميل…</td>
                    </tr>
                  ) : financeRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                        لا يوجد أخصائيو ليزر مسجلون.
                      </td>
                    </tr>
                  ) : (
                    financeRows.map((r) => (
                      <tr key={r.userId}>
                        <td>{r.name}</td>
                        <td>{renderMoneySyp(Number(r.totalAmountSyp || 0))}</td>
                        <td>{Number(r.sessionsCount) || 0}</td>
                        <td>{r.active ? 'فعّال' : 'غير فعّال'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title" style={{ marginBottom: '0.45rem' }}>
              إدارة بنوك التحصيل
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: '0.65rem' }}>
              تظهر في نافذة «تأكيد استلام الدفع» عند اختيار <strong>بنك</strong>. يمكن تعطيل بنك دون حذفه.
            </p>
            {bankErr ? <p style={{ color: 'var(--danger)', marginBottom: '0.5rem' }}>{bankErr}</p> : null}
            {bankLoading ? (
              <p style={{ color: 'var(--text-muted)' }}>جاري تحميل البنوك…</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>اسم البنك</th>
                        <th>فعّال</th>
                        <th>ترتيب</th>
                        <th style={{ width: 88 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {bankRows.map((row) => (
                        <tr key={row.clientKey}>
                          <td>
                            <input
                              className="input"
                              dir="rtl"
                              value={row.name}
                              onChange={(e) => {
                                const v = e.target.value
                                setBankRows((prev) =>
                                  prev.map((r) => (r.clientKey === row.clientKey ? { ...r, name: v } : r)),
                                )
                              }}
                              placeholder="مثال: بيمو"
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.active}
                              onChange={(e) => {
                                const v = e.target.checked
                                setBankRows((prev) =>
                                  prev.map((r) => (r.clientKey === row.clientKey ? { ...r, active: v } : r)),
                                )
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              dir="ltr"
                              inputMode="numeric"
                              style={{ maxWidth: 88 }}
                              value={row.sortOrder}
                              onChange={(e) => {
                                const v = e.target.value
                                setBankRows((prev) =>
                                  prev.map((r) => (r.clientKey === row.clientKey ? { ...r, sortOrder: v } : r)),
                                )
                              }}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.82rem' }}
                              onClick={() =>
                                setBankRows((prev) => {
                                  if (prev.length <= 1) return prev
                                  return prev.filter((r) => r.clientKey !== row.clientKey)
                                })
                              }
                            >
                              حذف
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      setBankRows((prev) => [
                        ...prev,
                        { clientKey: crypto.randomUUID(), name: '', active: true, sortOrder: String(prev.length) },
                      ])
                    }
                  >
                    + بنك
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={bankSaving}
                    onClick={() => void saveBankSettings()}
                  >
                    {bankSaving ? 'جاري الحفظ…' : 'حفظ قائمة البنوك'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </>
  )
}
