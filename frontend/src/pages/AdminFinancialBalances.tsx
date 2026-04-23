import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

type DeptFilter = '' | 'laser' | 'dermatology' | 'dental'

type FinRow = {
  id: string
  fileNumber: string
  name: string
  departments: string[]
  outstandingDebtUsd: number
  prepaidCreditUsd: number
}

function moneyDual(usdRaw: number, rateRaw: number | null | undefined) {
  const usd = Number(usdRaw) || 0
  const usdText = `${usd.toFixed(2)} USD`
  const rate = Number(rateRaw || 0)
  const sypText =
    rate > 0 ? `${Math.round(usd * rate).toLocaleString('ar-SY')} ل.س` : null
  return { usdText, sypText }
}

function deptLabel(d: string) {
  const m: Record<string, string> = {
    laser: 'الليزر',
    dermatology: 'الجلدية',
    dental: 'الأسنان',
    solarium: 'سولاريوم',
  }
  return m[d] ?? d
}

function departmentsCell(depts: string[]) {
  if (!depts?.length) return '—'
  return depts.map(deptLabel).join('، ')
}

export function AdminFinancialBalances() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'
  const [debtDept, setDebtDept] = useState<DeptFilter>('')
  const [creditDept, setCreditDept] = useState<DeptFilter>('')
  const [debts, setDebts] = useState<FinRow[]>([])
  const [credits, setCredits] = useState<FinRow[]>([])
  const [usdSypRate, setUsdSypRate] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (debtDept) qs.set('debtDepartment', debtDept)
      if (creditDept) qs.set('creditDepartment', creditDept)
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      const data = await api<{ debts: FinRow[]; credits: FinRow[]; usdSypRate?: number | null }>(
        `/api/patients/financial-balances${suffix}`,
      )
      setDebts(Array.isArray(data.debts) ? data.debts : [])
      setCredits(Array.isArray(data.credits) ? data.credits : [])
      const r = data.usdSypRate
      setUsdSypRate(r != null && Number.isFinite(Number(r)) ? Number(r) : null)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر التحميل')
      setDebts([])
      setCredits([])
    } finally {
      setLoading(false)
    }
  }, [allowed, debtDept, creditDept])

  useEffect(() => {
    void load()
  }, [load])

  const debtTotal = useMemo(
    () => debts.reduce((s, r) => s + (Number(r.outstandingDebtUsd) || 0), 0),
    [debts],
  )
  const creditTotal = useMemo(
    () => credits.reduce((s, r) => s + (Number(r.prepaidCreditUsd) || 0), 0),
    [credits],
  )

  const filterSelect = (value: DeptFilter, onChange: (v: DeptFilter) => void) => (
    <select
      className="input"
      style={{ minWidth: '11rem', fontSize: '0.9rem' }}
      value={value}
      onChange={(e) => onChange(e.target.value as DeptFilter)}
    >
      <option value="">كل الأقسام</option>
      <option value="laser">الليزر</option>
      <option value="dental">الأسنان</option>
      <option value="dermatology">الجلدية</option>
    </select>
  )

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">ذمم مالية</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">ذمم مالية</h1>
      <p className="page-desc">
        عرض المرضى الذين لديهم ذمم مستحقة أو رصيد إضافي، مع تصفية حسب أقسام الملف (ليزر / أسنان / جلدية).
      </p>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          تحديث
        </button>
        {err ? (
          <span style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{err}</span>
        ) : null}
      </div>

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <h2 className="card-title" style={{ margin: 0 }}>
            الذمم المالية
          </h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>تصفية القسم</span>
            {filterSelect(debtDept, setDebtDept)}
          </label>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
          إجمالي الظاهر: <strong>{debtTotal.toFixed(2)} USD</strong>
          {usdSypRate && usdSypRate > 0 ? (
            <>
              {' '}
              ≈{' '}
              <strong>{Math.round(debtTotal * usdSypRate).toLocaleString('ar-SY')} ل.س</strong>
            </>
          ) : null}
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الإضبارة</th>
                <th>الاسم</th>
                <th>أقسام الملف</th>
                <th>مبلغ الذمة (USD)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4}>جاري التحميل…</td>
                </tr>
              ) : debts.length === 0 ? (
                <tr>
                  <td colSpan={4}>لا توجد ذمم ضمن التصفية الحالية.</td>
                </tr>
              ) : (
                debts.map((r) => {
                  const m = moneyDual(r.outstandingDebtUsd, usdSypRate)
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/patients/${r.id}`}>{r.fileNumber || '—'}</Link>
                      </td>
                      <td>
                        <Link to={`/patients/${r.id}`}>{r.name || '—'}</Link>
                      </td>
                      <td style={{ fontSize: '0.88rem' }}>{departmentsCell(r.departments)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{m.usdText}</span>
                        {m.sypText ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{m.sypText}</div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <h2 className="card-title" style={{ margin: 0 }}>
            الرصيد الإضافي
          </h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>تصفية القسم</span>
            {filterSelect(creditDept, setCreditDept)}
          </label>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
          إجمالي الظاهر: <strong>{creditTotal.toFixed(2)} USD</strong>
          {usdSypRate && usdSypRate > 0 ? (
            <>
              {' '}
              ≈{' '}
              <strong>{Math.round(creditTotal * usdSypRate).toLocaleString('ar-SY')} ل.س</strong>
            </>
          ) : null}
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الإضبارة</th>
                <th>الاسم</th>
                <th>أقسام الملف</th>
                <th>الرصيد الإضافي (USD)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4}>جاري التحميل…</td>
                </tr>
              ) : credits.length === 0 ? (
                <tr>
                  <td colSpan={4}>لا يوجد رصيد إضافي ضمن التصفية الحالية.</td>
                </tr>
              ) : (
                credits.map((r) => {
                  const m = moneyDual(r.prepaidCreditUsd, usdSypRate)
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/patients/${r.id}`}>{r.fileNumber || '—'}</Link>
                      </td>
                      <td>
                        <Link to={`/patients/${r.id}`}>{r.name || '—'}</Link>
                      </td>
                      <td style={{ fontSize: '0.88rem' }}>{departmentsCell(r.departments)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--success)' }}>{m.usdText}</span>
                        {m.sypText ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{m.sypText}</div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
