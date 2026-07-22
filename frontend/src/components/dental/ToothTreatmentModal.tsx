import { useMemo, useState } from 'react'
import {
  arabicToothName,
  emptyTreatment,
  normalizeTreatment,
  treatmentPaidTotal,
  treatmentRemaining,
  type DentalPayment,
  type DentalToothState,
  type DentalToothTreatment,
} from './dentalChartTypes'

type Props = {
  tooth: DentalToothState
  canEdit: boolean
  saving?: boolean
  onClose: () => void
  onSave: (treatment: DentalToothTreatment) => void
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ToothTreatmentModal({ tooth, canEdit, saving, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<DentalToothTreatment>(() =>
    normalizeTreatment(tooth.treatment || emptyTreatment()),
  )
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payDate, setPayDate] = useState(todayIsoDate)
  const [localErr, setLocalErr] = useState('')

  const paid = useMemo(() => treatmentPaidTotal(draft), [draft])
  const remaining = useMemo(() => treatmentRemaining(draft), [draft])

  function addPayment() {
    setLocalErr('')
    const amount = Math.max(0, Math.round(Number(payAmount) || 0))
    if (!(amount > 0)) {
      setLocalErr('أدخل مبلغ دفعة أكبر من صفر.')
      return
    }
    if (!(draft.totalCostSyp > 0)) {
      setLocalErr('حدد التكلفة الكلية أولاً قبل تسجيل الدفعات.')
      return
    }
    if (amount > remaining) {
      setLocalErr(`المبلغ أكبر من المتبقي (${remaining.toLocaleString('ar-SY')} ل.س).`)
      return
    }
    const row: DentalPayment = {
      id: `p-${Date.now()}`,
      amountSyp: amount,
      paidAt: payDate || todayIsoDate(),
      note: payNote.trim(),
    }
    setDraft((prev) => normalizeTreatment({ ...prev, payments: [...prev.payments, row] }))
    setPayAmount('')
    setPayNote('')
  }

  function removePayment(id: string) {
    setDraft((prev) =>
      normalizeTreatment({
        ...prev,
        payments: prev.payments.filter((p) => p.id !== id),
      }),
    )
  }

  function handleSave() {
    setLocalErr('')
    const next = normalizeTreatment(draft)
    if (treatmentPaidTotal(next) > next.totalCostSyp && next.totalCostSyp > 0) {
      setLocalErr('مجموع الدفعات يتجاوز التكلفة الكلية.')
      return
    }
    onSave(next)
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="modal"
        style={{ maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>
              إجراء السن {tooth.fdi}
            </h3>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              {arabicToothName(tooth.fdi)}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            إغلاق
          </button>
        </div>

        <label className="form-label" style={{ marginTop: '1rem' }}>
          وصف الإجراء
        </label>
        <textarea
          className="textarea"
          value={draft.procedureDescription}
          disabled={!canEdit}
          onChange={(e) => setDraft((p) => ({ ...p, procedureDescription: e.target.value }))}
          rows={4}
          placeholder="مثال: حشوة كومبوزيت — عصب — تاج…"
        />

        <div className="grid-2" style={{ marginTop: '0.85rem', gap: '0.75rem' }}>
          <div>
            <label className="form-label">التكلفة الكلية (ل.س)</label>
            <input
              className="input"
              inputMode="numeric"
              dir="ltr"
              disabled={!canEdit}
              value={draft.totalCostSyp ? String(draft.totalCostSyp) : ''}
              onChange={(e) => {
                const n = Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0))
                setDraft((p) => normalizeTreatment({ ...p, totalCostSyp: n }))
              }}
              placeholder="0"
            />
          </div>
          <div>
            <label className="form-label">اسم الطبيب المعالج</label>
            <input
              className="input"
              disabled={!canEdit}
              value={draft.doctorName}
              onChange={(e) => setDraft((p) => ({ ...p, doctorName: e.target.value }))}
              placeholder="اسم الطبيب"
            />
          </div>
        </div>

        <div
          style={{
            marginTop: '1rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '0.5rem',
          }}
        >
          <div className="stat-card">
            <div className="lbl">الكلي</div>
            <div className="val" style={{ fontSize: '1rem' }}>
              {draft.totalCostSyp.toLocaleString('ar-SY')} ل.س
            </div>
          </div>
          <div className="stat-card">
            <div className="lbl">المدفوع</div>
            <div className="val" style={{ fontSize: '1rem' }}>
              {paid.toLocaleString('ar-SY')} ل.س
            </div>
          </div>
          <div className="stat-card" style={{ borderColor: remaining > 0 ? 'var(--warning)' : undefined }}>
            <div className="lbl">المتبقي</div>
            <div className="val" style={{ fontSize: '1rem', color: remaining > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {remaining.toLocaleString('ar-SY')} ل.س
            </div>
          </div>
        </div>

        <h4 style={{ margin: '1.15rem 0 0.5rem', fontSize: '0.95rem' }}>جدول الدفعات</h4>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>التاريخ</th>
                <th>المبلغ</th>
                <th>ملاحظة</th>
                {canEdit ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {draft.payments.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 5 : 4} style={{ color: 'var(--text-muted)' }}>
                    لا دفعات بعد — المتبقي = التكلفة الكلية.
                  </td>
                </tr>
              ) : (
                draft.payments.map((p, idx) => (
                  <tr key={p.id}>
                    <td>{idx + 1}</td>
                    <td>{p.paidAt || '—'}</td>
                    <td dir="ltr">{p.amountSyp.toLocaleString('ar-SY')} ل.س</td>
                    <td>{p.note || '—'}</td>
                    {canEdit ? (
                      <td>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: '0.75rem' }} onClick={() => removePayment(p.id)}>
                          حذف
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {canEdit ? (
          <div
            style={{
              marginTop: '0.85rem',
              padding: '0.75rem',
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: 'var(--surface-solid)',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.88rem' }}>إضافة دفعة</div>
            <div className="grid-2" style={{ gap: '0.55rem' }}>
              <div>
                <label className="form-label">المبلغ (ل.س)</label>
                <input
                  className="input"
                  inputMode="numeric"
                  dir="ltr"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={remaining > 0 ? String(remaining) : '0'}
                />
              </div>
              <div>
                <label className="form-label">تاريخ الدفع</label>
                <input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>
            <label className="form-label" style={{ marginTop: '0.55rem' }}>
              ملاحظة (اختياري)
            </label>
            <input className="input" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '0.65rem' }}
              disabled={remaining <= 0}
              onClick={addPayment}
            >
              إضافة دفعة وإنقاص من المتبقي
            </button>
          </div>
        ) : null}

        {localErr ? (
          <p style={{ color: 'var(--danger)', margin: '0.75rem 0 0', fontSize: '0.88rem' }}>{localErr}</p>
        ) : null}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
          {canEdit ? (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'جاري الحفظ…' : 'حفظ الإجراء والدفعات'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
