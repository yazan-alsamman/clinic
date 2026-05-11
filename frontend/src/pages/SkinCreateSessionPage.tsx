import { Navigate } from 'react-router-dom'

/** أُلغي دور أخصائي البشرة — التحصيل يتم عند حجز الموعد؛ استخدم جلسة بدون موعد أو التحصيل. */
export function SkinCreateSessionPage() {
  return <Navigate to="/reception/walk-in-session" replace />
}
