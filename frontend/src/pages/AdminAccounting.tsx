import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  formatAccountingTagsAr,
  formatBackfillSummary,
  formatDataTypeAr,
  formatDepartmentAr,
  formatSourceTypeAr,
  formatStepKeyAr,
  PROFILE_CODE_AR,
} from '../data/accountingDisplayAr'

type Profile = {
  code: string
  name: string
  department?: string
  active?: boolean
  accountingStandardTags?: string[]
  steps?: { order: number; key: string; expression: string; description?: string }[]
}

type ParamDef = {
  key: string
  label?: string
  dataType?: string
  allowedScopes?: string[]
  defaultNumber?: number | null
  defaultString?: string
}

type FinDoc = {
  _id: string
  businessDate: string
  department: string
  sourceType: string
  calculationProfileCode?: string
  lines?: { lineType: string; amountSyp: number }[]
}

const legendRows: { sym: string; ar: string }[] = [
  { sym: 'input.*', ar: 'قيم من العملية (مبلغ، حسم، تكلفة مواد، نسبة طبيب…)' },
  { sym: 'param.*', ar: 'معاملات النظام (مثل سقف الحسم)' },
  { sym: 'step.*', ar: 'نتيجة خطوة سابقة في نفس الملف' },
  { sym: 'round2', ar: 'تقريب لمنزلتين عشريتين' },
  { sym: 'min / max', ar: 'أقل / أكبر قيمة' },
]

