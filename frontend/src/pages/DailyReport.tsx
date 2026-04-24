import { useCallback, useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

type DailyRow = {
  operationNumber: string
  patientName: string
  areaTreatment: string
  sessionType: string
  costSyp: number
  discountPercent: number
  providerName: string
  finalSyp: number | null
  notes: string
}

type DailyReportPayload = {
  date: string
  rows: DailyRow[]
  reportingBasis?: string
}

const REPORT_ROLES = ['super_admin'] as const

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatSyp(n: number) {
  return new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(n)
}

function escapeHtml(text: string): string {
  const e = document.createElement('div')
  e.textContent = text
  return e.innerHTML
}

function buildTableBodyHtml(rows: DailyRow[]) {
  return rows
    .map(
      (r) =>
        `<tr>
      <td>${escapeHtml(r.operationNumber)}</td>
      <td>${escapeHtml(r.patientName)}</td>
      <td>${escapeHtml(r.areaTreatment)}</td>
      <td>${escapeHtml(r.sessionType)}</td>
      <td>${escapeHtml(formatSyp(Number(r.costSyp) || 0))} ل.س</td>
      <td>${escapeHtml(String(r.discountPercent))}%</td>
      <td>${escapeHtml(r.providerName)}</td>
      <td>${r.finalSyp != null ? escapeHtml(formatSyp(r.finalSyp)) + ' ل.س' : '—'}</td>
      <td>${escapeHtml(r.notes)}</td>
    </tr>`,
    )
    .join('')
}

function openPrintableReport(payload: { date: string; rows: DailyRow[] }) {
  const thead = `<tr>
    <th>رقم العملية</th><th>المريض</th><th>المنطقة / المعالجة</th><th>نوع الجلسة</th>
    <th>الكلفة (ل.س)</th><th>الحسم</th><th>المسؤول</th><th>الصافي (ل.س)</th><th>ملاحظات</th>
  </tr>`
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>تقرير الجرد اليومي ${escapeHtml(payload.date)}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 16px; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    .meta { font-size: 0.9rem; color: #333; margin-bottom: 14px; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { border: 1px solid #222; padding: 6px 8px; text-align: right; vertical-align: top; }
    th { background: #e8e8e8; }
  </style>
</head>
<body>
  <h1>تقرير الجرد اليومي — ${escapeHtml(payload.date)}</h1>
  <div class="meta">جميع المبالغ بالليرة السورية (ل.س).</div>
  <table>
    <thead>${thead}</thead>
    <tbody>${buildTableBodyHtml(payload.rows)}</tbody>
  </table>
</body>
</html>`
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => {
    w.print()
    w.close()
  }, 300)
}

export function DailyReport() {
  const { user } = useAuth()
  const allowed = user?.role && REPORT_ROLES.includes(user.role as (typeof REPORT_ROLES)[number])

  const [date, setDate] = useState(todayYmd)
  const [rows, setRows] = useState<DailyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const q = new URLSearchParams({ date })
      const data = await api<DailyReportPayload>(`/api/reports/daily?${q}`)
      setRows(data.rows)
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

  const exportExcel = () => {
    const headers = [
      'رقم العملية',
      'المريض',
      'المنطقة / المعالجة',
      'نوع الجلسة',
      'الكلفة (ل.س)',
      'الحسم %',
      'المسؤول',
      'الصافي (ل.س)',
      'ملاحظات',
    ]
    const aoa: (string | number)[][] = [
      headers,
      ...rows.map((r) => [
        r.operationNumber,
        r.patientName,
        r.areaTreatment,
        r.sessionType,
        r.costSyp,
        r.discountPercent,
        r.providerName,
        r.finalSyp ?? '',
        r.notes,
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'daily')
    XLSX.writeFile(wb, `inventory-daily-${date}.xlsx`)
  }

  const exportPdf = () => {
    openPrintableReport({ date, rows })
  }

  const printPage = () => window.print()

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">تقرير الجرد اليومي</h1>
        <p className="page-desc">لا تملك صلاحية عرض هذا التقرير.</p>
      </>
    )
  }

  return (
    <>
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <input
          type="date"
          className="input"
          style={{ width: 'auto' }}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="button" className="btn btn-secondary" disabled={loading || rows.length === 0} onClick={exportPdf}>
          تصدير PDF
        </button>
        <button type="button" className="btn btn-secondary" disabled={loading || rows.length === 0} onClick={exportExcel}>
          Excel
        </button>
        <button type="button" className="btn btn-secondary" disabled={loading || rows.length === 0} onClick={printPage}>
          طباعة
        </button>
      </div>
      {err ? (
        <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p>
      ) : null}
      <div id="daily-report-print">
        <h1 className="page-title">تقرير الجرد اليومي</h1>
        <p className="page-desc">نهاية الدوام — جميع الأقسام — المبالغ بالليرة السورية</p>
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>رقم العملية</th>
                <th>المريض</th>
                <th>المنطقة / المعالجة</th>
                <th>نوع الجلسة</th>
                <th>الكلفة (ل.س)</th>
                <th>الحسم</th>
                <th>المسؤول</th>
                <th>الصافي (ل.س)</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9}>جاري التحميل…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                    لا توجد عمليات مكتملة أو زيارات جلدية مسجّلة لهذا التاريخ
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.operationNumber}-${i}`}>
                    <td>{r.operationNumber}</td>
                    <td>{r.patientName}</td>
                    <td>{r.areaTreatment}</td>
                    <td>{r.sessionType}</td>
                    <td>{formatSyp(Number(r.costSyp) || 0)} ل.س</td>
                    <td>{r.discountPercent}%</td>
                    <td>{r.providerName}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.finalSyp != null ? `${formatSyp(r.finalSyp)} ل.س` : '—'}
                    </td>
                    <td style={{ maxWidth: 160, whiteSpace: 'normal' }}>{r.notes}</td>
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
