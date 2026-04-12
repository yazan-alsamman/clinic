import { useEffect, useState } from 'react'
import { patientApi } from '../../api/client'
import { todayBusinessDate } from '../../utils/businessDate'
import './patient-portal.css'

type Clinical = {
  appointments: {
    id: string
    businessDate: string
    time: string
    endTime: string
    providerName: string
    procedureType: string
  }[]
}

export function PatientPortalAppointments() {
  const [rows, setRows] = useState<Clinical['appointments']>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await patientApi<Clinical>('/api/patient-portal/clinical')
        if (!cancelled) {
          setRows(d.appointments || [])
          setErr('')
        }
      } catch {
        if (!cancelled) setErr('تعذر تحميل المواعيد')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const today = todayBusinessDate()
  const upcoming = rows.filter((a) => String(a.businessDate) >= today)
  const past = rows.filter((a) => String(a.businessDate) < today)

  if (err) {
    return <div className="card"><p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p></div>
  }

  function block(title: string, list: Clinical['appointments']) {
    return (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title">{title}</h2>
        {list.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>لا توجد عناصر.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {list.map((a) => (
              <li
                key={a.id}
                style={{
                  padding: '0.75rem 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '0.9rem',
                }}
              >
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{a.businessDate}</strong>
                {' — '}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{a.time}</span>
                {a.endTime ? ` — ${a.endTime}` : ''}
                <div style={{ color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {a.procedureType || 'موعد'} · {a.providerName}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="patient-hero" style={{ marginBottom: '1rem' }}>
        <h1>مواعيدي</h1>
        <p>المواعيد المحجوزة لدى العيادة كما هي مسجّلة في النظام.</p>
      </div>
      {block('القادمة والحالية', upcoming)}
      {block('السابقة', past)}
    </>
  )
}
