import { useEffect } from 'react'
import {
  PaymentChannelFields,
  validatePaymentChannelBeforeSubmit,
  type PaymentChannel,
} from './PaymentChannelFields'
import { usdRoundedUpCashOffer } from '../utils/usdExactDue'

export type PayCurrency = 'SYP' | 'USD'

export type PackageCollectionFieldsProps = {
  /** المبلغ المدفوع حالياً بالليرة (أساس التحصيل) */
  dueSyp: number
  payCurrency: PayCurrency
  onPayCurrencyChange: (c: PayCurrency) => void
  amountUsd: string
  onAmountUsdChange: (v: string) => void
  channel: PaymentChannel
  bankName: string
  onChannelChange: (c: PaymentChannel) => void
  onBankNameChange: (name: string) => void
  usdSypRate: number | null
  disabled?: boolean
  namePrefix?: string
  banks?: { id: string; name: string }[]
  banksLoading?: boolean
}

export function PackageCollectionFields({
  dueSyp,
  payCurrency,
  onPayCurrencyChange,
  amountUsd,
  onAmountUsdChange,
  channel,
  bankName,
  onChannelChange,
  onBankNameChange,
  usdSypRate,
  disabled = false,
  namePrefix = 'pkg-collect',
  banks = [],
  banksLoading = false,
}: PackageCollectionFieldsProps) {
  const due = Math.max(0, Math.round(Number(dueSyp) || 0))
  const rate = Number(usdSypRate)

  useEffect(() => {
    if (payCurrency !== 'USD' || !(due > 0) || !(rate > 0)) return
    const offer = usdRoundedUpCashOffer(due, rate)
    if (offer) onAmountUsdChange(offer.usdFieldValue)
  }, [payCurrency, due, rate, onAmountUsdChange])

  const fieldsDisabled = disabled || !(due > 0)

  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '0.75rem',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--surface-solid)',
      }}
    >
      <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 700 }}>
        طريقة التحصيل (عند وجود مدفوع)
      </span>
      {!(due > 0) ? (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
          أدخل «المدفوع حالياً» أكبر من صفر لتفعيل خيارات الكاش/البنك والليرة/الدولار.
        </p>
      ) : null}
      <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
        عملة التحصيل
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: fieldsDisabled ? 'default' : 'pointer' }}>
          <input
            type="radio"
            name={`${namePrefix}-currency`}
            checked={payCurrency === 'SYP'}
            disabled={fieldsDisabled}
            onChange={() => onPayCurrencyChange('SYP')}
          />
          ليرة سورية
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: fieldsDisabled ? 'default' : 'pointer' }}>
          <input
            type="radio"
            name={`${namePrefix}-currency`}
            checked={payCurrency === 'USD'}
            disabled={fieldsDisabled}
            onChange={() => onPayCurrencyChange('USD')}
          />
          دولار أمريكي (USD)
        </label>
      </div>

      <PaymentChannelFields
        channel={channel}
        bankName={bankName}
        onChannelChange={onChannelChange}
        onBankNameChange={onBankNameChange}
        disabled={fieldsDisabled}
        namePrefix={`${namePrefix}-ch`}
        banks={banks}
        banksLoading={banksLoading}
      />

      {payCurrency === 'USD' ? (
        <div style={{ marginTop: '0.55rem' }}>
          <label className="form-label">المبلغ المستلم (USD)</label>
          <input
            className="input"
            inputMode="decimal"
            dir="ltr"
            step="any"
            disabled={fieldsDisabled}
            value={amountUsd}
            onChange={(e) => onAmountUsdChange(e.target.value)}
            placeholder="0"
            style={{ marginTop: '0.25rem', maxWidth: 320 }}
          />
          {rate > 0 ? (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              سعر اليوم: <strong>{rate.toLocaleString('ar-SY')}</strong> ل.س لكل 1 USD — المستحق بالليرة:{' '}
              <strong>{due.toLocaleString('ar-SY')} ل.س</strong>
            </p>
          ) : (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
              لا يتوفر سعر صرف ليوم العمل — فعّل اليوم مع إدخال سعر الدولار.
            </p>
          )}
        </div>
      ) : (
        <p style={{ margin: '0.55rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          يُحصَّل <strong>{due.toLocaleString('ar-SY')} ل.س</strong> (المبلغ المدفوع حالياً) كاش أو بنك.
        </p>
      )}
    </div>
  )
}

export function validatePackageCollectionBeforeSubmit(opts: {
  dueSyp: number
  payCurrency: PayCurrency
  amountUsd: string
  channel: PaymentChannel
  bankName: string
  usdSypRate: number | null
}): string | null {
  const due = Math.max(0, Math.round(Number(opts.dueSyp) || 0))
  if (!(due > 0)) return 'أدخل المبلغ المدفوع حالياً قبل التحصيل.'
  const chErr = validatePaymentChannelBeforeSubmit(opts.channel, opts.bankName)
  if (chErr) return chErr
  if (opts.payCurrency === 'USD') {
    const rate = Number(opts.usdSypRate)
    if (!(rate > 0)) return 'لا يتوفر سعر صرف ليوم العمل — فعّل اليوم مع سعر الدولار.'
    const usd = Number(opts.amountUsd)
    if (!Number.isFinite(usd) || usd <= 0) return 'أدخل المبلغ المستلم بالدولار.'
    const receivedSyp = Math.round(usd * rate)
    if (receivedSyp < due) {
      return `المبلغ بالدولار لا يغطي المدفوع (${due.toLocaleString('ar-SY')} ل.س).`
    }
  }
  return null
}

export function packageCollectionBodyExtras(opts: {
  dueSyp: number
  payCurrency: PayCurrency
  amountUsd: string
  channel: PaymentChannel
  bankName: string
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    payCurrency: opts.payCurrency,
    paymentChannel: opts.channel,
  }
  if (opts.channel === 'bank') body.bankName = opts.bankName.trim()
  if (opts.payCurrency === 'USD') {
    body.amountUsd = Number(opts.amountUsd)
  } else {
    body.amountSyp = Math.max(0, Math.round(Number(opts.dueSyp) || 0))
  }
  return body
}
