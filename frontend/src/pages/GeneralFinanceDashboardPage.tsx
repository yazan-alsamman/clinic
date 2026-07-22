import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type DiscountRow = {
  billingItemId: string
  paymentId: string | null
  patientName: string
  procedureLabel: string
  department: string
  departmentLabel: string
  providerName: string
  listAmountDueSyp: number
  discountPercent: number
  effectiveAmountDueSyp: number
  discountValueSyp: number
  businessDate: string
  paidAt: string | null
}

type DashboardPayload = {
  from: string
  to: string
  filters: { department: string; providerUserId: string | null }
  overall: {
    totalRevenueSyp: number
    totalExpensesSyp: number
    totalProfitSyp: number
    totalDiscountsSyp?: number
  }
  discounts?: {
    totalDiscountSyp: number
    count: number
    rows: DiscountRow[]
  }
  laser: {
    totalRevenueSyp: number
    totalExpensesSyp: number
    totalProfitSyp: number
    highestRevenueSpecialist: { userId: string; name: string; revenueSyp: number } | null
  }
  dermatology: {
    totalRevenueSyp: number
    expensesTableSyp: number
    materialsTotalSyp: number
    totalExpensesSyp: number
    lauraShareSyp: number
    samerShareSyp: number
    lauraSessionRevenueSyp: number
    lauraMaterialSyp: number
    samerSessionRevenueSyp: number
    samerMaterialSyp: number
    totalProfitSyp: number
    clinicNetBeforeTableSyp: number
    sharePercent: number
  }
  skincare: { totalRevenueSyp: number; totalExpensesSyp: number; totalProfitSyp: number }
  dental: {
    totalRevenueSyp: number
    expensesTableSyp?: number
    labWorksTotalSyp?: number
    totalExpensesSyp: number
    ayhamShareSyp?: number
    iyadShareSyp?: number
    omarShareSyp?: number
    otherShareSyp?: number
    ayhamProceduresSyp?: number
    iyadProceduresSyp?: number
    omarProceduresSyp?: number
    doctorSharesTotalSyp?: number
    clinicRemainderAfterSharesSyp?: number
    totalProfitSyp: number
    sharePercent?: number
    doctors?: { userId: string | null; name: string; proceduresSyp: number; shareSyp: number }[]
  }
  solarium: { totalRevenueSyp: number; totalExpensesSyp: number; totalProfitSyp: number }
  general: { totalExpensesSyp: number; totalProfitSyp: number }
  charts: {
    revenueByDepartment: { key: string; label: string; revenueSyp: number }[]
    expensesByCategory: { key: string; label: string; expensesSyp: number }[]
  }
}

type PublicUser = { id: string; name: string; role: string; active: boolean }

