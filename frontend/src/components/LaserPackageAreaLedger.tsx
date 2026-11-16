import { useState } from 'react'
import { api, ApiError } from '../api/client'
import type { LaserAddonService, LaserPackageLedger, LaserPackageLedgerResponse } from '../utils/laserPackageLedger'

function fmtDate(iso: string | null | undefined, fallback = '') {
  if (!iso) return fallback || '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? fallback || '—' : d.toLocaleDateString('ar-SY')
}

function money(n: number) {
  return `${Math.round(Number(n) || 0).toLocaleString('ar-SY')} ل.س`
}

function newRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** جدول رصيد كل منطقة + سجل الزيارات + إنقاص يدوي (بسبب) + تصحيح (مدير) */
export function LaserPackageAreaLedgerCard({
  patientId,
  ledger,
  role,
  onChanged,
}: {
  patientId: string
  ledger: LaserPackageLedger | undefined
  role: string | undefined
  onChanged: (next: LaserPackageLedgerResponse) => void
}) {
  const [manualOpen, setManualOpen] = useState(false)
  const [manualKeys, setManualKeys] = useState<Set<string>>(new Set())
  const [manualNote, setManualNote] = useState('')
  const [requestId, setRequestId] = useState(newRequestId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!ledger) return <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>جاري تحميل أرصدة المناطق…</p>
  const canManage = role === 'super_admin' || role === 'reception'

  async function submitManual() {
    if (!ledger) return
    setErr('')
    setBusy(true)
    try {
      const res = await api<{ ledger: LaserPackageLedgerResponse }>(
        `/api/patients/${encodeURIComponent(patientId)}/packages/${encodeURIComponent(ledger.packageId)}/area-deductions`,
        { method: 'POST', body: JSON.stringify({ areaKeys: [...manualKeys], note: manualNote.trim(), requestId }) },
      )
      onChanged(res.ledger)
      setManualOpen(false)
      setManualKeys(new Set())
      setManualNote('')
      setRequestId(newRequestId())
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر الإنقاص')
    } finally {
      setBusy(false)
    }
  }

  async function reverse(deductionId: string, label: string) {
    if (!ledger) return
    const reason = window.prompt(`سبب تصحيح إنقاص «${label}» (يبقى في السجل):`)
    if (!reason || !reason.trim()) return
    setBusy(true)
    setErr('')
    try {
      const res = await api<{ ledger: LaserPackageLedgerResponse }>(
        `/api/patients/${encodeURIComponent(patientId)}/packages/${encodeURIComponent(ledger.packageId)}/area-deductions/${encodeURIComponent(deductionId)}/reverse`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      )
      onChanged(res.ledger)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر التصحيح')
    } finally {
      setBusy(false)
    }
  }

  const legacyUnverified = ledger.areas.some((a) => a.legacyUnverifiedSessions > 0)

  return (
    <div style={{ display: 'grid', gap: '0.55rem' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.86rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'start' }}>
              <th style={{ textAlign: 'start', padding: '0.25rem' }}>المنطقة</th>
              <th style={{ padding: '0.25rem' }}>الإجمالي</th>
              <th style={{ padding: '0.25rem' }}>المستهلك</th>
              <th style={{ padding: '0.25rem' }}>المتبقي</th>
            </tr>
          </thead>
          <tbody>
            {ledger.areas.map((a) => (
              <tr key={a.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '0.3rem 0.25rem', fontWeight: 600 }}>{a.label}</td>
                <td style={{ textAlign: 'center' }}>{a.sessionsTotal}</td>
                <td style={{ textAlign: 'center' }}>{a.usedSessions}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: a.remainingSessions > 0 ? 'var(--text)' : 'var(--danger)' }}>
                  {a.remainingSessions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {legacyUnverified ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          جلسات قديمة ثُبّتت بالنظام السابق كجلسة كاملة دون تحديد المناطق — احتُسبت من كل منطقة كما كانت، ودون اختراع تاريخ علاج.
        </p>
      ) : null}

      {ledger.visits.length > 0 ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '0.86rem' }}>سجل الجلسات حسب الزيارة ({ledger.visits.length})</summary>
          <ul style={{ margin: '0.4rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.84rem', display: 'grid', gap: '0.3rem' }}>
            {ledger.visits.map((v) => (
              <li key={v.key}>
                <strong>{v.visitDate || fmtDate(v.date)}</strong>
                {v.source === 'legacy_session'
                  ? ' — جلسة قديمة (نظام سابق)'
                  : v.source === 'manual'
                    ? ' — إنقاص يدوي'
                    : v.treatmentNumber
                      ? ` — زيارة ليزر #${v.treatmentNumber}`
                      : ' — زيارة ليزر'}
                {': '}
                {v.areas.map((a, i) => (
                  <span key={`${a.key}-${i}`}>
                    {i > 0 ? '، ' : ''}
                    <span style={{ textDecoration: a.reversed ? 'line-through' : undefined }}>
                      {a.label}
                      {a.legacyUnverified ? ' (غير محددة)' : ''}
                    </span>
                    {a.reversed ? <span style={{ color: 'var(--text-muted)' }}> (مُصحَّح: {a.reverseReason})</span> : null}
                    {!a.reversed && a.deductionId && role === 'super_admin' ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0 0.35rem', marginInlineStart: '0.25rem' }}
                        disabled={busy}
                        onClick={() => void reverse(a.deductionId!, a.label)}
                      >
                        تصحيح
                      </button>
                    ) : null}
                  </span>
                ))}
                {v.byName ? <span style={{ color: 'var(--text-muted)' }}> — {v.byName}</span> : null}
                {v.note ? <span style={{ color: 'var(--text-muted)' }}> — {v.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>لم تُستهلك أي جلسة بعد.</p>
      )}

      {canManage && !ledger.suspended ? (
        manualOpen ? (
          <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '0.5rem 0.6rem', display: 'grid', gap: '0.4rem' }}>
            <div style={{ fontSize: '0.84rem' }}>
              إنقاص يدوي (لزيارة لم تُسجّل كجلسة ليزر). الإنقاص من زيارة مسجّلة يتم من صفحة التحصيل.
            </div>
            {ledger.areas.map((a) => (
              <label key={a.key} style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', fontSize: '0.86rem' }}>
                <input
                  type="checkbox"
                  disabled={busy || a.remainingSessions < 1}
                  checked={manualKeys.has(a.key)}
                  onChange={() =>
                    setManualKeys((prev) => {
                      const n = new Set(prev)
                      if (n.has(a.key)) n.delete(a.key)
                      else n.add(a.key)
                      return n
                    })
                  }
                />
                {a.label}
                <span style={{ color: 'var(--text-muted)' }}>
                  {manualKeys.has(a.key)
                    ? `المتبقي ${a.remainingSessions} ← ${a.remainingSessions - 1}`
                    : `المتبقي ${a.remainingSessions}`}
                </span>
              </label>
            ))}
            <input
              className="input"
              placeholder="السبب (إلزامي)"
              value={manualNote}
              disabled={busy}
              onChange={(e) => setManualNote(e.target.value)}
            />
            {err ? <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.84rem' }}>{err}</p> : null}
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || manualKeys.size === 0 || !manualNote.trim()}
                onClick={() => void submitManual()}
              >
                {busy ? 'جاري الإنقاص…' : `تأكيد إنقاص ${manualKeys.size} منطقة`}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setManualOpen(false)}>
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setManualOpen(true)}>
              إنقاص يدوي للمناطق
            </button>
            {err ? <p style={{ margin: '0.3rem 0 0', color: 'var(--danger)', fontSize: '0.84rem' }}>{err}</p> : null}
          </div>
        )
      ) : null}
    </div>
  )
}

/** الخدمات خارج الباكج: سعر ودفع مستقلان عن رصيد الباكج */
export function LaserAddonServicesList({ services }: { services: LaserAddonService[] }) {
  if (!services.length) return null
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.7rem 0.8rem' }}>
      <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>خدمات ليزر خارج الباكج</div>
      <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        مناطق عولجت خارج الباكج في زيارات الباكج — سعرها ودفعها مستقلان ولا تُنقص أي جلسة من الباكج.
      </p>
      <ul style={{ margin: 0, paddingInlineStart: '1.1rem', fontSize: '0.85rem', display: 'grid', gap: '0.25rem' }}>
        {services.map((s) => (
          <li key={s.id}>
            {s.businessDate || '—'} — {s.label.replace(/^ليزر — إضافات خارج الباكج:\s*/, '')} — {money(s.priceSyp)} —{' '}
            <span style={{ color: s.status === 'paid' ? 'var(--success)' : 'var(--warning)' }}>
              {s.status === 'paid' ? `مدفوع${s.paidAt ? ` (${fmtDate(s.paidAt)})` : ''}` : 'بانتظار التحصيل'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
