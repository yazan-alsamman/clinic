import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'

type PlanItem = {
  label?: string
  note?: string
  tooth?: number
}

type DentalPlan = {
  id?: string
  status: 'draft' | 'approved'
  notes: string
  items: PlanItem[]
  approvedAt?: string | null
}

type Props = {
  patientId: string
  canEdit: boolean
  canApprove?: boolean
}

function emptyItem(): PlanItem {
  return { label: '', note: '', tooth: undefined }
}

export function DentalTreatmentPlan({ patientId, canEdit, canApprove = false }: Props) {
  const [plan, setPlan] = useState<DentalPlan | null>(null)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<PlanItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const locked = plan?.status === 'approved' && !canApprove
  const editable = canEdit && !locked

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await api<{ plan: DentalPlan | null }>(
        `/api/dental/plans/${encodeURIComponent(patientId)}`,
      )
      const p = data.plan
      setPlan(p)
      setNotes(p?.notes || '')
      setItems(Array.isArray(p?.items) && p!.items.length > 0 ? p!.items : [])
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل خطة العلاج')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  async function save(extra?: { approve?: boolean }) {
    if (!editable && !extra?.approve) return
    setSaving(true)
    setErr('')
    setOk('')
    try {
      const payload = {
        notes,
        items: items
          .map((it) => ({
            label: String(it.label || '').trim(),
            note: String(it.note || '').trim(),
            tooth: it.tooth && Number(it.tooth) > 0 ? Number(it.tooth) : undefined,
          }))
          .filter((it) => it.label || it.note || it.tooth),
      }
      if (extra?.approve) {
        const data = await api<{ plan: DentalPlan }>(
          `/api/dental/plans/${encodeURIComponent(patientId)}/approve`,
          { method: 'POST', body: JSON.stringify(payload) },
        )
        setPlan(data.plan)
        setNotes(data.plan.notes || '')
        setItems(data.plan.items || [])
        setOk('تم اعتماد خطة العلاج')
      } else {
        const data = await api<{ plan: DentalPlan }>(
          `/api/dental/plans/${encodeURIComponent(patientId)}`,
          { method: 'PUT', body: JSON.stringify(payload) },
        )
        setPlan(data.plan)
        setNotes(data.plan.notes || '')
        setItems(data.plan.items || [])
        setOk('تم حفظ خطة العلاج')
      }
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حفظ خطة العلاج')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل خطة العلاج…</p>
  }

  return (
    <div className="dental-treatment-plan">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>خطة العلاج</h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            اكتب ملخص الخطة العلاجية لهذا المريض. يمكن إضافة بنود مرتبطة برقم سن إن رغبت.
          </p>
        </div>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '0.25rem 0.6rem',
            borderRadius: 8,
            background: plan?.status === 'approved' ? 'rgba(13, 148, 136, 0.12)' : 'rgba(100, 116, 139, 0.12)',
            color: plan?.status === 'approved' ? '#0f766e' : 'var(--text-muted)',
            fontWeight: 600,
          }}
        >
          {plan?.status === 'approved' ? 'معتمدة' : 'مسودّة'}
        </span>
      </div>

      {locked ? (
        <p style={{ margin: '0.65rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          الخطة معتمدة — التعديل متاح لمدير النظام فقط.
        </p>
      ) : null}

      <label className="form-label" style={{ marginTop: '0.85rem' }}>
        نص خطة العلاج
      </label>
      <textarea
        className="textarea"
        rows={6}
        value={notes}
        disabled={!editable}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="مثال: المرحلة 1 — علاج لثوي وتنظيف… المرحلة 2 — حشوات… المرحلة 3 — زراعة…"
        style={{ width: '100%', minHeight: 120 }}
      />

      <div style={{ marginTop: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <strong style={{ fontSize: '0.88rem' }}>بنود الخطة (اختياري)</strong>
          {editable ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem' }}
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
            >
              + بند
            </button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p style={{ margin: '0.45rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            لا بنود مفصّلة بعد.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
            {items.map((it, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                  alignItems: 'center',
                }}
              >
                <input
                  className="input"
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="سن"
                  disabled={!editable}
                  value={it.tooth ? String(it.tooth) : ''}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)
                    setItems((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, tooth: n > 0 ? n : undefined } : x)),
                    )
                  }}
                  style={{ width: 72 }}
                />
                <input
                  className="input"
                  placeholder="البند"
                  disabled={!editable}
                  value={it.label || ''}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                  }
                  style={{ flex: '1 1 140px', minWidth: 120 }}
                />
                <input
                  className="input"
                  placeholder="ملاحظة"
                  disabled={!editable}
                  value={it.note || ''}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)))
                  }
                  style={{ flex: '1 1 140px', minWidth: 120 }}
                />
                {editable ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: '0.75rem' }}
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    حذف
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {err ? (
        <p style={{ color: 'var(--danger)', margin: '0.65rem 0 0', fontSize: '0.88rem' }}>{err}</p>
      ) : null}
      {ok ? (
        <p style={{ color: 'var(--success)', margin: '0.65rem 0 0', fontSize: '0.88rem' }}>{ok}</p>
      ) : null}

      {canEdit || canApprove ? (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
          {editable ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'جاري الحفظ…' : 'حفظ الخطة'}
            </button>
          ) : null}
          {canApprove && plan?.status !== 'approved' ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void save({ approve: true })}
            >
              اعتماد الخطة
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
