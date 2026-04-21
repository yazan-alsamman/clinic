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

export function AdminLaserPage() {
  const { user } = useAuth()
  const { businessDate } = useClinic()
  const allowed = user?.role === 'super_admin'
  const [date, setDate] = useState('')
  const [rows, setRows] = useState<DailyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!date && businessDate) setDate(businessDate)
  }, [businessDate, date])

  const totalShots = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.totalShots) || 0), 0),
    [rows],
  )

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const q = date ? `?date=${encodeURIComponent(date)}` : ''
      const data = await api<{ date: string; rows: DailyRow[] }>(`/api/laser/shots-daily${q}`)
      setRows(data.rows || [])
      if (!date && data.date) setDate(data.date)
    } catch (e) {
      setRows([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل التقرير')
    } finally {
      setLoading(false)
    }
  }, [allowed, date])

  useEffect(() => {
    void load()
  }, [load])

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
      <h1 className="page-title">ليزر — مجموع الضربات اليومي</h1>
      <p className="page-desc">يتم جمع الضربات من الجلسات المنتهية لكل أخصائي ليزر حسب تاريخ اليوم.</p>

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
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'جاري التحديث…' : 'تحديث'}
        </button>
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p> : null}

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
              {loading ? (
                <tr>
                  <td colSpan={4}>جاري التحميل…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                    لا يوجد أخصائيو ليزر مسجلون.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
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
    </>
  )
}
