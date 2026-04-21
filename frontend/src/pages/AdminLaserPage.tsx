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

export function AdminLaserPage() {
  const { user } = useAuth()
  const { businessDate } = useClinic()
  const allowed = user?.role === 'super_admin'
  const [tab, setTab] = useState<LaserTab>('shots')
  const [date, setDate] = useState('')
  const [shotRows, setShotRows] = useState<DailyRow[]>([])
  const [shotLoading, setShotLoading] = useState(false)
  const [shotErr, setShotErr] = useState('')
  const [financeRows, setFinanceRows] = useState<FinanceRow[]>([])
  const [financeLoading, setFinanceLoading] = useState(false)
  const [financeErr, setFinanceErr] = useState('')
  const [topSpecialist, setTopSpecialist] = useState<{ name: string; totalAmountUsd: number } | null>(null)

  useEffect(() => {
    if (!date && businessDate) setDate(businessDate)
  }, [businessDate, date])

  const totalShots = useMemo(
    () => shotRows.reduce((sum, r) => sum + (Number(r.totalShots) || 0), 0),
    [shotRows],
  )
  const totalFinanceUsd = useMemo(
    () => financeRows.reduce((sum, r) => sum + (Number(r.totalAmountUsd) || 0), 0),
    [financeRows],
  )

  const loadShots = useCallback(async () => {
    if (!allowed) return
    setShotErr('')
    setShotLoading(true)
    try {
      const q = date ? `?date=${encodeURIComponent(date)}` : ''
      const data = await api<{ date: string; rows: DailyRow[] }>(`/api/laser/shots-daily${q}`)
      setShotRows(data.rows || [])
      if (!date && data.date) setDate(data.date)
    } catch (e) {
      setShotRows([])
      setShotErr(e instanceof ApiError ? e.message : 'تعذر تحميل تقرير الضربات')
    } finally {
      setShotLoading(false)
    }
  }, [allowed, date])

  const loadFinancial = useCallback(async () => {
    if (!allowed) return
    setFinanceErr('')
    setFinanceLoading(true)
    try {
      const q = date ? `?date=${encodeURIComponent(date)}` : ''
      const data = await api<{
        date: string
        rows: FinanceRow[]
        topSpecialist: { userId: string; name: string; totalAmountUsd: number } | null
      }>(`/api/laser/finance-daily${q}`)
      setFinanceRows(data.rows || [])
      setTopSpecialist(data.topSpecialist ? { name: data.topSpecialist.name, totalAmountUsd: data.topSpecialist.totalAmountUsd } : null)
      if (!date && data.date) setDate(data.date)
    } catch (e) {
      setFinanceRows([])
      setTopSpecialist(null)
      setFinanceErr(e instanceof ApiError ? e.message : 'تعذر تحميل التقرير المالي')
    } finally {
      setFinanceLoading(false)
    }
  }, [allowed, date])

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
      <p className="page-desc">متابعة يومية لأداء الأخصائيين (ضربات ومالية) حسب التاريخ.</p>

      <div
        className="toolbar"
        style={{ marginTop: '0.95rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
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
            تاريخ التقرير: {date || '—'}
          </h2>
          <div style={{ marginBottom: '0.8rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            مجموع ضربات جميع الأخصائيين: <strong style={{ color: 'var(--text)' }}>{totalShots}</strong>
          </div>
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
              الأعلى مبلغًا — تاريخ {date || '—'}
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
                    {Number(topSpecialist.totalAmountUsd || 0).toFixed(2)} USD
                  </div>
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>لا يوجد بيانات مالية لهذا اليوم.</span>
              )}
            </div>
          </div>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title" style={{ marginBottom: '0.55rem' }}>
              مالية جلسات الليزر — تاريخ {date || '—'}
            </h2>
            <div style={{ marginBottom: '0.8rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              مجموع أسعار جلسات جميع الأخصائيين:{' '}
              <strong style={{ color: 'var(--text)' }}>{totalFinanceUsd.toFixed(2)} USD</strong>
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
                        <td>{Number(r.totalAmountUsd || 0).toFixed(2)} USD</td>
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
