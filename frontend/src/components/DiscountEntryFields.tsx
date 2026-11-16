import { displayPercent, type DiscountMode, type DiscountPreview } from '../utils/discountEntry'

export type DiscountEntryValue = {
  enabled: boolean
  mode: DiscountMode
  percent: string
  amount: string
}

type Props = {
  value: DiscountEntryValue
  onChange: (patch: Partial<DiscountEntryValue>) => void
  /** السعر الذي يُحسب عليه الخصم (المتبقي إن كان هناك خصم سابق) */
  baseSyp: number
  preview: DiscountPreview
  disabled?: boolean
  /** الخصم بمبلغ ثابت متاح بالليرة فقط */
  allowAmount?: boolean
  /** يوجد خصم سابق على البند: هذا الخصم إضافي ويُحسب على المتبقي */
  isAdditional?: boolean
  label?: string
}

const QUICK_PERCENTS = [5, 10, 15, 20] as const

function fmt(n: number) {
  return Math.round(n).toLocaleString('ar-SY')
}

/**
 * إدخال خصم بنسبة مئوية أو بمبلغ ثابت، مع عرض القيمة المقابلة والسعر بعد الخصم مباشرة.
 */
export function DiscountEntryFields({
  value,
  onChange,
  baseSyp,
  preview,
  disabled = false,
  allowAmount = true,
  isAdditional = false,
  label,
}: Props) {
  const mode: DiscountMode = allowAmount ? value.mode : 'percent'
  return (
    <div>
      <label
        style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontWeight: 600 }}
      >
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(e) => {
            const on = e.target.checked
            onChange(
              on
                ? { enabled: true, percent: value.percent.trim() || (mode === 'percent' ? '10' : ''), mode }
                : { enabled: false, percent: '', amount: '' },
            )
          }}
        />
        {label ?? (isAdditional ? 'تطبيق خصم إضافي (على المتبقي بعد الخصم السابق)' : 'تطبيق خصم')}
      </label>
      {value.enabled ? (
        <div style={{ marginTop: '0.45rem' }}>
          {allowAmount ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', fontSize: '0.88rem' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="discount-mode"
                  checked={mode === 'percent'}
                  disabled={disabled}
                  onChange={() => onChange({ mode: 'percent', amount: '' })}
                />
                نسبة مئوية %
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="discount-mode"
                  checked={mode === 'amount'}
                  disabled={disabled}
                  onChange={() => onChange({ mode: 'amount', percent: '' })}
                />
                مبلغ ثابت (ل.س)
              </label>
            </div>
          ) : null}
          {mode === 'percent' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' }}>
              {QUICK_PERCENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem', padding: '0.25rem 0.5rem' }}
                  disabled={disabled}
                  onClick={() => onChange({ percent: String(p) })}
                >
                  {p}%
                </button>
              ))}
            </div>
          ) : null}
          <label className="form-label" style={{ display: 'block', marginTop: '0.45rem' }}>
            {mode === 'percent' ? 'نسبة الخصم %' : 'مبلغ الخصم (ل.س)'}
          </label>
          <input
            className="input"
            inputMode="decimal"
            dir="ltr"
            disabled={disabled}
            value={mode === 'percent' ? value.percent : value.amount}
            onChange={(e) => onChange(mode === 'percent' ? { percent: e.target.value } : { amount: e.target.value })}
            placeholder={mode === 'percent' ? 'مثال: 10 أو 12.5' : 'مثال: 75000'}
            style={{ marginTop: '0.25rem', maxWidth: 220 }}
          />
          {preview.error ? (
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.84rem', color: 'var(--danger)' }}>{preview.error}</p>
          ) : preview.valid ? (
            <div
              style={{
                marginTop: '0.5rem',
                padding: '0.5rem 0.65rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: '0.86rem',
                lineHeight: 1.7,
              }}
            >
              <div>
                {isAdditional ? 'المتبقي قبل هذا الخصم' : 'السعر قبل الخصم'}: <strong>{fmt(baseSyp)} ل.س</strong>
              </div>
              <div>
                نسبة الخصم: <strong>{displayPercent(preview.percent).toLocaleString('ar-SY')}%</strong> — قيمة الخصم:{' '}
                <strong>−{fmt(preview.amountSyp)} ل.س</strong>
              </div>
              <div>
                المستحق بعد الخصم: <strong>{fmt(preview.priceAfterSyp)} ل.س</strong>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
