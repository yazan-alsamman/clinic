import { useEffect, useState } from 'react'
import { api } from '../api/client'

export type PaymentChannel = 'cash' | 'bank'

export function usePaymentBankOptions(enabled = true) {
  const [banks, setBanks] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setBanks([])
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await api<{ banks: { id: string; name: string }[] }>('/api/billing/payment-bank-options')
        if (!cancelled) setBanks(data.banks || [])
      } catch {
        if (!cancelled) setBanks([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { banks, loading }
}

export type PaymentChannelFieldsProps = {
  channel: PaymentChannel
  bankName: string
  onChannelChange: (channel: PaymentChannel) => void
  onBankNameChange: (name: string) => void
  disabled?: boolean
  /** بادئة لأسماء عناصر الراديو لتجنّب التعارض بين نوافذ متعددة */
  namePrefix?: string
  banks?: { id: string; name: string }[]
  banksLoading?: boolean
}

export function PaymentChannelFields({
  channel,
  bankName,
  onChannelChange,
  onBankNameChange,
  disabled = false,
  namePrefix = 'pay-ch',
  banks = [],
  banksLoading = false,
}: PaymentChannelFieldsProps) {
  const radioName = `${namePrefix}-channel`

  return (
    <div style={{ marginTop: '0.55rem' }}>
      <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
        طريقة استلام الدفع
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="radio"
            name={radioName}
            checked={channel === 'cash'}
            disabled={disabled}
            onChange={() => {
              onChannelChange('cash')
              onBankNameChange('')
            }}
          />
          كاش
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="radio"
            name={radioName}
            checked={channel === 'bank'}
            disabled={disabled || banksLoading}
            onChange={() => onChannelChange('bank')}
          />
          بنك
        </label>
      </div>
      {channel === 'bank' ? (
        <div style={{ marginTop: '0.55rem' }}>
          <label className="form-label" htmlFor={`${namePrefix}-bank`}>
            البنك
          </label>
          <select
            id={`${namePrefix}-bank`}
            className="select"
            value={bankName}
            disabled={disabled || banksLoading}
            onChange={(e) => onBankNameChange(e.target.value)}
            style={{ maxWidth: '100%', marginTop: '0.25rem' }}
          >
            <option value="">{banksLoading ? 'جاري التحميل…' : '— اختر البنك —'}</option>
            {banks.map((bk) => (
              <option key={bk.id} value={bk.name}>
                {bk.name}
              </option>
            ))}
          </select>
          {banks.length === 0 && !banksLoading ? (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
              لا توجد بنوك معتمدة — يحددها مدير النظام من إعدادات التحصيل.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function validatePaymentChannelBeforeSubmit(
  channel: PaymentChannel,
  bankName: string,
): string | null {
  if (channel === 'bank' && !bankName.trim()) {
    return 'اختر البنك من القائمة المعتمدة.'
  }
  return null
}
