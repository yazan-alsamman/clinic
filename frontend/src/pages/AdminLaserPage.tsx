import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

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
  totalAmountUsd: number
  sessionsCount: number
}
type LaserTab = 'shots' | 'financial'
type ReportPeriod = 'daily' | 'monthly'

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
  const { businessDate, usdSypRate } = useClinic()
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
  const [topSpecialist, setTopSpecialist] = useState<{ name: string; totalAmountUsd: number } | null>(null)

  useEffect(() => {
    if (!date && businessDate) setDate(businessDate)
  }, [businessDate, date])
  useEffect(() => {
    if (!month && businessDate) setMonth(String(businessDate).slice(0, 7))
  }, [businessDate, month])

  const totalFinanceUsd = useMemo(
    () => financeRows.reduce((sum, r) => sum + (Number(r.totalAmountUsd) || 0), 0),
    [financeRows],
  )
  const fxRate = Number(usdSypRate || 0)
  const renderMoneyDual = (usdValue: number) => {
    const usd = Number(usdValue) || 0
    const usdText = `${usd.toFixed(2)} USD`
    const sypText =
      fxRate > 0 ? `${(usd * fxRate).toLocaleString('ar-SY', { maximumFractionDigits: 0 })} ل.س` : '— ل.س'
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.1rem' }}>
        <span>{usdText}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>{sypText}</span>
      </span>
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
        topSpecialist: { userId: string; name: string; totalAmountUsd: number } | null
      }>(`${endpoint}${q}`)
      setFinanceRows(data.rows || [])
      setTopSpecialist(data.topSpecialist ? { name: data.topSpecialist.name, totalAmountUsd: data.topSpecialist.totalAmountUsd } : null)
      if (period === 'daily' && !date && data.date) setDate(data.date)
      if (period === 'monthly' && !month && data.month) setMonth(data.month)
    } catch (e) {
      setFinanceRows([])
      setTopSpecialist(null)
      setFinanceErr(e instanceof ApiError ? e.message : 'تعذر تحميل التقرير المالي')
    } finally {
      setFinanceLoading(false)
    }
  }, [allowed, date, month, period])

  useEffect(() => {
    if (tab === 'shots') {
      void loadShots()
      return
    }
    void loadFinancial()
  }, [tab, loadShots, loadFinancial])

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
          disabled={tab === 'shots' ? shotLoading : financeLoading}
          onClick={() => {
            if (tab === 'shots') {
              void loadShots()
              return
            }
            void loadFinancial()
          }}
        >
          {tab === 'shots'
            ? shotLoading
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
          onClick={() => setPeriod('daily')}
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
      ) : (
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
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{renderMoneyDual(topSpecialist.totalAmountUsd || 0)}</div>
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
            <div style={{ marginBottom: '0.8rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              مجموع أسعار جلسات جميع الأخصائيين:{' '}
              <strong style={{ color: 'var(--text)' }}>{renderMoneyDual(totalFinanceUsd)}</strong>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الأخصائي</th>
                    <th>مجموع أسعار الجلسات</th>
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
                        <td>{renderMoneyDual(Number(r.totalAmountUsd || 0))}</td>
                        <td>{Number(r.sessionsCount) || 0}</td>
                        <td>{r.active ? 'فعّال' : 'غير فعّال'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
