import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import type { Role } from '../types'

type BankRow = { bankName: string; totalSyp: number; totalUsd: number }

type DeptRow = {
  key: string
  label: string
  transactionCount: number
  cashSyp: number
  cashUsd: number
  bankSyp: number
  bankUsd: number
}

type TxRow = {
  billingItemId: string
  paymentId: string
  paidAt: string | null
  patientName: string
  providerName: string
  receivedByName: string
  department: string
  departmentLabel: string
  procedureLabel: string
  paymentChannel: 'cash' | 'bank'
  bankName: string
  payCurrency: 'SYP' | 'USD'
  receivedAmountSyp: number
  receivedAmountUsd: number
  amountDueSyp: number
  settlementDeltaSyp: number
  patientRefundSyp: number
  patientRefundUsd: number
}

type InventoryPayload = {
  businessDate: string
  dateLockedToToday: boolean
  dayActive: boolean
  usdSypRate: number | null
  summary: {
    cashBase?: { totalSyp: number; totalUsd: number }
    cash: { totalSyp: number; totalUsd: number }
    banks: BankRow[]
    totals: { totalSyp: number; totalUsd: number }
    refundsRecorded: { totalSyp: number; totalUsd: number }
    transactionCount: number
    pendingCollectionCount: number
  }
  cashMovements?: {
    expense: { totalSyp: number; totalUsd: number }
    receipt: { totalSyp: number; totalUsd: number }
    rows: Array<{
      id: string
      kind: 'expense' | 'receipt'
      reason: string
      amountSyp: number
      amountUsd: number
      createdAt: string | null
    }>
  }
  byDepartment: DeptRow[]
  transactions: TxRow[]
}

const ACCESS: Role[] = ['reception', 'super_admin']

function formatSyp(n: number) {
  return `${Math.round(n).toLocaleString('ar-SY')} ل.س`
}

function formatUsd(n: number) {
  const v = Math.round(n * 100) / 100
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ar-SY', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    })
  } catch {
    return '—'
  }
}

