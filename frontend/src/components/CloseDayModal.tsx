import { useState } from 'react'
import { useClinic } from '../context/ClinicContext'

export function CloseDayModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { endDay } = useClinic()
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const canSubmit = confirmText.trim().toUpperCase() === 'CLOSE'

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>إغلاق وأرشفة اليوم</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          هذا الإجراء يتطلب تأكيداً صريحاً. اكتب <strong>CLOSE</strong> بالإنجليزية
          للمتابعة.
        </p>
        <input
          className="input"
          placeholder="CLOSE"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />
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
            disabled={!canSubmit || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await endDay()
                setConfirmText('')
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            إغلاق اليوم
          </button>
        </div>
      </div>
    </div>
  )
}
