import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useClinic } from '../context/ClinicContext'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'

export function CloseDayModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { endDay } = useClinic()
  const [room1Input, setRoom1Input] = useState('')
  const [room2Input, setRoom2Input] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) {
      setRoom1Input('')
      setRoom2Input('')
      setConfirmText('')
      setErr('')
    }
  }, [open])

  if (!open) return null

  const r1 = parseFloat(normalizeDecimalDigits(room1Input))
  const r2 = parseFloat(normalizeDecimalDigits(room2Input))
  const metersOk =
    Number.isFinite(r1) &&
    r1 >= 0 &&
    Number.isFinite(r2) &&
    r2 >= 0
  const confirmOk = confirmText.trim().toLowerCase() === 'close'
  const canSubmit = metersOk && confirmOk && !busy

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>إغلاق وأرشفة اليوم</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          أدخل قراءة عداد الجهاز لكل غرفة في <strong>نهاية</strong> هذا اليوم، ثم اكتب{' '}
          <strong>close</strong> بالإنجليزية للتأكيد النهائي.
        </p>
        <label className="form-label" htmlFor="close-meter-r1">
          عداد الجهاز — غرفة 1 (نهاية اليوم)
        </label>
        <input
          id="close-meter-r1"
          className="input"
          inputMode="decimal"
          dir="ltr"
          value={room1Input}
          onChange={(e) => {
            setErr('')
            setRoom1Input(e.target.value)
          }}
        />
        <label className="form-label" htmlFor="close-meter-r2" style={{ marginTop: '0.75rem' }}>
          عداد الجهاز — غرفة 2 (نهاية اليوم)
        </label>
        <input
          id="close-meter-r2"
          className="input"
          inputMode="decimal"
          dir="ltr"
          value={room2Input}
          onChange={(e) => {
            setErr('')
            setRoom2Input(e.target.value)
          }}
        />
        <label className="form-label" htmlFor="close-confirm" style={{ marginTop: '0.75rem' }}>
          تأكيد إغلاق اليوم
        </label>
        <input
          id="close-confirm"
          className="input"
          placeholder="close"
          value={confirmText}
          onChange={(e) => {
            setErr('')
            setConfirmText(e.target.value)
          }}
          autoComplete="off"
          dir="ltr"
        />
        {err ? (
          <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{err}</p>
        ) : null}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginTop: '1rem',
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!canSubmit}
            onClick={async () => {
              setBusy(true)
              setErr('')
              try {
                await endDay({
                  room1MeterEnd: r1,
                  room2MeterEnd: r2,
                  confirm: confirmText.trim(),
                })
                onClose()
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : 'تعذر إغلاق اليوم.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'جاري الإغلاق…' : 'إغلاق اليوم'}
          </button>
        </div>
      </div>
    </div>
  )
}