export function ReceptionDailyInventoryPage() {
  const { user } = useAuth()
  const { businessDate: ctxDate, usdSypRate: ctxRate, refreshSystem } = useClinic()
  const allowed = user?.role && ACCESS.includes(user.role as Role)

  const [data, setData] = useState<InventoryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    try {
      setLoading(true)
      const res = await api<InventoryPayload>('/api/billing/reception-daily-inventory')
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الجرد')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">جرد مالي يومي</h1>
        <p className="page-desc">
          هذه الصفحة متاحة لدور <strong>استقبال</strong> من القائمة الجانبية، ولمدير النظام عند فتح الرابط مباشرة
          للدعم الفني.
        </p>
      </>
    )
  }

  const d = data
  const rate = d?.usdSypRate ?? ctxRate
  const dateLabel = d?.businessDate
    ? new Date(d.businessDate + 'T12:00:00').toLocaleDateString('ar-SY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—'

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <header
        style={{
          position: 'relative',
          borderRadius: 'var(--radius)',
          padding: '1.35rem 1.5rem 1.5rem',
          marginBottom: '1.25rem',
          overflow: 'hidden',
          color: '#fff',
          background: 'linear-gradient(135deg, #0369a1 0%, #4f46e5 42%, #7c3aed 88%)',
          boxShadow: 'var(--glow-cyan), 0 4px 0 rgba(0,0,0,0.06) inset',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse 70% 120% at 100% 0%, rgba(255,255,255,0.18), transparent 50%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ margin: 0, opacity: 0.92, fontSize: '0.82rem', letterSpacing: '0.02em' }}>استقبال — تسوية يومية</p>
          <h1 className="page-title" style={{ margin: '0.2rem 0 0.35rem', color: '#fff', border: 'none' }}>
            جرد مالي يومي
          </h1>
          <p style={{ margin: 0, fontSize: '0.95rem', opacity: 0.95, lineHeight: 1.65 }}>
            <strong>{dateLabel}</strong>
            <span style={{ opacity: 0.85 }}> — يُحسب تلقائياً ليوم التقويم الحالي فقط؛ لا يمكن عرض يوم سابق من هذه
            الصفحة.</span>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem', alignItems: 'center' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.65rem',
                borderRadius: 999,
                fontSize: '0.8rem',
                fontWeight: 600,
                background: d?.dayActive ? 'rgba(34,197,94,0.25)' : 'rgba(251,191,36,0.3)',
                border: '1px solid rgba(255,255,255,0.35)',
              }}
            >
              {d?.dayActive ? 'يوم عمل نشط' : 'يوم غير مفعّل أو مغلق'}
            </span>
            {ctxDate && d?.businessDate && ctxDate === d.businessDate ? (
              <span
                style={{
                  fontSize: '0.78rem',
                  opacity: 0.9,
                  padding: '0.2rem 0.55rem',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.12)',
                }}
              >
                يطابق يوم النظام في الواجهة
              </span>
            ) : null}
            {rate != null && rate > 0 ? (
              <span
                style={{
                  fontSize: '0.78rem',
                  opacity: 0.95,
                  padding: '0.2rem 0.55rem',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.12)',
                }}
                dir="ltr"
              >
                سعر اليوم المحفوظ: {rate.toLocaleString('ar-SY')} ل.س / 1 USD
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
          {loading ? 'جاري التحديث…' : 'تحديث الجرد'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void refreshSystem()}>
          تحديث حالة اليوم
        </button>
      </div>

      {err ? (
        <p className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {err}
        </p>
      ) : null}

      {loading && !d ? (
        <div className="card">
          <p style={{ margin: 0 }}>جاري تحميل تفاصيل التحصيل…</p>
        </div>
      ) : null}

      {d && !loading ? (
        <>
          {d.summary.pendingCollectionCount > 0 ? (
            <div
              className="card"
              style={{
                marginBottom: '1rem',
                borderRight: '4px solid var(--warning)',
                background: 'var(--warning-bg)',
              }}
            >
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--amber)' }}>
                تنبيه: {d.summary.pendingCollectionCount.toLocaleString('ar-SY')} بنداً ما زال بانتظار التحصيل لهذا
                اليوم
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                أغلق البنود من صفحة «التحصيل» ليتطابق النقد الفعلي مع الجرد بعد اكتمال اليوم.
              </p>
            </div>
          ) : null}

          <section style={{ marginBottom: '1.15rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>ملخص ما يجب أن يتوافر لديك</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.75rem',
              }}
            >
              <div
                className="card"
                style={{
                  borderTop: '4px solid #16a34a',
                  background: 'linear-gradient(180deg, var(--success-bg) 0%, var(--surface) 55%)',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--success)', fontWeight: 700 }}>كاش — ليرة سورية</p>
                <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, color: 'var(--text)' }}>
                  {formatSyp(d.summary.cash.totalSyp)}
                </p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  بعد إضافة المصاريف والمقبوضات النقدية
                </p>
              </div>
              <div
                className="card"
                style={{
                  borderTop: '4px solid #0284c7',
                  background: 'linear-gradient(180deg, var(--cyan-dim) 0%, var(--surface) 55%)',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--cyan)', fontWeight: 700 }}>كاش — دولار</p>
                <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, direction: 'ltr', textAlign: 'right' }}>
                  {formatUsd(d.summary.cash.totalUsd)}
                </p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  بعد إضافة المصاريف والمقبوضات النقدية
                </p>
              </div>
              <div
                className="card"
                style={{
                  borderTop: '4px solid #7c3aed',
                  background: 'linear-gradient(180deg, var(--violet-dim) 0%, var(--surface) 55%)',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--violet)', fontWeight: 700 }}>الإجمالي — ليرة</p>
                <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, color: 'var(--text)' }}>
                  {formatSyp(d.summary.totals.totalSyp)}
                </p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>كاش + جميع البنوك (مقابل ليرة)</p>
              </div>
              <div
                className="card"
                style={{
                  borderTop: '4px solid #db2777',
                  background: 'linear-gradient(180deg, var(--magenta-dim) 0%, var(--surface) 55%)',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--magenta)', fontWeight: 700 }}>الإجمالي — دولار</p>
                <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, direction: 'ltr', textAlign: 'right' }}>
                  {formatUsd(d.summary.totals.totalUsd)}
                </p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>كاش + بنوك (مبالغ بالدولار)</p>
              </div>
            </div>
          </section>

          {d.cashMovements ? (
            <section style={{ marginBottom: '1.15rem' }}>
              <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>
                جدول حركة الصندوق (مصاريف + مبالغ مستلمة)
              </h2>
              <div className="card" style={{ marginBottom: '0.65rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
                  <p style={{ margin: 0 }}>
                    <strong>كاش أساسي ل.س:</strong> {formatSyp(d.summary.cashBase?.totalSyp ?? d.summary.cash.totalSyp)}
                  </p>
                  <p style={{ margin: 0 }} dir="ltr">
                    <strong>Cash Base USD:</strong> {formatUsd(d.summary.cashBase?.totalUsd ?? d.summary.cash.totalUsd)}
                  </p>
                  <p style={{ margin: 0, color: 'var(--danger)' }}>
                    <strong>مصاريف:</strong> {formatSyp(d.cashMovements.expense.totalSyp)}
                  </p>
                  <p style={{ margin: 0, color: 'var(--danger)' }} dir="ltr">
                    <strong>Expenses USD:</strong> {formatUsd(d.cashMovements.expense.totalUsd)}
                  </p>
                  <p style={{ margin: 0, color: 'var(--success)' }}>
                    <strong>مقبوضات:</strong> {formatSyp(d.cashMovements.receipt.totalSyp)}
                  </p>
                  <p style={{ margin: 0, color: 'var(--success)' }} dir="ltr">
                    <strong>Receipts USD:</strong> {formatUsd(d.cashMovements.receipt.totalUsd)}
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>النوع</th>
                      <th>السبب</th>
                      <th>المبلغ ل.س</th>
                      <th>المبلغ USD</th>
                      <th>الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.cashMovements.rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                          لا توجد حركة صندوق مسجلة لهذا اليوم.
                        </td>
                      </tr>
                    ) : (
                      d.cashMovements.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.kind === 'expense' ? 'مصروف' : 'مقبوض'}</td>
                          <td>{row.reason}</td>
                          <td>{row.amountSyp > 0 ? formatSyp(row.amountSyp) : '—'}</td>
                          <td dir="ltr">{row.amountUsd > 0 ? formatUsd(row.amountUsd) : '—'}</td>
                          <td>
                            {row.createdAt
                              ? new Date(row.createdAt).toLocaleString('ar-SY', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  day: '2-digit',
                                  month: '2-digit',
                                })
                              : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section style={{ marginBottom: '1.15rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>البنوك — تفصيل الحوالات</h2>
            {d.summary.banks.length === 0 ? (
              <div className="card" style={{ color: 'var(--text-muted)' }}>
                <p style={{ margin: 0 }}>لا توجد تحصيلات عبر بنك لهذا اليوم حتى الآن.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.65rem' }}>
                {d.summary.banks.map((b) => (
                  <div
                    key={b.bankName}
                    className="card"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      borderRight: '5px solid #6366f1',
                      background: 'linear-gradient(90deg, rgba(99,102,241,0.08), var(--surface))',
                    }}
                  >
                    <div>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: '1.02rem', color: '#4338ca' }}>{b.bankName}</p>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>قناة استلام: بنك</p>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', textAlign: 'left' as const }}>
                      <div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 700 }}>ل.س</span>
                        <p style={{ margin: '0.15rem 0 0', fontWeight: 700 }}>{formatSyp(b.totalSyp)}</p>
                      </div>
                      <div dir="ltr">
                        <span style={{ fontSize: '0.72rem', color: 'var(--cyan)', fontWeight: 700 }}>USD</span>
                        <p style={{ margin: '0.15rem 0 0', fontWeight: 700 }}>{formatUsd(b.totalUsd)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {(d.summary.refundsRecorded.totalSyp > 0 || d.summary.refundsRecorded.totalUsd > 0) ? (
            <section style={{ marginBottom: '1.15rem' }}>
              <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>ترجيع مسجّل (دفعات بالدولار)</h2>
              <div
                className="card"
                style={{
                  borderRight: '4px solid var(--amber)',
                  background: 'var(--warning-bg)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1.25rem',
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 700 }}>إجمالي ترجيع ل.س</p>
                  <p style={{ margin: '0.35rem 0 0', fontWeight: 700 }}>{formatSyp(d.summary.refundsRecorded.totalSyp)}</p>
                </div>
                <div dir="ltr">
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 700 }}>إجمالي ترجيع USD</p>
                  <p style={{ margin: '0.35rem 0 0', fontWeight: 700 }}>{formatUsd(d.summary.refundsRecorded.totalUsd)}</p>
                </div>
              </div>
            </section>
          ) : null}

          <section style={{ marginBottom: '1.15rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>حسب القسم</h2>
            {d.byDepartment.length === 0 ? (
              <div className="card" style={{ color: 'var(--text-muted)' }}>
                <p style={{ margin: 0 }}>لا توجد عمليات محصّلة بعد — سيظهر التفصيل حسب الليزر/الجلدية/الأسنان/السولاريوم عند أول تحصيل.</p>
              </div>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              {d.byDepartment.map((row) => (
                <div
                  key={row.key}
                  className="card"
                  style={{
                    minWidth: 200,
                    flex: '1 1 220px',
                    borderBottom: '3px solid var(--cyan)',
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 800, color: 'var(--cyan)' }}>{row.label}</p>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    عمليات: {row.transactionCount.toLocaleString('ar-SY')}
                  </p>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
                  <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--success)' }}>كاش ل.س:</span> {formatSyp(row.cashSyp)}
                  </p>
                  <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }} dir="ltr">
                    <span style={{ color: 'var(--cyan)' }}>كاش USD:</span> {formatUsd(row.cashUsd)}
                  </p>
                  <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>
                    <span style={{ color: '#4f46e5' }}>بنك ل.س:</span> {formatSyp(row.bankSyp)}
                  </p>
                  <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }} dir="ltr">
                    <span style={{ color: '#7c3aed' }}>بنك USD:</span> {formatUsd(row.bankUsd)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>
              سجل العمليات ({d.summary.transactionCount.toLocaleString('ar-SY')})
            </h2>
            <div
              className="card"
              style={{ padding: 0, overflow: 'auto', maxHeight: 'min(70vh, 720px)', border: '1px solid var(--border)' }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ background: 'linear-gradient(180deg, #e0f2fe, #eef2ff)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>الوقت</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المريض</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المقدّم</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>القسم</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>الإجراء</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>القناة</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>عملة التحصيل</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'left' }} dir="ltr">مستلم ل.س</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'left' }} dir="ltr">مستلم USD</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>مستحق</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>فرق تسوية</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>ترجيع</th>
                    <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المحصّل</th>
                  </tr>
                </thead>
                <tbody>
                  {d.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={13} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        لا توجد عمليات تحصيل مؤكدة لهذا اليوم بعد.
                      </td>
                    </tr>
                  ) : (
                    d.transactions.map((t, idx) => {
                      const cashRow = t.paymentChannel === 'cash'
                      const bg = cashRow ? (idx % 2 === 0 ? 'rgba(22,163,74,0.06)' : 'rgba(22,163,74,0.1)') : idx % 2 === 0 ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.1)'
                      return (
                        <tr key={t.paymentId} style={{ background: bg }}>
                          <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{formatTime(t.paidAt)}</td>
                          <td style={{ padding: '0.5rem', fontWeight: 600 }}>{t.patientName}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {t.providerName}
                          </td>
                          <td style={{ padding: '0.5rem' }}>{t.departmentLabel}</td>
                          <td style={{ padding: '0.5rem', maxWidth: 160, color: 'var(--text-muted)' }}>{t.procedureLabel}</td>
                          <td style={{ padding: '0.5rem' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '0.12rem 0.45rem',
                                borderRadius: 999,
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                background: cashRow ? 'var(--success-dim)' : 'var(--violet-dim)',
                                color: cashRow ? 'var(--success)' : 'var(--violet)',
                              }}
                            >
                              {cashRow ? 'كاش' : `بنك: ${t.bankName}`}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem', fontWeight: 700 }}>{t.payCurrency === 'USD' ? 'USD' : 'ل.س'}</td>
                          <td style={{ padding: '0.5rem', direction: 'ltr', textAlign: 'left' }}>
                            {t.receivedAmountSyp.toLocaleString('ar-SY')}
                          </td>
                          <td style={{ padding: '0.5rem', direction: 'ltr', textAlign: 'left' }}>
                            {t.receivedAmountUsd > 0 ? t.receivedAmountUsd.toFixed(2) : '—'}
                          </td>
                          <td style={{ padding: '0.5rem' }}>{t.amountDueSyp.toLocaleString('ar-SY')}</td>
                          <td
                            style={{
                              padding: '0.5rem',
                              fontWeight: 600,
                              color: t.settlementDeltaSyp > 0 ? 'var(--success)' : t.settlementDeltaSyp < 0 ? 'var(--danger)' : 'var(--text-muted)',
                            }}
                          >
                            {t.settlementDeltaSyp > 0 ? '+' : ''}
                            {t.settlementDeltaSyp.toLocaleString('ar-SY')}
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.8rem' }}>
                            {t.patientRefundSyp > 0 || t.patientRefundUsd > 0 ? (
                              <>
                                {t.patientRefundSyp > 0 ? `${t.patientRefundSyp.toLocaleString('ar-SY')} ل.س` : null}
                                {t.patientRefundSyp > 0 && t.patientRefundUsd > 0 ? ' + ' : null}
                                {t.patientRefundUsd > 0 ? `${t.patientRefundUsd.toFixed(2)} USD` : null}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.receivedByName}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
