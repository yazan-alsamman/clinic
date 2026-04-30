import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type Period = 'daily' | 'monthly'

type FinanceRow = {
  id: string
  businessDate: string
  patientName: string
  providerName: string
  sourceType: string
  netRevenueSyp: number
  materialCostSyp: number
  doctorShareSyp: number
  clinicNetSyp: number
}

type FinanceSummary = {
  period: Period
  from: string
  to: string
  label: string
  totals: {
    netRevenueSyp: number
    materialCostSyp: number
    doctorShareSyp: number
    clinicNetSyp: number
  }
  rows: FinanceRow[]
  notes: string[]
}

function renderSyp(value: number) {
  return `${Math.round(Number(value) || 0).toLocaleString('ar-SY')} ل.س`
}

export function DermatologyFinancePage() {
  const { user } = useAuth()
  const { businessDate } = useClinic()
  const allowed = user?.role === 'dermatology_manager' || user?.role === 'super_admin'
  const [period, setPeriod] = useState<Period>('daily')
  const [date, setDate] = useState('')
  const [month, setMonth] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [data, setData] = useState<FinanceSummary | null>(null)

  useEffect(() => {
    if (!date && businessDate) setDate(businessDate)
  }, [businessDate, date])
  useEffect(() => {
    if (!month && businessDate) setMonth(String(businessDate).slice(0, 7))
  }, [businessDate, month])

  const expenseTotal = useMemo(() => {
    if (!data) return 0
    return Math.round((Number(data.totals.materialCostSyp) || 0) + (Number(data.totals.doctorShareSyp) || 0))
  }, [data])

  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    setErr('')
    try {
      const q =
        period === 'daily'
          ? `period=daily&date=${encodeURIComponent(date || businessDate || '')}`
          : `period=monthly&month=${encodeURIComponent(month || '')}`
      const res = await api<FinanceSummary>(`/api/dermatology/finance-summary?${q}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل التقرير المالي')
    } finally {
      setLoading(false)
    }
  }, [allowed, period, date, month, businessDate])

  useEffect(() => {
    if (!allowed) return
    void load()
  }, [allowed, load])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">مالية الجلدية</h1>
        <p className="page-desc">هذه الصفحة متاحة لمدير النظام ورئيس قسم الجلدية فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">مالية الجلدية</h1>
      <p className="page-desc">تفصيل واضح للإيرادات والمصاريف وصافي الربح الخاص بعيادة الجلدية.</p>

      <div className="toolbar" style={{ marginTop: '0.95rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`tab${period === 'daily' ? ' active' : ''}`}
          onClick={() => setPeriod('daily')}
        >
          يومي
        </button>
        <button
          type="button"
          className={`tab${period === 'monthly' ? ' active' : ''}`}
          onClick={() => setPeriod('monthly')}
        >
          شهري
        </button>
        {period === 'daily' ? (
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 220 }} />
        ) : (
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 220 }} />
        )}
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'جاري التحديث…' : 'تحديث'}
        </button>
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p> : null}

      <div
        style={{
          marginTop: '1rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <div className="card" style={{ borderColor: '#34d399', background: 'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)' }}>
          <h3 style={{ margin: 0, color: '#065f46' }}>إجمالي الإيرادات</h3>
          <p style={{ margin: '0.45rem 0 0', fontWeight: 800, color: '#064e3b' }}>
            {renderSyp(data?.totals.netRevenueSyp || 0)}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#047857' }}>من مستندات الجلدية المرحلة فقط.</p>
        </div>
        <div className="card" style={{ borderColor: '#fb923c', background: 'linear-gradient(160deg, #fff7ed 0%, #ffedd5 100%)' }}>
          <h3 style={{ margin: 0, color: '#9a3412' }}>إجمالي المصاريف</h3>
          <p style={{ margin: '0.45rem 0 0', fontWeight: 800, color: '#7c2d12' }}>{renderSyp(expenseTotal)}</p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#c2410c' }}>كلفة المواد + حصة الطبيب.</p>
        </div>
        <div className="card" style={{ borderColor: '#818cf8', background: 'linear-gradient(160deg, #eef2ff 0%, #e0e7ff 100%)' }}>
          <h3 style={{ margin: 0, color: '#3730a3' }}>صافي الربح</h3>
          <p style={{ margin: '0.45rem 0 0', fontWeight: 900, color: '#312e81' }}>
            {renderSyp(data?.totals.clinicNetSyp || 0)}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#4f46e5' }}>الرقم النهائي المعتمد للعيادة.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">تفصيل العمليات المالية</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: '0.7rem' }}>
          النطاق: {data?.from || '—'} إلى {data?.to || '—'}.
        </p>
        {data?.notes?.length ? (
          <div style={{ marginBottom: '0.7rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            {data.notes.map((n) => (
              <p key={n} style={{ margin: '0 0 0.25rem' }}>
                • {n}
              </p>
            ))}
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المريض</th>
                <th>الطبيب</th>
                <th>الإيراد</th>
                <th>مواد</th>
                <th>حصة طبيب</th>
                <th>الصافي</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>جاري التحميل…</td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                    لا توجد بيانات في هذا النطاق.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.businessDate || '—'}</td>
                    <td>{row.patientName || '—'}</td>
                    <td>{row.providerName || '—'}</td>
                    <td style={{ color: '#047857', fontWeight: 700 }}>{renderSyp(row.netRevenueSyp)}</td>
                    <td style={{ color: '#b45309' }}>{renderSyp(row.materialCostSyp)}</td>
                    <td style={{ color: '#c2410c' }}>{renderSyp(row.doctorShareSyp)}</td>
                    <td style={{ color: '#3730a3', fontWeight: 800 }}>{renderSyp(row.clinicNetSyp)}</td>
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
