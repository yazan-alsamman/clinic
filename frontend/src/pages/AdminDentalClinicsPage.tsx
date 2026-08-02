import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type ClinicSummary = {
  key: string
  userId: string | null
  providerKey: string
  name: string
  clinicLabel: string
  noShare: boolean
  treatmentCount: number
  labCount: number
  proceduresSyp: number
  paidSyp: number
  remainingSyp: number
  labsSyp: number
  shareSyp: number
  netToClinicSyp: number
}

type SessionRow = {
  kind: 'treatment' | 'lab'
  id: string
  patientId: string
  patientName: string
  fileNumber: string
  fdi: number
  businessDate: string
  clinicKey: string
  clinicLabel: string
  doctorName: string
  noShare: boolean
  procedureDescription: string
  totalCostSyp?: number
  totalCostUsd?: number
  paidSyp?: number
  remainingSyp?: number
  labName?: string
  amountSyp?: number
  payments?: {
    id: string
    amountSyp: number
    amountUsd: number
    currency: string
    paidAt: string
    note: string
  }[]
}

type Payload = {
  from: string
  to: string
  sharePercent: number
  clinics: ClinicSummary[]
  rows: SessionRow[]
  totals: {
    treatmentCount: number
    labCount: number
    proceduresSyp: number
    paidSyp: number
    remainingSyp: number
    labsSyp: number
  }
}