export function AdminAccounting() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [definitions, setDefinitions] = useState<ParamDef[]>([])
  const [documents, setDocuments] = useState<FinDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busyBackfill, setBusyBackfill] = useState(false)

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const [p, d, doc] = await Promise.all([
        api<{ profiles: Profile[] }>('/api/accounting/profiles'),
        api<{ definitions: ParamDef[] }>('/api/accounting/parameter-definitions'),
        api<{ documents: FinDoc[] }>('/api/accounting/documents?limit=40'),
      ])
      setProfiles(p.profiles || [])
      setDefinitions(d.definitions || [])
      setDocuments(doc.documents || [])
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  const runBackfill = async () => {
    setBusyBackfill(true)
    setMsg('')
    try {
      const data = await api<{ result: Record<string, unknown> }>('/api/accounting/backfill', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setMsg(`اكتملت المزامنة — ${formatBackfillSummary(data.result)}`)
      await load()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'فشلت المزامنة')
    } finally {
      setBusyBackfill(false)
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">المحاسبة والمعاملات</h1>
        <p className="page-desc">هذه الصفحة للمدير فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">المحاسبة — ملفات الحساب والترحيل</h1>
      <p className="page-desc">
        معاملات ديناميكية (نِسَب، سقوف، ملفات حساب)، مستندات مالية غير قابلة للتعديل بعد الترحيل، وتقارير
        تستخدم البيانات المُرحَّلة عند توفرها.
      </p>

      <div className="toolbar" style={{ marginTop: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          تحديث
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busyBackfill}
          onClick={() => void runBackfill()}
        >
          {busyBackfill ? 'جاري المزامنة…' : 'مزامنة ترحيل (جلسات + زيارات)'}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p> : null}
      {msg ? (
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{msg}</p>
      ) : null}

      <div className="grid-2" style={{ marginTop: '1.25rem', alignItems: 'start' }}>
        <div className="card">
          <h2 className="card-title">تعريفات المعاملات</h2>
          <p className="page-desc" style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            كل معامل له اسم عربي ومعرّف تقني للنظام والصيغ.
          </p>
          {loading ? (
            <p>جاري التحميل…</p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              {definitions.map((d) => (
                <li
                  key={d.key}
                  style={{
                    padding: '0.55rem 0.65rem',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--bg)',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                    {d.label?.trim() || 'بدون عنوان'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    <span>النوع: {formatDataTypeAr(d.dataType)}</span>
                    <span style={{ margin: '0 0.35rem', opacity: 0.5 }}>|</span>
                    <span dir="ltr" style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {d.key}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="card-title">ملفات الحساب (خطوات الحساب)</h2>
          <p className="page-desc" style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            الوصف العربي يوضح المعنى؛ الصيغة التقنية للمراجعة والتدقيق.
          </p>
          <details
            style={{
              marginBottom: '0.85rem',
              padding: '0.45rem 0.55rem',
              border: '1px dashed var(--border)',
              borderRadius: 8,
              fontSize: '0.8rem',
            }}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>معاني الرموز في الصيغ</summary>
            <ul style={{ margin: '0.5rem 0 0', paddingRight: '1.1rem', color: 'var(--text-muted)' }}>
              {legendRows.map((r) => (
                <li key={r.sym} style={{ marginBottom: '0.25rem' }}>
                  <code dir="ltr" style={{ fontSize: '0.72rem' }}>
                    {r.sym}
                  </code>
                  {' — '}
                  {r.ar}
                </li>
              ))}
            </ul>
          </details>
          {loading ? (
            <p>جاري التحميل…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {profiles.map((p) => (
                <details
                  key={p.code}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '0.55rem 0.7rem',
                    background: 'var(--surface)',
                  }}
                >
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>{p.name || '—'}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                      <span
                        className="chip"
                        dir="ltr"
                        style={{ fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace' }}
                      >
                        {p.code}
                      </span>
                      {PROFILE_CODE_AR[p.code] ? (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {PROFILE_CODE_AR[p.code]}
                        </span>
                      ) : null}
                    </div>
                  </summary>
                  {p.accountingStandardTags?.length ? (
                    <p style={{ fontSize: '0.82rem', color: 'var(--cyan)', margin: '0.45rem 0 0.35rem' }}>
                      {formatAccountingTagsAr(p.accountingStandardTags)}
                    </p>
                  ) : null}
                  <ol
                    style={{
                      margin: '0.5rem 0 0',
                      paddingRight: '1.15rem',
                      fontSize: '0.88rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.55rem',
                    }}
                  >
                    {[...(p.steps || [])]
                      .sort((a, b) => a.order - b.order)
                      .map((s) => (
                        <li key={`${p.code}-${s.order}-${s.key}`} style={{ lineHeight: 1.45 }}>
                          <div style={{ fontWeight: 600 }}>{s.description?.trim() || formatStepKeyAr(s.key)}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                            المرحلة: {formatStepKeyAr(s.key)}
                            <span dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', marginRight: '0.25rem' }}>
                              ({s.key})
                            </span>
                          </div>
                          <details style={{ marginTop: '0.35rem' }}>
                            <summary
                              style={{
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)',
                              }}
                            >
                              عرض الصيغة التقنية
                            </summary>
                            <pre
                              dir="ltr"
                              style={{
                                margin: '0.35rem 0 0',
                                padding: '0.45rem 0.5rem',
                                fontSize: '0.7rem',
                                overflow: 'auto',
                                borderRadius: 6,
                                background: 'var(--bg)',
                                border: '1px solid var(--border)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {s.expression}
                            </pre>
                          </details>
                        </li>
                      ))}
                  </ol>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">آخر المستندات المالية</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>القسم</th>
                <th>المصدر</th>
                <th>ملف الحساب</th>
                <th>صافي الإيراد (ل.س)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5}>جاري التحميل…</td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                    لا توجد مستندات — نفّذ «مزامنة ترحيل» أو أكمِل جلسة ليزر.
                  </td>
                </tr>
              ) : (
                documents.map((d) => {
                  const net = d.lines?.find((l) => l.lineType === 'net_revenue')
                  const clinic = d.lines?.find((l) => l.lineType === 'clinic_net')
                  const profileHint = d.calculationProfileCode
                    ? PROFILE_CODE_AR[d.calculationProfileCode] || d.calculationProfileCode
                    : '—'
                  return (
                    <tr key={d._id}>
                      <td>{d.businessDate}</td>
                      <td>{formatDepartmentAr(d.department)}</td>
                      <td>{formatSourceTypeAr(d.sourceType)}</td>
                      <td>
                        <span dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
                          {d.calculationProfileCode || '—'}
                        </span>
                        {profileHint !== d.calculationProfileCode && d.calculationProfileCode ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{profileHint}</div>
                        ) : null}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {(() => {
                          const v = net?.amountSyp ?? clinic?.amountSyp
                          if (v == null || !Number.isFinite(Number(v))) return '—'
                          return `${Number(v).toLocaleString('ar-SY')} ل.س`
                        })()}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
