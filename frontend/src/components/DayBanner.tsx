import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useClinic } from '../context/ClinicContext'
import { useAuth } from '../context/AuthContext'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'

export function DayBanner() {
  const { user, sessionMinutesLeft } = useAuth()
  const role = user?.role
  const { dayActive, startDay, systemLoading } = useClinic()
  const [showStart, setShowStart] = useState(false)
  const [room1Input, setRoom1Input] = useState('')
  const [room2Input, setRoom2Input] = useState('')
  /** ليرة سورية لكل 1 دولار */
  const [usdSypRateInput, setUsdSypRateInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [startErr, setStartErr] = useState('')

  useEffect(() => {
    if (!showStart) {
      setStartErr('')
      setRoom1Input('')
      setRoom2Input('')
      setUsdSypRateInput('')
    }
  }, [showStart])

  const isReception = role === 'reception'
  const canStartDay = role === 'super_admin' || role === 'reception'

  if (systemLoading && !dayActive) {
    return (
      <div className="day-banner locked" role="status">
        جاري مزامنة حالة اليوم…
      </div>
    )
  }

  if (!dayActive) {
    return (
      <>
        <div className="day-banner locked" role="status">
          <div>
            <strong>اليوم غير مفعّل.</strong>{' '}
            {canStartDay
              ? 'ابدأ يوم العمل من هنا (عدادات الليزر + سعر الصرف) ليتمكن الفريق من العمل.'
              : 'لا يمكن تنفيذ العمليات حتى يُفعَّل اليوم. يبدؤه مدير النظام أو قسم الاستقبال.'}
          </div>
          {canStartDay && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setStartErr('')
                setRoom1Input('')
                setRoom2Input('')
                setUsdSypRateInput('')
                setShowStart(true)
              }}
            >
              بدء يوم العمل
            </button>
          )}
        </div>
        {showStart && canStartDay && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-day-title"
          >
            <div className="modal">
              <h3 id="start-day-title">تفعيل يوم العمل</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                أدخل قراءة عداد الجهاز لكل غرفة في <strong>بداية</strong> هذا اليوم (قبل أول جلسة)، و<strong>
                  سعر صرف الدولار مقابل الليرة السورية
                </strong>{' '}
                (عدد الليرات لكل <strong>1 USD</strong>) — يُستخدم لاحقاً لعرض المستحق بالدولار عند التحصيل
                وفي التقارير المالية.
              </p>
              <label className="form-label" htmlFor="usd-syp-rate" style={{ marginTop: '0.5rem' }}>
                سعر الصرف: ليرة سورية لكل 1 دولار (USD)
              </label>
              <input
                id="usd-syp-rate"
                className="input"
                inputMode="decimal"
                dir="ltr"
                value={usdSypRateInput}
                onChange={(e) => {
                  setStartErr('')
                  setUsdSypRateInput(e.target.value)
                }}
                placeholder="مثال: 13000"
              />
              <label className="form-label" htmlFor="meter-r1">
                عداد الجهاز — غرفة 1 (Room 1)
              </label>
              <input
                id="meter-r1"
                className="input"
                inputMode="decimal"
                dir="ltr"
                value={room1Input}
                onChange={(e) => {
                  setStartErr('')
                  setRoom1Input(e.target.value)
                }}
              />
              <label className="form-label" htmlFor="meter-r2" style={{ marginTop: '0.75rem' }}>
                عداد الجهاز — غرفة 2 (Room 2)
              </label>
              <input
                id="meter-r2"
                className="input"
                inputMode="decimal"
                dir="ltr"
                value={room2Input}
                onChange={(e) => {
                  setStartErr('')
                  setRoom2Input(e.target.value)
                }}
              />
              {startErr ? (
                <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{startErr}</p>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  marginTop: '1rem',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setStartErr('')
                    setShowStart(false)
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setStartErr('')
                    const m1 = parseFloat(normalizeDecimalDigits(room1Input))
                    const m2 = parseFloat(normalizeDecimalDigits(room2Input))
                    const rate = parseFloat(normalizeDecimalDigits(usdSypRateInput))
                    if (!Number.isFinite(m1) || m1 < 0) {
                      setStartErr('أدخل قراءة صالحة لعداد غرفة 1 (رقم ≥ 0).')
                      return
                    }
                    if (!Number.isFinite(m2) || m2 < 0) {
                      setStartErr('أدخل قراءة صالحة لعداد غرفة 2 (رقم ≥ 0).')
                      return
                    }
                    if (!Number.isFinite(rate) || rate <= 0) {
                      setStartErr('أدخل سعر صرف صالحاً للدولار (ليرة لكل 1 USD، رقم أكبر من صفر).')
                      return
                    }
                    setBusy(true)
                    try {
                      await startDay({
                        room1MeterStart: m1,
                        room2MeterStart: m2,
                        usdSypRate: rate,
                      })
                      setShowStart(false)
                    } catch (e) {
                      setStartErr(e instanceof ApiError ? e.message : 'تعذر تفعيل اليوم. تحقق من الاتصال بالخادم.')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? 'جاري التفعيل…' : 'تأكيد والبدء'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="day-banner active" role="status">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span className="chip chip-day-live">يوم العمل قيد التنفيذ</span>
      </div>
      {isReception && sessionMinutesLeft != null && (
        <span className="session-hint">
          تنتهي جلسة الاستقبال تلقائياً خلال ~{sessionMinutesLeft} دقيقة
        </span>
      )}
    </div>
  )
}
