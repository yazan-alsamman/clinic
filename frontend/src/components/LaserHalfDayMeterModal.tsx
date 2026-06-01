import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'

export function LaserHalfDayMeterModal({
  open,
  room,
  allowDismiss = false,
  onDismiss,
  onRecorded,
}: {
  open: boolean
  room: 1 | 2
  /** مدير النظام يمكنه الخروج؛ الاستقبال لا */
  allowDismiss?: boolean
  onDismiss?: () => void
  onRecorded: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) {
      setValue('')
      setErr('')
      setBusy(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (allowDismiss) {
        onDismiss?.()
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prev
    }
  }, [open, allowDismiss, onDismiss])

  if (!open) return null

  const n = parseFloat(normalizeDecimalDigits(value))
  const ok = Number.isFinite(n) && n >= 0 && !busy

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`half-day-title-r${room}`}
      style={{ zIndex: 1200 }}
      onMouseDown={(e) => {
        if (!allowDismiss) return
        if (e.target === e.currentTarget) onDismiss?.()
      }}
    >
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3 id={`half-day-title-r${room}`} style={{ color: 'var(--danger)', marginTop: 0 }}>
          قراءة عدّاد نصف اليوم — غرفة {room}
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          قامت أخصائية وردية الصباح بتسجيل الخروج. أدخل قراءة عدّاد الجهاز الحالية لهذه الغرفة (قراءة نصف اليوم)
          ليتم التحقق من تطابق الضربات للفترة الصباحية والمسائية.
        </p>
        <label className="form-label" htmlFor={`half-day-meter-r${room}`}>
          عداد الجهاز — غرفة {room}
        </label>
        <input
          id={`half-day-meter-r${room}`}
          className="input"
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={(e) => {
            setErr('')
            setValue(e.target.value)
          }}
          autoFocus
        />
        {err ? (
          <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{err}</p>
        ) : null}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {allowDismiss ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDismiss?.()}>
              إغلاق
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ok}
            onClick={async () => {
              setBusy(true)
              setErr('')
              try {
                await api('/api/system/record-laser-half-day-meter', {
                  method: 'POST',
                  body: JSON.stringify({ room, meterReading: n }),
                })
                onRecorded()
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : 'تعذر حفظ القراءة.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'جاري الحفظ…' : 'حفظ القراءة'}
          </button>
        </div>
      </div>
    </div>
  )
}