function monthStartYmd(businessDate: string) {
  const d = String(businessDate || '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d.slice(0, 7)}-01`
  const x = new Date()
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(Math.round(n || 0))} ل.س`
}

export function AdminDentalClinicsPage() {
  const { user } = useAuth()
  const { businessDate } = useClinic()
  const allowed = user?.role === 'super_admin'

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [clinicKey, setClinicKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [data, setData] = useState<Payload | null>(null)

  useEffect(() => {
    if (!from && businessDate) setFrom(monthStartYmd(businessDate))
    if (!to && businessDate) setTo(businessDate)
  }, [businessDate, from, to])

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!allowed) return
      const silent = Boolean(opts?.silent)
      if (!silent) {
        setLoading(true)
        setErr('')
      }
      try {
        const q = new URLSearchParams()
        q.set('from', from || monthStartYmd(businessDate || ''))
        q.set('to', to || businessDate || '')
        /** نجلب كل العيادات ثم نفلتر في الواجهة للإبقاء على قائمة العيادات كاملة */
        const res = await api<Payload>(`/api/dental/admin/clinics?${q.toString()}`)
        setData(res)
        setErr('')
      } catch (e) {
        if (!silent) {
          setData(null)
          setErr(e instanceof ApiError ? e.message : 'تعذر تحميل عيادات الأسنان')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [allowed, from, to, businessDate],
  )

  useEffect(() => {
    if (!allowed || !from || !to) return
    void load()
  }, [allowed, from, to, load])

  const selectedClinic = useMemo(() => {
    if (!data?.clinics?.length) return null
    if (clinicKey) return data.clinics.find((c) => c.key === clinicKey) || null
    return null
  }, [data, clinicKey])

  const visibleRows = useMemo(() => {
    if (!data?.rows) return []
    if (!clinicKey) return data.rows
    return data.rows.filter((r) => r.clinicKey === clinicKey)
  }, [data, clinicKey])

  const visibleTotals = useMemo(() => {
    if (!data) return null
    if (!selectedClinic) return data.totals
    return {
      treatmentCount: selectedClinic.treatmentCount,
      labCount: selectedClinic.labCount,
      proceduresSyp: selectedClinic.proceduresSyp,
      paidSyp: selectedClinic.paidSyp,
      remainingSyp: selectedClinic.remainingSyp,
      labsSyp: selectedClinic.labsSyp,
    }
  }, [data, selectedClinic])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">عيادات الأسنان</h1>
        <p className="page-desc">هذه الصفحة مخصصة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">عيادات الأسنان</h1>
      <p className="page-desc">تفاصيل كاملة لإجراءات كل عيادة (حسب الطبيب المعالج) ضمن النطاق المحدد.</p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.75rem',
            alignItems: 'end',
          }}
        >
          <div>
            <label className="form-label" htmlFor="dental-from">
              من تاريخ
            </label>
            <input
              id="dental-from"
              className="input"
              type="date"
              dir="ltr"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="dental-to">
              إلى تاريخ
            </label>
            <input
              id="dental-to"
              className="input"
              type="date"
              dir="ltr"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="dental-clinic">
              العيادة
            </label>
            <select
              id="dental-clinic"
              className="input"
              value={clinicKey}
              onChange={(e) => setClinicKey(e.target.value)}
            >
              <option value="">كل العيادات</option>
              {(data?.clinics || []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.clinicLabel}
                </option>
              ))}
            </select>
          </div>
          <div>
            <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
              {loading ? 'جاري التحميل…' : 'تحديث'}
            </button>
          </div>
        </div>
        {err ? <p style={{ color: 'var(--danger)', margin: '0.75rem 0 0' }}>{err}</p> : null}
      </div>

      <section style={{ marginBottom: '1.15rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem' }}>ملخص العيادات</h2>
        {!data?.clinics?.length && !loading ? (
          <p className="page-desc" style={{ margin: 0 }}>
            لا عيادات أسنان مسجّلة. أضف أطباء بدور «أسنان — فرع» من صفحة المستخدمين.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.65rem' }}>
            {(data?.clinics || []).map((c) => (
              <button
                key={c.key}
                type="button"
                className="card"
                onClick={() => setClinicKey(c.key === clinicKey ? '' : c.key)}
                style={{
                  textAlign: 'right',
                  cursor: 'pointer',
                  borderColor: clinicKey === c.key ? '#38bdf8' : undefined,
                  background: clinicKey === c.key ? 'rgba(56, 189, 248, 0.08)' : undefined,
                }}
              >
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{c.clinicLabel}</h3>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {c.treatmentCount} إجراء · {c.labCount} مخبر
                  {c.treatmentCount === 0 && c.labCount === 0 ? ' — لا بيانات في النطاق' : ''}
                </p>
                <p style={{ margin: '0.25rem 0 0', fontWeight: 700 }}>{fmtSyp(c.proceduresSyp)}</p>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {c.noShare
                    ? `بدون نسبة — صافي للقسم ${fmtSyp(c.netToClinicSyp)}`
                    : `نسبة الطبيب ${fmtSyp(c.shareSyp)} · متبقي ${fmtSyp(c.remainingSyp)}`}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      {visibleTotals ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.55rem',
            marginBottom: '1rem',
          }}
        >
          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>إجراءات</div>
            <div style={{ fontWeight: 800 }}>{visibleTotals.treatmentCount}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>إيراد الإجراءات</div>
            <div style={{ fontWeight: 800 }}>{fmtSyp(visibleTotals.proceduresSyp)}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>المدفوع</div>
            <div style={{ fontWeight: 800 }}>{fmtSyp(visibleTotals.paidSyp)}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>المتبقي</div>
            <div style={{ fontWeight: 800 }}>{fmtSyp(visibleTotals.remainingSyp)}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>المخابر</div>
            <div style={{ fontWeight: 800 }}>{fmtSyp(visibleTotals.labsSyp)}</div>
          </div>
        </div>
      ) : null}

      <section>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem' }}>
          {selectedClinic ? `تفاصيل ${selectedClinic.clinicLabel}` : 'تفاصيل كل الجلسات'}
        </h2>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>العيادة</th>
                  <th>المريض</th>
                  <th>السن</th>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th>التكلفة</th>
                  <th>المدفوع</th>
                  <th>المتبقي / المخبر</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <tr>
                    <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                      جاري التحميل…
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                      لا سجلات للعرض.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <td dir="ltr">{r.businessDate}</td>
                      <td>{r.clinicLabel}</td>
                      <td>
                        <Link to={`/patients/${r.patientId}?tab=dental`}>{r.patientName}</Link>
                        {r.fileNumber ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            إضبارة {r.fileNumber}
                          </div>
                        ) : null}
                      </td>
                      <td dir="ltr">{r.fdi || '—'}</td>
                      <td>{r.kind === 'lab' ? 'مخبر' : 'إجراء'}</td>
                      <td>
                        {r.kind === 'lab' ? (
                          <>
                            <div>{r.labName || '—'}</div>
                            {r.procedureDescription ? (
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                {r.procedureDescription}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          r.procedureDescription || '—'
                        )}
                      </td>
                      <td dir="ltr">
                        {r.kind === 'treatment' ? (
                          <>
                            {fmtSyp(r.totalCostSyp || 0)}
                            {(r.totalCostUsd || 0) > 0 ? (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {r.totalCostUsd} USD
                              </div>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td dir="ltr">{r.kind === 'treatment' ? fmtSyp(r.paidSyp || 0) : '—'}</td>
                      <td dir="ltr">
                        {r.kind === 'treatment' ? fmtSyp(r.remainingSyp || 0) : fmtSyp(r.amountSyp || 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  )
}
