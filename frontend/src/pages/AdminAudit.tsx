import { useEffect, useState } from 'react'
import { api } from '../api/client'

type LogRow = { id: string; user: string; action: string; entity: string; time: string }

export function AdminAudit() {
  const [userFilter, setUserFilter] = useState('')
  const [from, setFrom] = useState('')
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const q = new URLSearchParams()
        if (userFilter.trim()) q.set('user', userFilter.trim())
        if (from) q.set('from', from)
        const data = await api<{ logs: LogRow[] }>(`/api/audit?${q.toString()}`)
        if (!cancelled) setLogs(data.logs)
      } catch {
        if (!cancelled) setLogs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userFilter, from])

  return (
    <>
      <h1 className="page-title">سجل النشاط</h1>
      <p className="page-desc">مراقبة تحركات الموظفين — للمدير فقط</p>
      <div className="toolbar">
        <input
          className="input"
          placeholder="تصفية بالمستخدم..."
          style={{ maxWidth: 220 }}
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
        />
        <input
          type="date"
          className="input"
          style={{ width: 'auto' }}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>المستخدم</th>
              <th>الإجراء</th>
              <th>الكيان</th>
              <th>الوقت</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4}>جاري التحميل…</td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td>{l.user}</td>
                  <td>{l.action}</td>
                  <td>{l.entity}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{l.time}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
