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
  collectedSyp: number
  materialCostSypPriced: number
  materialCostUsdPriced: number
  materialCostSypTotal: number
}

type ProviderShareBlock = {
  providerLabel: string
  sessionRevenueSyp: number
  materialCostSyp: number
  netAfterMaterialSyp: number
  payableShareSyp: number
  clinicShareSyp: number
}

type FinanceSummary = {
  period: Period
  from: string
  to: string
  label: string
  sharePercent: number
  totals: {
    collectedRevenueSyp: number
    materialExpenseSypFromSypPricedItems: number
    materialExpenseUsdFromUsdPricedItems: number
  }
  loraShare: ProviderShareBlock
  samerShare: ProviderShareBlock
  others: {
    sessionRevenueSyp: number
    materialCostSyp: number
    clinicKeepsSyp: number
  }
  clinicNetSyp: number
  rows: FinanceRow[]
  notes: string[]
}

function renderSyp(value: number) {
  return `${Math.round(Number(value) || 0).toLocaleString('ar-SY')} ل.س`
}

function renderUsd(value: number) {
  const n = Number(value) || 0
  const t = Math.round(n * 100) / 100
  return `${t.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USD`
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

  const hasOthers = useMemo(() => {
    if (!data) return false
    return (Number(data.others?.sessionRevenueSyp) || 0) > 0
  }, [data])

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!allowed) return
      const silent = Boolean(opts?.silent)
      if (!silent) {
        setLoading(true)
        setErr('')
      }
      try {
        const q =
          period === 'daily'
            ? `period=daily&date=${encodeURIComponent(date || businessDate || '')}`
            : `period=monthly&month=${encodeURIComponent(month || '')}`
        const res = await api<FinanceSummary>(`/api/dermatology/finance-summary?${q}`)
        setData(res)
        setErr('')
      } catch (e) {
        if (!silent) {
          setData(null)
          setErr(e instanceof ApiError ? e.message : 'تعذر تحميل التقرير المالي')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [allowed, period, date, month, businessDate],
  )

  useEffect(() => {
    if (!allowed) return
    void load()
  }, [allowed, load])

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

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">مالية الجلدية</h1>
        <p className="page-desc">هذه الصفحة متاحة لمدير النظام ورئيس قسم الجلدية فقط.</p>
      </>
    )
  }

  const pct = Number(data?.sharePercent ?? 50)

  return (
    <>
      <h1 className="page-title">مالية الجلدية</h1>
      <p className="page-desc">
        أرقام مبنية على تحصيل الاستقبال لبنود الجلدية المسدّدة في النطاق، وتكلفة المواد من الجلسات المرتبطة، وحصص
        50% لد.لورا ود.سامر بعد خصم المواد.
      </p>

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
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load({})}>
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
            {renderSyp(data?.totals.collectedRevenueSyp || 0)}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#047857' }}>
            مجموع مبالغ التحصيل (استقبال) لجميع الجلسات الجلدية المسدّدة في النطاق — يتحدّث مع كل تحصيل.
          </p>
        </div>

        <div className="card" style={{ borderColor: '#fb923c', background: 'linear-gradient(160deg, #fff7ed 0%, #ffedd5 100%)' }}>
          <h3 style={{ margin: 0, color: '#9a3412' }}>إجمالي المصاريف (مواد)</h3>
          <p style={{ margin: '0.45rem 0 0', fontWeight: 700, color: '#7c2d12' }}>
            مواد بسعر ليرة: {renderSyp(data?.totals.materialExpenseSypFromSypPricedItems || 0)}
          </p>
          <p style={{ margin: '0.25rem 0 0', fontWeight: 700, color: '#9a3412' }}>
            مواد بسعر دولار (تقدير بالدولار): {renderUsd(data?.totals.materialExpenseUsdFromUsdPricedItems || 0)}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#c2410c' }}>
            يُستند إلى سطور المواد في الجلسة وسعر المخزون (ليرة أو دولار) وسعر الصرف لليوم عند الحاجة.
          </p>
        </div>

        <div className="card" style={{ borderColor: '#e879f9', background: 'linear-gradient(160deg, #fdf4ff 0%, #fae8ff 100%)' }}>
          <h3 style={{ margin: 0, color: '#86198f' }}>حصة الدكتورة لورا</h3>
          <p style={{ margin: '0.45rem 0 0', fontWeight: 900, color: '#701a75' }}>
            {renderSyp(data?.loraShare?.payableShareSyp || 0)}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#a21caf' }}>
            (جلساتها {renderSyp(data?.loraShare?.sessionRevenueSyp || 0)} − مواد {renderSyp(data?.loraShare?.materialCostSyp || 0)}) ={' '}
            {renderSyp(data?.loraShare?.netAfterMaterialSyp || 0)} × {pct}% = {renderSyp(data?.loraShare?.payableShareSyp || 0)}
          </p>
        </div>

        <div className="card" style={{ borderColor: '#0ea5e9', background: 'linear-gradient(160deg, #ecfeff 0%, #cffafe 100%)' }}>
          <h3 style={{ margin: 0, color: '#0c4a6e' }}>حصة الدكتور سامر</h3>
          <p style={{ margin: '0.45rem 0 0', fontWeight: 900, color: '#0c4a6e' }}>
            {renderSyp(data?.samerShare?.payableShareSyp || 0)}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#0369a1' }}>
            (جلساته {renderSyp(data?.samerShare?.sessionRevenueSyp || 0)} − مواد {renderSyp(data?.samerShare?.materialCostSyp || 0)}) ={' '}
            {renderSyp(data?.samerShare?.netAfterMaterialSyp || 0)} × {pct}% = {renderSyp(data?.samerShare?.payableShareSyp || 0)}
          </p>
        </div>

        <div className="card" style={{ borderColor: '#818cf8', background: 'linear-gradient(160deg, #eef2ff 0%, #e0e7ff 100%)' }}>
          <h3 style={{ margin: 0, color: '#3730a3' }}>صافي الربح للمركز</h3>
          <p style={{ margin: '0.45rem 0 0', fontWeight: 900, color: '#312e81' }}>{renderSyp(data?.clinicNetSyp || 0)}</p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#4f46e5' }}>
            50% المتبقية من صافي د.لورا ({renderSyp(data?.loraShare?.clinicShareSyp || 0)}) + 50% المتبقية من صافي د.سامر (
            {renderSyp(data?.samerShare?.clinicShareSyp || 0)})
            {hasOthers ? ` + جلسات أخرى (${renderSyp(data?.others?.clinicKeepsSyp || 0)})` : ''}.
          </p>
        </div>
      </div>

      {hasOthers ? (
        <p style={{ marginTop: '0.75rem', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          يوجد تحصيل لجلدية بمقدّمين آخرين: إيراد {renderSyp(data?.others?.sessionRevenueSyp || 0)} — مواد{' '}
          {renderSyp(data?.others?.materialCostSyp || 0)} — يُحسب صافيهم بالكامل لصالح المركز ضمن «صافي الربح».
        </p>
      ) : null}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">تفصيل التحصيلات</h2>
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
                <th>المحصّل</th>
                <th>مواد (ل.س)</th>
                <th>مواد (USD)</th>
                <th>إجمالي مواد</th>
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
                    لا توجد تحصيلات جلدية مسدّدة في هذا النطاق.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.businessDate || '—'}</td>
                    <td>{row.patientName || '—'}</td>
                    <td>{row.providerName || '—'}</td>
                    <td style={{ color: '#047857', fontWeight: 700 }}>{renderSyp(row.collectedSyp)}</td>
                    <td style={{ color: '#b45309' }}>{renderSyp(row.materialCostSypPriced)}</td>
                    <td style={{ color: '#0369a1' }}>{renderUsd(row.materialCostUsdPriced)}</td>
                    <td style={{ color: '#57534e' }}>{renderSyp(row.materialCostSypTotal)}</td>
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
