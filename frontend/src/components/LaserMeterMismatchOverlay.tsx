import { useEffect } from 'react'

export type MeterSegmentDto = {
  complete?: boolean
  matched?: boolean | null
}

export type MeterReconciliationDto = {
  complete?: boolean
  matched?: boolean | null
  morning?: MeterSegmentDto
  afternoon?: MeterSegmentDto
}

function roomMeterHasMismatch(room: MeterReconciliationDto | undefined): boolean {
  if (!room) return false
  if (room.complete && room.matched === false) return true
  if (room.morning?.complete && room.morning.matched === false) return true
  if (room.afternoon?.complete && room.afternoon.matched === false) return true
  return false
}

/** تحقق يومي: أي غرفة — اليوم كاملاً أو فترة صباحية/مسائية */
export function laserMeterRoomsMismatch(
  meterReconciliation:
    | {
        room1?: MeterReconciliationDto
        room2?: MeterReconciliationDto
      }
    | null
    | undefined,
): boolean {
  if (!meterReconciliation) return false
  return roomMeterHasMismatch(meterReconciliation.room1) || roomMeterHasMismatch(meterReconciliation.room2)
}

export function LaserMeterMismatchOverlay({
  open,
  businessDateLabel,
  onDismiss,
}: {
  open: boolean
  businessDateLabel: string
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  if (!open) return null

  return (
    <div
      className="laser-meter-mismatch-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="laser-meter-mismatch-title"
      aria-describedby="laser-meter-mismatch-desc"
    >
      <div className="laser-meter-mismatch-overlay__backdrop" aria-hidden />
      <div className="laser-meter-mismatch-overlay__panel">
        <div className="laser-meter-mismatch-overlay__icon" aria-hidden>
          ⚠
        </div>
        <h2 id="laser-meter-mismatch-title" className="laser-meter-mismatch-overlay__title">
          تنبيه عاجل: لا يوجد تطابق لعداد الضربات
        </h2>
        <p id="laser-meter-mismatch-desc" className="laser-meter-mismatch-overlay__text">
          تم إغلاق وأرشفة اليوم <strong dir="ltr">{businessDateLabel || '—'}</strong> مع وجود عدم تطابق في مطابقة
          عدّاد الضربات مع الجهاز في إحدى الغرف أو أكثر. راجع صفحة الليزر — تقارير يومية — قسم مطابقة العداد مباشرةً.
        </p>
        <button type="button" className="btn btn-danger laser-meter-mismatch-overlay__cta" onClick={onDismiss}>
          متابعة وعرض التفاصيل
        </button>
      </div>
    </div>
  )
}
