import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

type InsightLine = {
  date: string
  patientName: string
  source: string
  sourceLabel: string
  description: string
  revenueDeptLabel: string
  grossSyp: number
  discountPercent: number
  netSyp: number
  appliedSharePercent: number
  shareSyp: number
  explanation: string
}

type InsightDoctor = {
  userId: string
  name: string
  role: string
  department: string
  sharePercent: number
  totalShareSyp: number
  lines: InsightLine[]
}

type InsightsPayload = {
  startDate: string
  endDate: string
  totalRevenueSyp: number
  totalDoctorSharesSyp: number
  estimatedNetProfitSyp: number
  topDepartment: { key: string | null; label: string; revenueSyp: number }
  revenueByDepartment: { key: string; label: string; revenueSyp: number; lineCount: number }[]
  doctors: InsightDoctor[]
  reportingBasis?: 'posted_ledger' | 'operational_estimate'
}

function monthStartYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)} ل.س`
}

function escapeHtml(text: string): string {
  const e = document.createElement('div')
  e.textContent = text
  return e.innerHTML
}

function buildInsightsPdfHtml(data: InsightsPayload) {
  const revRows = data.revenueByDepartment
    .filter((r) => r.lineCount > 0 || r.revenueSyp > 0)
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(String(r.lineCount))}</td><td>${escapeHtml(fmtSyp(r.revenueSyp))}</td></tr>`,
    )
    .join('')

  const doctorSections = data.doctors
    .map((doc) => {
      const lineRows = doc.lines
        .map(
          (ln) =>
            `<tr>
            <td>${escapeHtml(ln.date)}</td>
            <td>${escapeHtml(ln.patientName)}</td>
            <td>${escapeHtml(ln.sourceLabel)}</td>
            <td>${escapeHtml(ln.description)}</td>
            <td>${escapeHtml(ln.revenueDeptLabel)}</td>
            <td>${escapeHtml(fmtSyp(ln.grossSyp))}</td>
            <td>${escapeHtml(String(ln.discountPercent))}%</td>
            <td>${escapeHtml(fmtSyp(ln.netSyp))}</td>
            <td>${escapeHtml(String(ln.appliedSharePercent))}%</td>
            <td>${escapeHtml(fmtSyp(ln.shareSyp))}</td>
          </tr>`,
        )
        .join('')
      const explainRows = doc.lines
        .map(
          (ln) =>
            `<li><strong>${escapeHtml(ln.date)}</strong> — ${escapeHtml(ln.patientName)}: ${escapeHtml(ln.explanation)} → ${escapeHtml(fmtSyp(ln.shareSyp))}</li>`,
        )
        .join('')
      return `
        <section style="margin-top:18px;page-break-inside:avoid">
          <h2 style="font-size:14px;margin:0 0 8px">${escapeHtml(doc.name)} — ${escapeHtml(doc.department)} — النسبة المعرفة: ${doc.sharePercent}% — الإجمالي: ${escapeHtml(fmtSyp(doc.totalShareSyp))}</h2>
          <p style="font-size:11px;color:#333;margin:0 0 6px">تفصيل الاستحقاق (من أين جاء كل مبلغ):</p>
          <ul style="font-size:10px;margin:0 0 10px;padding-right:18px">${explainRows}</ul>
          <table>
            <thead>
              <tr>
                <th>التاريخ</th><th>المريض</th><th>المصدر</th><th>الوصف</th><th>قسم الإيراد</th>
                <th>إجمالي</th><th>حسم</th><th>صافي</th><th>نسبة</th><th>المستحق</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
        </section>`
    })
    .join('')

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>ذكاء الأعمال ${escapeHtml(data.startDate)} — ${escapeHtml(data.endDate)}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 14px; font-size: 12px; }
    h1 { font-size: 17px; margin: 0 0 10px; }
    .kpi { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .kpi div { border: 1px solid #333; padding: 8px 12px; min-width: 140px; }
    .kpi .l { font-size: 10px; color: #444; }
    .kpi .v { font-size: 15px; font-weight: 700; margin-top: 4px; }
    table { border-collapse: collapse; width: 100%; font-size: 10px; }
    th, td { border: 1px solid #222; padding: 5px 6px; text-align: right; vertical-align: top; }
    th { background: #e8e8e8; }
    .note { font-size: 10px; color: #444; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>تقرير ذكاء الأعمال</h1>
  <p style="margin:0 0 12px">الفترة: ${escapeHtml(data.startDate)} إلى ${escapeHtml(data.endDate)}</p>
  <div class="kpi">
    <div><div class="l">صافي الربح (تقديري)</div><div class="v">${escapeHtml(fmtSyp(data.estimatedNetProfitSyp))}</div></div>
    <div><div class="l">إجمالي الإيرادات (صافي الأسطر)</div><div class="v">${escapeHtml(fmtSyp(data.totalRevenueSyp))}</div></div>
    <div><div class="l">مجموع مستحقات الأطباء</div><div class="v">${escapeHtml(fmtSyp(data.totalDoctorSharesSyp))}</div></div>
    <div><div class="l">أكثر قسم إيراداً</div><div class="v">${escapeHtml(data.topDepartment.label)} (${escapeHtml(fmtSyp(data.topDepartment.revenueSyp))})</div></div>
  </div>
  <h2 style="font-size:14px;margin:16px 0 8px">الإيراد حسب القسم</h2>
  <table>
    <thead><tr><th>القسم</th><th>عدد الأسطر</th><th>الصافي (ل.س)</th></tr></thead>
    <tbody>${revRows || '<tr><td colspan="3">لا بيانات</td></tr>'}</tbody>
  </table>
  ${doctorSections}
  <p class="note">الصافي لكل سطر = الكلفة × (1 − نسبة الحسم/100). المستحق = الصافي × (نسبة الاستحقاق المعرفة للمستخدم في إدارة المستخدمين / 100). لا يشمل التقرير تكاليف مواد المستودع.</p>
</body>
</html>`
}

function openInsightsPdf(data: InsightsPayload) {
  const html = buildInsightsPdfHtml(data)
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => {
    w.print()
    w.close()
  }, 400)
}

export function InsightsPage() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'

  const [startDate, setStartDate] = useState(monthStartYmd)
  const [endDate, setEndDate] = useState(todayYmd)
  const [data, setData] = useState<InsightsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const q = new URLSearchParams({ start: startDate, end: endDate })
      const res = await api<InsightsPayload>(`/api/reports/insights?${q}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }, [allowed, startDate, endDate])

  useEffect(() => {
    void load()
  }, [load])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">ذكاء الأعمال</h1>
        <p className="page-desc">هذه الصفحة للمدير فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">ذكاء الأعمال</h1>
      <p className="page-desc">للمدير فقط — أرباح، حصص أطباء، أكثر الأقسام ربحاً</p>
      {data?.reportingBasis === 'posted_ledger' ? (
        <p className="page-desc" style={{ marginTop: '-0.35rem', color: 'var(--cyan)' }}>
          يعتمد على المستندات المالية المُرحَّلة في النطاق (دقة أعلى).
        </p>
      ) : data?.reportingBasis === 'operational_estimate' ? (
        <p className="page-desc" style={{ marginTop: '-0.35rem', color: 'var(--text-muted)' }}>
          تقدير تشغيلي — بعد الترحيل الكامل تُستخدم المستندات المالية تلقائياً.
        </p>
      ) : null}

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <label className="form-label" style={{ margin: 0 }}>
          من
          <input
            type="date"
            className="input"
            style={{ width: 'auto', marginRight: '0.35rem' }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="form-label" style={{ margin: 0 }}>
          إلى
          <input
            type="date"
            className="input"
            style={{ width: 'auto', marginRight: '0.35rem' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          تحديث
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || !data || (data.totalRevenueSyp <= 0 && data.doctors.length === 0)}
          onClick={() => data && openInsightsPdf(data)}
        >
          تصدير PDF
        </button>
      </div>

      {err ? (
        <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p>
      ) : null}

      {loading && !data ? (
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>جاري التحميل…</p>
      ) : data ? (
        <>
          <div className="grid-2" style={{ marginTop: '1rem' }}>
            <div className="stat-card">
              <div className="lbl">صافي الربح (تقديري)</div>
              <div className="val" style={{ color: 'var(--cyan)' }}>
                {fmtSyp(data.estimatedNetProfitSyp)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                إيرادات {fmtSyp(data.totalRevenueSyp)} − مستحقات {fmtSyp(data.totalDoctorSharesSyp)}
              </div>
            </div>
            <div className="stat-card">
              <div className="lbl">أكثر قسم إيراداً</div>
              <div className="val" style={{ fontSize: '1.1rem' }}>
                {data.topDepartment.label}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                {fmtSyp(data.topDepartment.revenueSyp)} في الفترة
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title">الإيراد حسب القسم</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>القسم</th>
                    <th>عدد العمليات</th>
                    <th>صافي الإيراد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revenueByDepartment.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td>{r.lineCount}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSyp(r.revenueSyp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title">حصص الأطباء والمختصين</h2>
            <p className="page-desc" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
              النسب مُعرَّفة في «المستخدمون». لكل طبيب: جدول يوضح من أي مريض/إجراء جاء كل جزء من المستحق.
            </p>
            {data.doctors.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>لا توجد أسطر إيراد في هذه الفترة.</p>
            ) : (
              data.doctors.map((doc) => (
                <div
                  key={doc.userId}
                  style={{
                    marginBottom: '1.25rem',
                    paddingBottom: '1rem',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'baseline' }}>
                    <strong>{doc.name}</strong>
                    <span className="chip">{doc.department}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      نسبة الاستحقاق: {doc.sharePercent}%
                    </span>
                    <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>{fmtSyp(doc.totalShareSyp)}</span>
                  </div>
                  <div className="table-wrap" style={{ marginTop: '0.65rem' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>المريض</th>
                          <th>المصدر</th>
                          <th>الوصف</th>
                          <th>صافي السطر</th>
                          <th>المستحق</th>
                          <th>كيفية الاحتساب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.lines.map((ln, i) => (
                          <tr key={`${ln.date}-${ln.patientName}-${i}`}>
                            <td>{ln.date}</td>
                            <td>{ln.patientName}</td>
                            <td>{ln.sourceLabel}</td>
                            <td style={{ maxWidth: 200, whiteSpace: 'normal', fontSize: '0.85rem' }}>
                              {ln.description}
                            </td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSyp(ln.netSyp)}</td>
                            <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSyp(ln.shareSyp)}</td>
                            <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: 220, whiteSpace: 'normal' }}>
                              {ln.explanation}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>

          <p className="page-desc" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
            التقدير لا يخصم تكاليف مواد المستودع. يمكن ضبط نسب الاستحقاق من صفحة المستخدمون للأدوار: ليزر، جلدية، أسنان.
          </p>
        </>
      ) : null}
    </>
  )
}