function monthStartYmd(businessDate: string) {
  const d = String(businessDate || '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d.slice(0, 7)}-01`
  const x = new Date()
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(Math.round(n || 0))} ل.س`
}

function HorizontalBars({
  title,
  rows,
  color,
}: {
  title: string
  rows: { label: string; value: number }[]
  color: string
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)))
  return (
    <div className="card" style={{ minHeight: 120 }}>
      <h3 style={{ margin: '0 0 0.65rem', fontSize: '1rem' }}>{title}</h3>
      <div style={{ display: 'grid', gap: '0.45rem' }}>
        {rows.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>لا بيانات للعرض.</p>
        ) : (
          rows.map((r) => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 2 }}>
                <span>{r.label}</span>
                <span style={{ fontWeight: 700 }}>{fmtSyp(r.value)}</span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 6,
                  background: 'var(--surface-2, #f3f4f6)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.round((Math.abs(r.value) / max) * 100))}%`,
                    height: '100%',
                    background: color,
                    transition: 'width 0.25s ease',
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function GeneralFinanceDashboardPage() {
  const { user } = useAuth()
  const { businessDate } = useClinic()
  const allowed = user?.role === 'super_admin'

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [department, setDepartment] = useState<string>('all')
  const [providerUserId, setProviderUserId] = useState<string>('')
  const [users, setUsers] = useState<PublicUser[]>([])
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!from && businessDate) setFrom(monthStartYmd(businessDate))
    if (!to && businessDate) setTo(businessDate)
  }, [businessDate, from, to])

  useEffect(() => {
    if (!allowed) return
    void (async () => {
      try {
        const res = await api<{ users: PublicUser[] }>('/api/users')
        setUsers((res.users || []).filter((u) => u.active))
      } catch {
        setUsers([])
      }
    })()
  }, [allowed])

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!allowed || !from || !to) return
      const silent = Boolean(opts?.silent)
      if (!silent) {
        setLoading(true)
        setErr('')
      }
      try {
        const qs = new URLSearchParams({ from, to })
        if (department && department !== 'all') qs.set('department', department)
        if (providerUserId.trim()) qs.set('providerUserId', providerUserId.trim())
        const res = await api<DashboardPayload>(`/api/finance/dashboard?${qs.toString()}`)
        setData(res)
        if (!silent) setErr('')
      } catch (e) {
        if (!silent) {
          setData(null)
          setErr(e instanceof ApiError ? e.message : 'تعذر تحميل لوحة المالية')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [allowed, from, to, department, providerUserId],
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

  const providerOptions = useMemo(() => {
    return [...users].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [users])

  const revChartRows = useMemo(() => {
    const rows = data?.charts?.revenueByDepartment || []
    return rows.map((r) => ({ label: r.label, value: r.revenueSyp }))
  }, [data])

  const expChartRows = useMemo(() => {
    const rows = data?.charts?.expensesByCategory || []
    return rows.map((r) => ({ label: r.label, value: r.expensesSyp }))
  }, [data])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">لوحة المالية العامة</h1>
        <p className="page-desc">هذه الصفحة متاحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">لوحة المالية العامة</h1>
      <p className="page-desc">
        إيرادات التحصيل (البنود المسدّدة) ومصاريف الجداول الستة وأرباح الأقسام. تُحدَّث البيانات تلقائياً. جميع
        المبالغ بالليرة السورية.
      </p>

      <div
        className="toolbar"
        style={{
          marginTop: '0.9rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.55rem',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>من تاريخ</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>إلى تاريخ</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>القسم</span>
          <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="all">كل الأقسام</option>
            <option value="laser">الليزر</option>
            <option value="dermatology">الجلدية</option>
            <option value="skin">العناية بالبشرة</option>
            <option value="dental">الأسنان</option>
            <option value="solarium">السولاريوم</option>
            <option value="general">مصاريف عامة</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span>الطبيب / الأخصائي</span>
          <select className="input" value={providerUserId} onChange={(e) => setProviderUserId(e.target.value)}>
            <option value="">الكل</option>
            {providerOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.role}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load({})}>
          {loading ? 'جاري التحديث…' : 'تحديث'}
        </button>
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p> : null}

      <section style={{ marginTop: '1.1rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.65rem' }}>الملخص العام</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <div className="card" style={{ borderColor: '#34d399', background: 'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)' }}>
            <h3 style={{ margin: 0, color: '#065f46', fontSize: '0.95rem' }}>إجمالي الإيرادات</h3>
            <p style={{ margin: '0.4rem 0 0', fontWeight: 800, color: '#064e3b' }}>{fmtSyp(data?.overall.totalRevenueSyp || 0)}</p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#047857' }}>
              مجموع مبالغ التحصيل للبنود المسدّدة ضمن التصفية والنطاق الزمني.
            </p>
          </div>
          <div className="card" style={{ borderColor: '#fb923c', background: 'linear-gradient(160deg, #fff7ed 0%, #ffedd5 100%)' }}>
            <h3 style={{ margin: 0, color: '#9a3412', fontSize: '0.95rem' }}>إجمالي المصاريف</h3>
            <p style={{ margin: '0.4rem 0 0', fontWeight: 800, color: '#7c2d12' }}>{fmtSyp(data?.overall.totalExpensesSyp || 0)}</p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#9a3412' }}>مجموع جداول المصاريف الستة (حسب التصفية عند اختيار قسم).</p>
          </div>
          <div className="card" style={{ borderColor: '#60a5fa', background: 'linear-gradient(160deg, #eff6ff 0%, #dbeafe 100%)' }}>
            <h3 style={{ margin: 0, color: '#1e40af', fontSize: '0.95rem' }}>إجمالي الأرباح</h3>
            <p style={{ margin: '0.4rem 0 0', fontWeight: 800, color: '#1e3a8a' }}>{fmtSyp(data?.overall.totalProfitSyp || 0)}</p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#1d4ed8' }}>
              مجموع أرباح الأقسام المعروضة: الليزر، الجلدية (بعد حصص الأطباء وجدول مصاريف الجلدية)، البشرة، الأسنان، السولاريوم،
              والمصاريف العامة.
            </p>
          </div>
          <div className="card" style={{ borderColor: '#c084fc', background: 'linear-gradient(160deg, #faf5ff 0%, #f3e8ff 100%)' }}>
            <h3 style={{ margin: 0, color: '#6b21a8', fontSize: '0.95rem' }}>إجمالي الخصومات</h3>
            <p style={{ margin: '0.4rem 0 0', fontWeight: 800, color: '#581c87' }}>
              {fmtSyp(data?.overall.totalDiscountsSyp ?? data?.discounts?.totalDiscountSyp ?? 0)}
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#7e22ce' }}>
              مجموع فرق السعر النظامي عن السعر بعد الخصم للجلسات المسدّدة ضمن التصفية والنطاق الزمني
              {data?.discounts?.count != null ? ` (${data.discounts.count} جلسة).` : '.'}
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: '1.35rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.65rem' }}>الخصومات المطبّقة على الجلسات</h2>
        <p className="page-desc" style={{ marginTop: 0, marginBottom: '0.65rem' }}>
          كل جلسة سُدّد تحصيلها ضمن النطاق والتصفية وكان عليها خصم (نسبة أو فرق عن السعر النظامي).
        </p>
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="data-table" style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', padding: '0.65rem 0.75rem' }}>اسم المريض</th>
                <th style={{ textAlign: 'right', padding: '0.65rem 0.75rem' }}>نوع الجلسة</th>
                <th style={{ textAlign: 'right', padding: '0.65rem 0.75rem' }}>المقدم</th>
                <th style={{ textAlign: 'right', padding: '0.65rem 0.75rem' }}>سعر الجلسة النظامي</th>
                <th style={{ textAlign: 'right', padding: '0.65rem 0.75rem' }}>نسبة الخصم</th>
                <th style={{ textAlign: 'right', padding: '0.65rem 0.75rem' }}>سعر الجلسة بعد الخصم</th>
                <th style={{ textAlign: 'right', padding: '0.65rem 0.75rem' }}>تاريخ الجلسة</th>
              </tr>
            </thead>
            <tbody>
              {(data?.discounts?.rows || []).length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '0.9rem 0.75rem', color: 'var(--text-muted)' }}>
                    لا توجد خصومات مسجّلة ضمن النطاق والتصفية الحالية.
                  </td>
                </tr>
              ) : (
                (data?.discounts?.rows || []).map((row) => (
                  <tr key={row.billingItemId}>
                    <td style={{ padding: '0.55rem 0.75rem' }}>{row.patientName}</td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>
                      {row.procedureLabel}
                      {row.departmentLabel ? (
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {row.departmentLabel}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>{row.providerName}</td>
                    <td style={{ padding: '0.55rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtSyp(row.listAmountDueSyp)}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(row.discountPercent || 0).toLocaleString('ar-SY', {
                        maximumFractionDigits: 2,
                      })}
                      ٪
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtSyp(row.effectiveAmountDueSyp)}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                      {row.businessDate || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div
        style={{
          marginTop: '1rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <HorizontalBars title="الإيراد حسب القسم" rows={revChartRows} color="#0d9488" />
        <HorizontalBars title="المصاريف حسب جدول المصاريف" rows={expChartRows} color="#ea580c" />
      </div>

      <section style={{ marginTop: '1.35rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.65rem' }}>قسم الليزر</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي الإيرادات</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.laser.totalRevenueSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              مجموع مبالغ التحصيل لجلسات الليزر المسدّدة.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي المصاريف</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.laser.totalExpensesSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              مجموع جدول مصاريف الليزر.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي الربح</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.laser.totalProfitSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              إيراد الليزر − مصاريف الليزر.
            </p>
          </div>
          <div className="card" style={{ borderColor: '#a78bfa' }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>الأخصائي الأعلى إيراداً</h3>
            {data?.laser.highestRevenueSpecialist ? (
              <>
                <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{data.laser.highestRevenueSpecialist.name}</p>
                <p style={{ margin: '0.25rem 0 0' }}>{fmtSyp(data.laser.highestRevenueSpecialist.revenueSyp)}</p>
              </>
            ) : (
              <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)' }}>لا بيانات في النطاق.</p>
            )}
          </div>
        </div>
      </section>

      <section style={{ marginTop: '1.35rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.65rem' }}>قسم الجلدية</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي الإيرادات</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dermatology.totalRevenueSyp || 0)}</p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي المصاريف</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dermatology.totalExpensesSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              جدول مصاريف الجلدية ({fmtSyp(data?.dermatology.expensesTableSyp || 0)}) + تكلفة المواد (
              {fmtSyp(data?.dermatology.materialsTotalSyp || 0)}).
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>حصة الدكتورة لورا</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dermatology.lauraShareSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              (تحصيل جلسات الدكتورة لورا − مواد جلساتها) × {data?.dermatology.sharePercent ?? 50}٪ — التحصيل:{' '}
              {fmtSyp(data?.dermatology.lauraSessionRevenueSyp || 0)}، المواد: {fmtSyp(data?.dermatology.lauraMaterialSyp || 0)}.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>حصة الدكتور سامر</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dermatology.samerShareSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              (تحصيل جلسات الدكتور سامر − مواد جلساته) × {data?.dermatology.sharePercent ?? 50}٪ — التحصيل:{' '}
              {fmtSyp(data?.dermatology.samerSessionRevenueSyp || 0)}، المواد: {fmtSyp(data?.dermatology.samerMaterialSyp || 0)}.
            </p>
          </div>
          <div className="card" style={{ gridColumn: '1 / -1', borderColor: '#22c55e' }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي ربح الجلدية للمركز</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dermatology.totalProfitSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              صافي المركز بعد احتساب حصص الأطباء وتكلفة مواد الجلسات الأخرى (قبل جدول مصاريف الجلدية:{' '}
              {fmtSyp(data?.dermatology.clinicNetBeforeTableSyp || 0)}) ثم خصم جدول مصاريف الجلدية.
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: '1.35rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.65rem' }}>قسم العناية بالبشرة</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي الإيرادات</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.skincare.totalRevenueSyp || 0)}</p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي المصاريف</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.skincare.totalExpensesSyp || 0)}</p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إجمالي الربح</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.skincare.totalProfitSyp || 0)}</p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: '1.35rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.65rem' }}>قسم الأسنان</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>إيرادات القسم</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dental.totalRevenueSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              مجموع تكلفة إجراءات مخطط الأسنان ضمن النطاق.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>نسبة د. أيهم</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dental.ayhamShareSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              إجراءاته ({fmtSyp(data?.dental.ayhamProceduresSyp || 0)}) × {data?.dental.sharePercent ?? 40}٪.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>نسبة د. إياد</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dental.iyadShareSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              إجراءاته ({fmtSyp(data?.dental.iyadProceduresSyp || 0)}) × {data?.dental.sharePercent ?? 40}٪.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>نسبة د. عمر</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dental.omarShareSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              إجراءاته ({fmtSyp(data?.dental.omarProceduresSyp || 0)}) × {data?.dental.sharePercent ?? 40}٪.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>مجموع مبالغ المخابر</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dental.labWorksTotalSyp || 0)}</p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>جدول مصاريف الأسنان</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dental.expensesTableSyp || 0)}</p>
          </div>
          <div className="card" style={{ gridColumn: '1 / -1', borderColor: '#22c55e' }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>الربح الصافي لقسم الأسنان</h3>
            <p style={{ margin: '0.35rem 0 0', fontWeight: 800 }}>{fmtSyp(data?.dental.totalProfitSyp || 0)}</p>
            <p className="page-desc" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
              إيرادات القسم − حصص الأطباء ({fmtSyp(data?.dental.doctorSharesTotalSyp || 0)}) − المخابر (
              {fmtSyp(data?.dental.labWorksTotalSyp || 0)}) − جدول المصاريف ({fmtSyp(data?.dental.expensesTableSyp || 0)}
              ). المتبقي بعد الحصص قبل المخابر: {fmtSyp(data?.dental.clinicRemainderAfterSharesSyp || 0)}.
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: '1.35rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.65rem' }}>أقسام إضافية</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>السولاريوم</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>إيراد: {fmtSyp(data?.solarium.totalRevenueSyp || 0)}</p>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem' }}>مصاريف: {fmtSyp(data?.solarium.totalExpensesSyp || 0)}</p>
            <p style={{ margin: '0.15rem 0 0', fontWeight: 700 }}>ربح: {fmtSyp(data?.solarium.totalProfitSyp || 0)}</p>
          </div>
          <div className="card">
            <h3 style={{ margin: 0, fontSize: '0.92rem' }}>مصاريف عامة</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>إجمالي المصاريف: {fmtSyp(data?.general.totalExpensesSyp || 0)}</p>
            <p style={{ margin: '0.15rem 0 0', fontWeight: 700 }}>تأثير الربح: {fmtSyp(data?.general.totalProfitSyp || 0)}</p>
          </div>
        </div>
      </section>
    </>
  )
}
