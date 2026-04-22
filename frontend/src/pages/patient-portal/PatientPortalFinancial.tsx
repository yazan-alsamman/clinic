import { useEffect, useMemo, useState } from 'react'
import { patientApi } from '../../api/client'

type FinancialEntry = {
  id: string
  businessDate: string
  procedureLabel: string
  amountDueUsd: number
  receivedAmountUsd: number
  settlementDeltaUsd: number
  settlementType: 'exact' | 'debt' | 'credit'
  method: string
  receivedAt: string | null
}

type FinancialPayload = {
  summary: {
    outstandingDebtUsd: number
    prepaidCreditUsd: number
  }
  entries: FinancialEntry[]
}

function money(usd: number) {
  return `${(Number(usd) || 0).toFixed(2)} USD`
}

const settlementTypeAr: Record<FinancialEntry['settlementType'], string> = {
  exact: 'مطابقة',
  debt: 'ذمة',
  credit: 'رصيد إضافي',
}

export function PatientPortalFinancial() {
  const [data, setData] = useState<FinancialPayload | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await patientApi<FinancialPayload>('/api/patient-portal/financial')
        if (!cancelled) {
          setData(d)
          setErr('')
        }
      } catch {
        if (!cancelled) setErr('تعذر تحميل البيانات المالية')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const openEntries = useMemo(() => {
    if (!data) return []
    return data.entries.filter((x) => Math.abs(Number(x.settlementDeltaUsd) || 0) > 0.0001)
  }, [data])

  if (err) {
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
      </div>
    )
  }

  if (!data) {
    return <div style={{ color: 'var(--text-muted)' }}>جاري التحميل…</div>
  }

  return (
    <>
      <div className="patient-hero">
        <h1>المالية</h1>
        <p>عرض الرصيد الإضافي والذمم مع تفاصيل الحركات المالية الخاصة بملفك.</p>
      </div>

      <div className="patient-stat-grid">
        <div className="patient-stat">
          <div className="n" style={{ color: 'var(--danger)' }}>
            {money(data.summary.outstandingDebtUsd)}
          </div>
          <div className="l">الذمم المستحقة</div>
        </div>
        <div className="patient-stat">
          <div className="n" style={{ color: 'var(--success)' }}>
            {money(data.summary.prepaidCreditUsd)}
          </div>
          <div className="l">الرصيد الإضافي</div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">تفاصيل الحركة المالية</h2>
        {openEntries.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            لا توجد تفاصيل مالية مفتوحة حالياً.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>البيان</th>
                  <th>المستحق</th>
                  <th>المدفوع</th>
                  <th>الفرق</th>
                  <th>النوع</th>
                </tr>
              </thead>
              <tbody>
                {openEntries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.businessDate || '—'}</td>
                    <td>{e.procedureLabel || '—'}</td>
                    <td>{money(e.amountDueUsd)}</td>
                    <td>{money(e.receivedAmountUsd)}</td>
                    <td>{money(e.settlementDeltaUsd)}</td>
                    <td>{settlementTypeAr[e.settlementType] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
