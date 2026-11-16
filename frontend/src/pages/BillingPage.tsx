import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'
import {
  netReceivedSypAfterUsdCollection,
  settlementDeltaAfterUsdCashNetAbsorb,
  usdRoundedUpCashOffer,
} from '../utils/usdExactDue'
import { BillingItemAdminEditModal } from '../components/BillingItemAdminEditModal'
import { mixedNetReceivedSyp, type PayCurrency } from '../utils/billingPaymentForm'
import { computeDiscountPreview, discountRequestFields, type DiscountMode } from '../utils/discountEntry'
import { DiscountEntryFields } from '../components/DiscountEntryFields'
import {
  LaserAreaDeductionModal,
  type LaserVisitDeductionPreview,
} from '../components/LaserAreaDeductionModal'
import { LaserVisitBillingBreakdown, type LaserVisitBreakdown } from '../components/LaserVisitBillingBreakdown'

type Item = {
  id: string
  patientId: string
  patientName: string
  providerName: string
  department: string
  procedureLabel: string
  /** كل مناطق جلسة الليزر بالترتيب، بدون قص */
  laserAreaLabels?: string[]
  /** مناطق حُسبت بسعر الضربة × العدد */
  laserPulseChargeNotes?: string[]
  amountDueSyp: number
  listAmountDueSyp?: number
  discountPercent?: number
  effectiveAmountDueSyp?: number
  listAmountDueUsd?: number
  effectiveAmountDueUsd?: number
  amountDueUsd?: number
  currency?: 'SYP' | 'USD' | string
  status: string
  businessDate?: string
  /** سعر USD لتاريخ البند من الخادم (يطابق complete-payment) */
  usdSypBusinessDayRate?: number | null
  isPackagePrepaid?: boolean
  isCreditTopUp?: boolean
  patientPackageId?: string
  patientPackageSessionId?: string
  /** يجب أن يكون true من الخادم قبل أي إنقاص لمناطق الباكج */
  laserPackageMetricsReady?: boolean
  /** جلسة الليزر لهذه الزيارة */
  laserSessionId?: string
  /** معاينة إنقاص مناطق الباكج لهذه الزيارة (رصيد كل منطقة وما عولج فيها) */
  laserPackageDeduction?: LaserVisitDeductionPreview
  /** ملخص الزيارة: ما غطّاه الباكج منفصلاً عن الخدمات الإضافية ومجموعها */
  laserVisitBreakdown?: LaserVisitBreakdown
  /** رصيد إضافي مخزّن على المريض */
  prepaidCreditSyp?: number
  outstandingDebtSyp?: number
  outstandingDebtUsd?: number
  creditTowardDueSyp?: number
  cashDueAfterCreditSyp?: number
}

const BILLING_ROLES = ['super_admin', 'reception'] as const

const deptLabel: Record<string, string> = {
  laser: 'ليزر',
  dermatology: 'جلدية',
  dental: 'أسنان',
}

function LaserPulseChargeNote({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null
  return (
    <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1.5 }}>
      محاسبة على عدد الضربات: {notes.join(' — ')}
    </p>
  )
}

function LaserSessionAreas({ labels }: { labels: string[] }) {
  if (!labels.length) return null
  return (
    <div style={{ margin: '0.4rem 0 0' }}>
      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>كل المناطق ({labels.length})</div>
      <ol
        style={{
          margin: '0.3rem 0 0',
          paddingInlineStart: '1.25rem',
          fontSize: '0.92rem',
          lineHeight: 1.55,
        }}
      >
        {labels.map((name, i) => (
          <li key={`${i}-${name}`}>{name}</li>
        ))}
      </ol>
    </div>
  )
}

function stripPct(s: string) {
  return s.replace(/%/g, '').trim()
}

function parseDiscountPercentInput(enabled: boolean, percentStr: string): number {
  if (!enabled) return 0
  const n = parseFloat(normalizeDecimalDigits(stripPct(percentStr)))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, n)
}

function itemListDueSyp(item: Item | null): number {
  if (!item) return 0
  return Math.round(Number(item.listAmountDueSyp ?? item.amountDueSyp) || 0)
}

function itemEffectiveDueSyp(item: Item | null): number {
  if (!item) return 0
  return Math.round(Number(item.effectiveAmountDueSyp ?? item.amountDueSyp) || 0)
}

function itemBillingCurrency(item: Item | null): 'SYP' | 'USD' {
  return String(item?.currency || 'SYP').toUpperCase() === 'USD' ? 'USD' : 'SYP'
}

function itemListDueUsd(item: Item | null): number {
  if (!item) return 0
  return Number(item.listAmountDueUsd ?? item.amountDueUsd) || 0
}

function itemEffectiveDueUsd(item: Item | null): number {
  if (!item) return 0
  return Number(item.effectiveAmountDueUsd ?? item.amountDueUsd) || 0
}

function itemHasCollectableDue(item: Item | null): boolean {
  if (!item) return false
  if (itemEffectiveDueSyp(item) > 0) return true
  return itemBillingCurrency(item) === 'USD' && itemEffectiveDueUsd(item) > 0
}

function formatUsdAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function formatItemDueLabel(item: Item): string {
  if (itemBillingCurrency(item) === 'USD') {
    const due = itemEffectiveDueUsd(item)
    const pct = Number(item.discountPercent) || 0
    if (pct > 0) {
      return `السعر الأصلي: ${formatUsdAmount(itemListDueUsd(item))} USD — بعد الخصم (${pct.toLocaleString('ar-SY')}%): ${formatUsdAmount(due)} USD`
    }
    return `${formatUsdAmount(due)} USD`
  }
  const due = itemEffectiveDueSyp(item)
  const pct = Number(item.discountPercent) || 0
  if (pct > 0) {
    return `السعر الأصلي: ${itemListDueSyp(item).toLocaleString('ar-SY')} ل.س — بعد الخصم (${pct.toLocaleString('ar-SY')}%): ${due.toLocaleString('ar-SY')} ل.س`
  }
  return `${due.toLocaleString('ar-SY')} ل.س`
}

function itemPrepaidCreditSyp(item: Item | null): number {
  if (!item) return 0
  return Math.max(0, Math.round(Number(item.prepaidCreditSyp) || 0))
}

function itemCashDueAfterCreditSyp(item: Item | null, dueOverride?: number): number {
  if (!item) return 0
  if (item.isCreditTopUp) {
    return Math.max(0, Math.round(dueOverride ?? itemEffectiveDueSyp(item)))
  }
  const due = Math.max(0, Math.round(dueOverride ?? itemEffectiveDueSyp(item)))
  const credit = itemPrepaidCreditSyp(item)
  if (item.cashDueAfterCreditSyp != null && dueOverride == null) {
    return Math.max(0, Math.round(Number(item.cashDueAfterCreditSyp) || 0))
  }
  return Math.max(0, due - Math.min(credit, due))
}

function itemCreditTowardDueSyp(item: Item | null, dueOverride?: number): number {
  if (!item) return 0
  if (item.isCreditTopUp) return 0
  const due = Math.max(0, Math.round(dueOverride ?? itemEffectiveDueSyp(item)))
  const credit = itemPrepaidCreditSyp(item)
  if (item.creditTowardDueSyp != null && dueOverride == null) {
    return Math.max(0, Math.round(Number(item.creditTowardDueSyp) || 0))
  }
  return Math.min(credit, due)
}

function openPayModalForItem(
  item: Item,
  setters: {
    setPayItem: (v: Item) => void
    setPaySyp: (v: string) => void
    setPayUsd: (v: string) => void
    setPayCurrency: (v: PayCurrency) => void
    setPayChannel: (v: 'cash' | 'bank') => void
    setPayBankName: (v: string) => void
    setPayRefundCurrency: (v: 'SYP' | 'USD') => void
    setPayRefundAmount: (v: string) => void
    setPayDiscountEnabled: (v: boolean) => void
    setPayDiscountPercent: (v: string) => void
    setPayOpen: (v: boolean) => void
  },
) {
  const isUsdPriced = itemBillingCurrency(item) === 'USD'
  const cashDue = itemCashDueAfterCreditSyp(item)
  setters.setPayItem(item)
  setters.setPaySyp(String(cashDue))
  setters.setPayUsd(isUsdPriced ? String(itemEffectiveDueUsd(item)) : '')
  setters.setPayCurrency('SYP')
  setters.setPayChannel('cash')
  setters.setPayBankName('')
  setters.setPayRefundCurrency('SYP')
  setters.setPayRefundAmount('')
  setters.setPayDiscountEnabled(false)
  setters.setPayDiscountPercent('')
  setters.setPayOpen(true)
}

/** بند باكج ليزر جاهز لإنقاص المناطق المعالجة في الزيارة */
function itemIsLaserPackageVisit(item: Item): boolean {
  return (
    item.isPackagePrepaid === true &&
    item.department === 'laser' &&
    item.laserPackageMetricsReady === true &&
    Boolean(item.laserSessionId) &&
    Boolean(item.laserPackageDeduction)
  )
}

function itemPackageMetricsMissing(item: Item): boolean {
  return (
    item.isPackagePrepaid === true &&
    item.department === 'laser' &&
    Boolean(item.patientPackageId) &&
    item.laserPackageMetricsReady !== true
  )
}

function itemPendingAreaLabels(item: Item): string[] {
  return (item.laserPackageDeduction?.packages || []).flatMap((p) =>
    p.areas.filter((a) => a.treatedInVisit && !a.alreadyDeductedForVisit).map((a) => a.label),
  )
}

/** سبب منع حذف بند معلّق (يُعرض بدل رسالة عامة) — الخادم يتحقق من نفس القاعدة */
function itemDeleteBlockedReason(item: Item): string {
  const deducted = (item.laserPackageDeduction?.packages || []).some((p) => p.areas.some((a) => a.alreadyDeductedForVisit))
  if (deducted) {
    return 'أُنقصت جلسات مناطق باكج لهذه الزيارة — صحّح الإنقاص من سجل الباكج في ملف المريض أولاً، أو احذف جلسة الليزر نفسها.'
  }
  return ''
}

type BulkCancelResult = {
  results: { id: string; ok: boolean; alreadyCancelled?: boolean; code?: string; error?: string }[]
  cancelledCount: number
  failedCount: number
}

export function BillingPage() {
  const { user } = useAuth()
  const { businessDate, usdSypRate } = useClinic()
  const allowed = BILLING_ROLES.includes(user?.role as (typeof BILLING_ROLES)[number])

  const [date, setDate] = useState('')
  const [viewAllPending, setViewAllPending] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null)
  /** نتيجة الحذف (لا تُمسح عند إعادة تحميل القائمة) */
  const [deleteNotice, setDeleteNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [packageBusyId, setPackageBusyId] = useState<string | null>(null)
  const [deductItem, setDeductItem] = useState<Item | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payItem, setPayItem] = useState<Item | null>(null)
  const [adminEditItem, setAdminEditItem] = useState<Item | null>(null)
  const [paySyp, setPaySyp] = useState('')
  const [payUsd, setPayUsd] = useState('')
  const [payCurrency, setPayCurrency] = useState<PayCurrency>('SYP')
  const [payChannel, setPayChannel] = useState<'cash' | 'bank'>('cash')
  const [payBankName, setPayBankName] = useState('')
  const [bankOptions, setBankOptions] = useState<{ id: string; name: string }[]>([])
  /** عند التحصيل بالدولار: توثيق ما رُدّ للمريض (ل.س أو USD) */
  const [payRefundCurrency, setPayRefundCurrency] = useState<'SYP' | 'USD'>('SYP')
  const [payRefundAmount, setPayRefundAmount] = useState('')
  const [payDiscountEnabled, setPayDiscountEnabled] = useState(false)
  const [payDiscountPercent, setPayDiscountPercent] = useState('')

  const [payDiscountMode, setPayDiscountMode] = useState<DiscountMode>('percent')
  const [payDiscountAmount, setPayDiscountAmount] = useState('')
  useEffect(() => {
    setPayDiscountMode('percent')
    setPayDiscountAmount('')
  }, [payItem?.id])

  /** أساس الخصم الجديد: المتبقي بعد الخصم المحفوظ على البند، وإلا السعر الأصلي */
  const discountBaseSyp = useMemo(() => {
    if (!payItem) return 0
    const presetPct = Number(payItem.discountPercent) || 0
    return presetPct > 0 ? itemEffectiveDueSyp(payItem) : itemListDueSyp(payItem)
  }, [payItem])

  const discountPreview = useMemo(
    () =>
      computeDiscountPreview({
        baseSyp: discountBaseSyp,
        mode: payDiscountMode,
        value: payDiscountEnabled ? (payDiscountMode === 'amount' ? payDiscountAmount : payDiscountPercent) : '',
      }),
    [discountBaseSyp, payDiscountEnabled, payDiscountMode, payDiscountPercent, payDiscountAmount],
  )

  const effectiveDueSyp = useMemo(() => {
    if (!payItem) return 0
    return discountPreview.valid ? discountPreview.priceAfterSyp : discountBaseSyp
  }, [payItem, discountPreview, discountBaseSyp])

  const creditTowardDueSyp = useMemo(() => {
    if (!payItem) return 0
    return itemCreditTowardDueSyp(payItem, effectiveDueSyp)
  }, [payItem, effectiveDueSyp])

  const cashDueAfterCreditSyp = useMemo(() => {
    if (!payItem) return 0
    return itemCashDueAfterCreditSyp(payItem, effectiveDueSyp)
  }, [payItem, effectiveDueSyp])

  const payPreviewRate = useMemo(() => {
    const fromItem = payItem?.usdSypBusinessDayRate != null ? Number(payItem.usdSypBusinessDayRate) : NaN
    if (payItem && Number.isFinite(fromItem) && fromItem > 0) return fromItem
    if (
      payItem?.businessDate &&
      businessDate &&
      payItem.businessDate === businessDate &&
      usdSypRate != null &&
      usdSypRate > 0
    )
      return usdSypRate
    return null
  }, [payItem, businessDate, usdSypRate])

  const usdCashOffer = useMemo(() => {
    if (!payItem) return null
    if (itemBillingCurrency(payItem) === 'USD') {
      const dueUsd = itemEffectiveDueUsd(payItem)
      if (!(dueUsd > 0)) return null
      return { usdFieldValue: String(dueUsd), impliedRefundSyp: 0 }
    }
    if (!payPreviewRate || !(cashDueAfterCreditSyp > 0)) return null
    return usdRoundedUpCashOffer(cashDueAfterCreditSyp, payPreviewRate)
  }, [payItem, payPreviewRate, cashDueAfterCreditSyp])

  /** عند الدفع بالدولار: إعادة اقتراح المستلم والترجيع عند تغيّر المستحق (خصم، بند، سعر). */
  useEffect(() => {
    if (!payOpen || payCurrency !== 'USD' || !usdCashOffer) return
    setPayUsd(usdCashOffer.usdFieldValue)
    setPayRefundCurrency('SYP')
    setPayRefundAmount(usdCashOffer.impliedRefundSyp > 0 ? String(usdCashOffer.impliedRefundSyp) : '')
  }, [payOpen, payCurrency, usdCashOffer])

  useEffect(() => {
    if (businessDate && !date) setDate(businessDate)
  }, [businessDate, date])

  useEffect(() => {
    if (!payOpen || !allowed) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ banks: { id: string; name: string }[] }>('/api/billing/payment-bank-options')
        if (!cancelled) setBankOptions(data.banks || [])
      } catch {
        if (!cancelled) setBankOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payOpen, allowed])

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    try {
      setLoading(true)
      if (viewAllPending && user?.role === 'super_admin') {
        const data = await api<{ items: Item[] }>('/api/billing/pending-all?limit=100')
        setItems(data.items)
        return
      }
      if (!date) {
        setItems([])
        return
      }
      const data = await api<{ items: Item[] }>(
        `/api/billing/pending?date=${encodeURIComponent(date)}`,
      )
      /** بدون «عرض كل المعلّقة»: بنود تاريخ يوم العمل فقط */
      setItems(data.items)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر التحميل')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [allowed, date, user?.role, viewAllPending])

  useEffect(() => {
    void load()
  }, [load])

  async function completePay(id: string) {
    setErr('')
    if (payItem && !itemHasCollectableDue(payItem)) {
      setErr('لا يوجد مبلغ مستحق على هذا البند — راجع التسعير في ملف المريض.')
      return
    }
    if (payDiscountEnabled && !discountPreview.valid) {
      setErr(
        discountPreview.error ||
          (payDiscountMode === 'amount' ? 'أدخل مبلغ خصم صالحاً بالليرة.' : 'أدخل نسبة خصم صالحة بين 1 و 100%.'),
      )
      return
    }
    if (payChannel === 'bank') {
      const sypCheck = Number(normalizeDecimalDigits(paySyp))
      const usdCheck = parseFloat(normalizeDecimalDigits(payUsd))
      const hasCollection =
        payCurrency === 'SYP'
          ? Number.isFinite(sypCheck) && sypCheck > 0
          : payCurrency === 'MIXED'
            ? (Number.isFinite(sypCheck) && sypCheck > 0) || (Number.isFinite(usdCheck) && usdCheck > 0)
            : Number.isFinite(usdCheck) && usdCheck > 0
      if (hasCollection && !payBankName.trim()) {
        setErr('اختر البنك ثم أدخل المبلغ المستلم.')
        return
      }
    }
    if (payCurrency === 'SYP') {
      const syp = Number(normalizeDecimalDigits(paySyp))
      if (!Number.isFinite(syp) || syp < 0) {
        setErr('أدخل مبلغاً صالحاً بالليرة السورية.')
        return
      }
    } else if (payCurrency === 'MIXED') {
      const syp = Number(normalizeDecimalDigits(paySyp))
      const usdRaw = normalizeDecimalDigits(payUsd).trim()
      const usd = usdRaw === '' ? 0 : parseFloat(usdRaw)
      if (!Number.isFinite(syp) || syp < 0) {
        setErr('مبلغ الليرة في التحصيل المختلط غير صالح.')
        return
      }
      if (!Number.isFinite(usd) || usd < 0) {
        setErr('مبلغ الدولار في التحصيل المختلط غير صالح.')
        return
      }
      if (usd > 0 && !(payPreviewRate && payPreviewRate > 0)) {
        setErr('لا يتوفر سعر صرف لحساب جزء الدولار.')
        return
      }
    } else {
      const usdRaw = normalizeDecimalDigits(payUsd).trim()
      const usd = usdRaw === '' ? 0 : parseFloat(usdRaw)
      if (!Number.isFinite(usd) || usd < 0) {
        setErr('أدخل مبلغاً صالحاً بالدولار.')
        return
      }
      if (usd > 0 && payRefundAmount.trim()) {
        const ref =
          payRefundCurrency === 'SYP'
            ? Number(normalizeDecimalDigits(payRefundAmount))
            : parseFloat(normalizeDecimalDigits(payRefundAmount))
        if (!Number.isFinite(ref) || ref < 0) {
          setErr('مبلغ الترجيع غير صالح — أدخل رقماً صحيحاً أو افرغ الحقل.')
          return
        }
      }
      if (usd > 0 && payPreviewRate && payPreviewRate > 0) {
        const usdG = usd
        const grossSyp = Math.round(usdG * payPreviewRate)
        let refSyp = 0
        let refUsd = 0
        if (payRefundAmount.trim()) {
          if (payRefundCurrency === 'SYP') {
            refSyp = Math.round(Number(normalizeDecimalDigits(payRefundAmount)) || 0)
          } else {
            refUsd = parseFloat(normalizeDecimalDigits(payRefundAmount)) || 0
          }
        }
        const refEquiv = refSyp + Math.round(refUsd * payPreviewRate)
        if (refEquiv > grossSyp) {
          setErr('إجمالي الترجيع (ليرة ومقابل دولار) لا يمكن أن يتجاوز المبلغ المستلم.')
          return
        }
        const netSyp = netReceivedSypAfterUsdCollection({
          amountUsd: usdG,
          patientRefundSyp: refSyp,
          patientRefundUsd: refUsd,
          rate: payPreviewRate,
        })
        if (netSyp < 0) {
          setErr('صافي المبلغ بعد الترجيع غير صالح.')
          return
        }
      }
    }
    setBusyId(id)
    try {
      const syp = Number(normalizeDecimalDigits(paySyp))
      const usdRaw = normalizeDecimalDigits(payUsd).trim()
      const usd = usdRaw === '' ? 0 : parseFloat(usdRaw)
      const refundTrim = payRefundAmount.trim()
      const refundPayload =
        payCurrency === 'USD' && refundTrim
          ? {
              refundCurrency: payRefundCurrency,
              refundAmount:
                payRefundCurrency === 'SYP'
                  ? Number(normalizeDecimalDigits(payRefundAmount))
                  : parseFloat(normalizeDecimalDigits(payRefundAmount)),
            }
          : payCurrency === 'USD'
            ? { refundCurrency: payRefundCurrency }
            : {}
      /** خصم جديد (نسبة أو مبلغ). إن كان على البند خصم سابق يُطبَّق هذا على المتبقي ويُسجَّل سطراً مستقلاً */
      const discountFields = payDiscountEnabled
        ? payDiscountMode === 'amount'
          ? discountRequestFields('amount', discountPreview)
          : { discountPercent: parseDiscountPercentInput(true, payDiscountPercent) }
        : { discountPercent: 0 }
      await api(`/api/billing/${encodeURIComponent(id)}/complete-payment`, {
        method: 'POST',
        body: JSON.stringify({
          payCurrency,
          paymentChannel: payChannel,
          bankName: payChannel === 'bank' ? payBankName.trim() : undefined,
          amountSyp:
            (payCurrency === 'SYP' || payCurrency === 'MIXED') && Number.isFinite(syp) && syp >= 0
              ? Math.round(syp)
              : undefined,
          amountUsd:
            (payCurrency === 'USD' || payCurrency === 'MIXED') && Number.isFinite(usd) && usd >= 0
              ? usd
              : undefined,
          ...discountFields,
          ...refundPayload,
        }),
      })
      setPayOpen(false)
      setPayItem(null)
      setPaySyp('')
      setPayUsd('')
      setPayCurrency('SYP')
      setPayChannel('cash')
      setPayBankName('')
      setPayRefundCurrency('SYP')
      setPayRefundAmount('')
      setPayDiscountEnabled(false)
      setPayDiscountPercent('')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'فشل التحصيل')
    } finally {
      setBusyId(null)
    }
  }

  /** سبب الحذف اختياري — يُحفظ مع البند وفي سجل التدقيق. null = إلغاء العملية */
  function askDeleteReason(message: string): string | null {
    const r = window.prompt(`${message}\n\nسبب الحذف (اختياري — يُحفظ في سجل التدقيق):`, '')
    return r === null ? null : r.trim()
  }

  async function deletePendingItem(item: Item) {
    if (user?.role !== 'super_admin') return
    const blocked = itemDeleteBlockedReason(item)
    if (blocked) {
      setDeleteNotice({ tone: 'error', text: blocked })
      return
    }
    const reason = askDeleteReason(
      `حذف بند التحصيل لهذا المريض؟ (يُلغى البند ويبقى في السجل)\n${item.patientName || 'مريض'} — ${item.procedureLabel}`,
    )
    if (reason === null) return
    setDeleteNotice(null)
    setDeleteBusyId(item.id)
    try {
      const res = await api<{ alreadyCancelled?: boolean; message?: string }>(
        `/api/billing/${encodeURIComponent(item.id)}`,
        { method: 'DELETE', body: JSON.stringify({ reason }) },
      )
      setDeleteNotice({
        tone: 'ok',
        text: res.alreadyCancelled ? `${res.message || 'البند محذوف مسبقاً.'} أُزيل من القائمة.` : 'تم حذف البند.',
      })
    } catch (e) {
      /** غالباً تغيّرت حالة البند (حُصّل أو حُذف من مكان آخر) — نعرض السبب ونحدّث القائمة */
      setDeleteNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'تعذر حذف بند التحصيل' })
    } finally {
      setDeleteBusyId(null)
      await load()
    }
  }

  async function deleteSelectedItems() {
    if (user?.role !== 'super_admin') return
    const ids = items.filter((x) => selectedIds.has(x.id) && !itemDeleteBlockedReason(x)).map((x) => x.id)
    if (!ids.length) return
    const reason = askDeleteReason(`حذف ${ids.length} بند تحصيل معلّق؟ (تُلغى البنود وتبقى في السجل)`)
    if (reason === null) return
    setDeleteNotice(null)
    setBulkBusy(true)
    try {
      const res = await api<BulkCancelResult>('/api/billing/bulk-cancel', {
        method: 'POST',
        body: JSON.stringify({ ids, reason }),
      })
      const byId = new Map(items.map((x) => [x.id, x]))
      const failed = res.results.filter((r) => !r.ok)
      const lines = failed.map((r) => `• ${byId.get(r.id)?.patientName || 'بند'}: ${r.error || 'تعذر الحذف'}`)
      setDeleteNotice({
        tone: failed.length ? 'error' : 'ok',
        text:
          `حُذف ${res.cancelledCount} بند` +
          (failed.length ? ` — لم يُحذف ${failed.length}:\n${lines.join('\n')}` : '.'),
      })
      setSelectedIds(new Set())
    } catch (e) {
      setDeleteNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'تعذر حذف البنود' })
    } finally {
      setBulkBusy(false)
      await load()
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">التحصيل</h1>
        <p className="page-desc">للاستقبال والمدير فقط.</p>
      </>
    )
  }

  function applyUsdCashOfferFill() {
    if (!payPreviewRate || !usdCashOffer) return
    setPayUsd(usdCashOffer.usdFieldValue)
    setPayRefundCurrency('SYP')
    setPayRefundAmount(usdCashOffer.impliedRefundSyp > 0 ? String(usdCashOffer.impliedRefundSyp) : '')
  }

  return (
    <>
      <h1 className="page-title">بنود بانتظار التحصيل</h1>
      <p className="page-desc">
        بعد تأكيد استلام الدفع يُنشأ الترحيل المحاسبي تلقائياً. إن وُجد رصيد إضافي للمريض يظهر في البطاقة ويُخصم
        تلقائياً من المستحق عند التحصيل.
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'flex-end',
          marginTop: '0.5rem',
        }}
      >
        {user?.role === 'super_admin' ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={viewAllPending}
              onChange={(e) => setViewAllPending(e.target.checked)}
            />
            <span style={{ fontSize: '0.9rem' }}>عرض كل المعلّقة (أي تاريخ)</span>
          </label>
        ) : null}
        {!viewAllPending ? (
          <label>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
              تاريخ يوم العمل
            </span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        ) : null}
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          تحديث
        </button>
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '1rem' }}>{err}</p> : null}
      {deleteNotice ? (
        <p
          style={{
            color: deleteNotice.tone === 'ok' ? 'var(--success)' : 'var(--danger)',
            marginTop: '1rem',
            whiteSpace: 'pre-line',
          }}
        >
          {deleteNotice.text}{' '}
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0 0.4rem' }} onClick={() => setDeleteNotice(null)}>
            إخفاء
          </button>
        </p>
      ) : null}
      {user?.role === 'super_admin' && items.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={items.filter((x) => !itemDeleteBlockedReason(x)).every((x) => selectedIds.has(x.id))}
              onChange={(e) =>
                setSelectedIds(e.target.checked ? new Set(items.filter((x) => !itemDeleteBlockedReason(x)).map((x) => x.id)) : new Set())
              }
            />
            تحديد كل البنود القابلة للحذف
          </label>
          {items.some((x) => selectedIds.has(x.id)) ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ color: 'var(--danger)' }}
              disabled={bulkBusy}
              onClick={() => void deleteSelectedItems()}
            >
              {bulkBusy ? 'جاري الحذف…' : `حذف المحدد (${items.filter((x) => selectedIds.has(x.id)).length})`}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0 }}>جاري التحميل…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            {viewAllPending
              ? 'لا توجد بنود معلّقة.'
              : 'لا توجد بنود معلّقة لهذا التاريخ. لعرض كل الأيام فعّل «عرض كل المعلّقة».'}
          </p>
        </div>
      ) : (
        <>
        {viewAllPending ? (
          <p style={{ margin: '1rem 0 0', color: 'var(--warning)', fontSize: '0.88rem' }}>
            عرض كل البنود المعلّقة من أي تاريخ.
          </p>
        ) : null}
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
          {items.map((b) => (
            <li key={b.id} className="card">
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                }}
              >
                <div>
                  {user?.role === 'super_admin' ? (
                    <input
                      type="checkbox"
                      aria-label="تحديد البند للحذف"
                      style={{ marginInlineEnd: '0.4rem' }}
                      disabled={bulkBusy || Boolean(itemDeleteBlockedReason(b))}
                      title={itemDeleteBlockedReason(b) || 'تحديد للحذف'}
                      checked={selectedIds.has(b.id)}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          const n = new Set(prev)
                          if (n.has(b.id)) n.delete(b.id)
                          else n.add(b.id)
                          return n
                        })
                      }
                    />
                  ) : null}
                  <strong>{b.patientName || 'مريض'}</strong>
                  <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>
                    {deptLabel[b.department] ?? b.department}
                  </span>
                  {b.businessDate ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      — {b.businessDate}
                    </span>
                  ) : null}
                  {b.department === 'laser' && (b.laserAreaLabels?.length ?? 0) > 0 ? (
                    <>
                      <LaserSessionAreas labels={b.laserAreaLabels || []} />
                      <LaserPulseChargeNote notes={b.laserPulseChargeNotes} />
                      <p style={{ margin: '0.3rem 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        المقدّم: {b.providerName || '—'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        {b.procedureLabel} — المقدّم: {b.providerName || '—'}
                      </p>
                      <LaserPulseChargeNote notes={b.laserPulseChargeNotes} />
                    </>
                  )}
                  {b.isCreditTopUp ? (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.84rem', color: 'var(--success)' }}>
                      شحن رصيد أسنان إضافي — بعد القبض يُضاف لرصيد الأسنان ويُخصم لاحقاً من إجراءات الأسنان فقط.
                    </p>
                  ) : null}
                  <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }} dir={itemBillingCurrency(b) === 'USD' ? 'ltr' : undefined}>
                    {formatItemDueLabel(b)}
                  </p>
                  {b.department === 'laser' ? <LaserVisitBillingBreakdown breakdown={b.laserVisitBreakdown} /> : null}
                  {itemPrepaidCreditSyp(b) > 0 && !b.isCreditTopUp ? (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem', color: 'var(--success)' }}>
                      {b.department === 'dental' ? 'رصيد أسنان إضافي' : 'رصيد إضافي للمريض'}:{' '}
                      {itemPrepaidCreditSyp(b).toLocaleString('ar-SY')} ل.س
                      {itemCreditTowardDueSyp(b) > 0 ? (
                        <>
                          {' '}
                          — يُخصم {itemCreditTowardDueSyp(b).toLocaleString('ar-SY')} ل.س من المستحق → متبقي للتحصيل:{' '}
                          <strong>{itemCashDueAfterCreditSyp(b).toLocaleString('ar-SY')} ل.س</strong>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {(b.outstandingDebtSyp || 0) > 0 || (b.outstandingDebtUsd || 0) > 0 ? (
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
                      ذمة قائمة:{' '}
                      {(b.outstandingDebtSyp || 0) > 0
                        ? `${(b.outstandingDebtSyp || 0).toLocaleString('ar-SY')} ل.س`
                        : ''}
                      {(b.outstandingDebtSyp || 0) > 0 && (b.outstandingDebtUsd || 0) > 0 ? ' + ' : ''}
                      {(b.outstandingDebtUsd || 0) > 0
                        ? `${Number(b.outstandingDebtUsd).toLocaleString('en-US', { maximumFractionDigits: 6 })} USD`
                        : ''}
                    </p>
                  ) : null}
                  {itemBillingCurrency(b) === 'USD' && itemEffectiveDueSyp(b) > 0 ? (
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      يعادل تقريباً {itemEffectiveDueSyp(b).toLocaleString('ar-SY')} ل.س عند سعر اليوم المحفوظ
                    </p>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {user?.role === 'super_admin' ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={
                          deleteBusyId === b.id ||
                          busyId === b.id ||
                          packageBusyId === b.id
                        }
                        onClick={() => setAdminEditItem(b)}
                      >
                        تعديل كامل
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={
                          bulkBusy ||
                          deleteBusyId === b.id ||
                          busyId === b.id ||
                          packageBusyId === b.id
                        }
                        title={itemDeleteBlockedReason(b) || 'يُلغى البند ويبقى في السجل مع اسم من حذفه'}
                        onClick={() => void deletePendingItem(b)}
                        style={{ color: 'var(--danger)', opacity: itemDeleteBlockedReason(b) ? 0.6 : 1 }}
                      >
                        {deleteBusyId === b.id ? 'جاري الحذف…' : 'حذف البند'}
                      </button>
                    </>
                  ) : null}
                  {itemIsLaserPackageVisit(b) && !b.laserPackageDeduction?.allDeducted ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={packageBusyId === b.id || busyId === b.id}
                      onClick={() => setDeductItem(b)}
                    >
                      {packageBusyId === b.id ? 'جاري الإنقاص…' : 'إنقاص جلسات المناطق'}
                    </button>
                  ) : null}
                  {itemHasCollectableDue(b) ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyId === b.id}
                      onClick={() =>
                        openPayModalForItem(b, {
                          setPayItem,
                          setPaySyp,
                          setPayUsd,
                          setPayCurrency,
                          setPayChannel,
                          setPayBankName,
                          setPayRefundCurrency,
                          setPayRefundAmount,
                          setPayDiscountEnabled,
                          setPayDiscountPercent,
                          setPayOpen,
                        })
                      }
                    >
                      {busyId === b.id ? '…' : 'تأكيد استلام الدفع'}
                    </button>
                  ) : !b.isPackagePrepaid ? (
                    <span className="chip" style={{ background: 'var(--warning-dim)', color: 'var(--amber)' }}>
                      مستحق ٠ — راجع الملف
                    </span>
                  ) : null}
                </div>
                {itemPackageMetricsMissing(b) ? (
                  <p style={{ margin: '0.35rem 0 0', color: 'var(--danger)', fontSize: '0.82rem' }}>
                    تعذر تحميل أرصدة مناطق الباكج — اضغط «تحديث». لن يظهر «إنقاص جلسات المناطق» قبل اكتمال قراءة المناطق.
                  </p>
                ) : itemIsLaserPackageVisit(b) ? (
                  <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    {b.laserPackageDeduction?.allDeducted
                      ? 'تم إنقاص مناطق الباكج لهذه الزيارة.'
                      : itemPendingAreaLabels(b).length > 0
                        ? `مناطق باكج عولجت في هذه الزيارة: ${itemPendingAreaLabels(b).join('، ')} — تُنقص جلسة واحدة من كل منطقة تختارها فقط.`
                        : 'لا توجد منطقة باكج مسجّلة في هذه الزيارة.'}
                    {(b.laserPackageDeduction?.uncoveredAreaLabels?.length ?? 0) > 0
                      ? ` لا رصيد لـ: ${b.laserPackageDeduction!.uncoveredAreaLabels!.join('، ')}.`
                      : ''}
                    {itemHasCollectableDue(b) ? ' على البند مبلغ قديم مستحق — يُحصّل بـ«تأكيد استلام الدفع» منفصلاً عن الإنقاص.' : ''}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
      {payOpen && payItem ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setPayOpen(false)
            setPayRefundCurrency('SYP')
            setPayRefundAmount('')
            setPayDiscountEnabled(false)
            setPayDiscountPercent('')
          }}
        >
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              تأكيد استلام الدفع
            </h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '-0.2rem' }}>
              {payItem.patientName}
              {payItem.department === 'laser' && (payItem.laserAreaLabels?.length ?? 0) > 0
                ? ''
                : ` — ${payItem.procedureLabel}`}
            </p>
            {payItem.department === 'laser' && (payItem.laserAreaLabels?.length ?? 0) > 0 ? (
              <>
                <LaserSessionAreas labels={payItem.laserAreaLabels || []} />
                <LaserPulseChargeNote notes={payItem.laserPulseChargeNotes} />
              </>
            ) : (
              <LaserPulseChargeNote notes={payItem.laserPulseChargeNotes} />
            )}
            {payItem.department === 'laser' ? <LaserVisitBillingBreakdown breakdown={payItem.laserVisitBreakdown} /> : null}
            <p style={{ margin: '0.35rem 0', fontWeight: 600 }} dir={itemBillingCurrency(payItem) === 'USD' ? 'ltr' : undefined}>
              المستحق: {formatItemDueLabel(payItem)}
            </p>
            {itemPrepaidCreditSyp(payItem) > 0 ? (
              <div
                style={{
                  margin: '0.35rem 0 0.15rem',
                  padding: '0.55rem 0.65rem',
                  borderRadius: 8,
                  background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
                  fontSize: '0.9rem',
                  lineHeight: 1.55,
                }}
              >
                <div>
                  {payItem.department === 'dental' ? 'رصيد أسنان إضافي' : 'رصيد إضافي للمريض'}:{' '}
                  <strong>{itemPrepaidCreditSyp(payItem).toLocaleString('ar-SY')} ل.س</strong>
                </div>
                {creditTowardDueSyp > 0 ? (
                  <div>
                    يُخصم تلقائياً من المستحق:{' '}
                    <strong>{creditTowardDueSyp.toLocaleString('ar-SY')} ل.س</strong>
                  </div>
                ) : null}
                <div>
                  المتبقي للتحصيل نقداً/بنكاً:{' '}
                  <strong>{cashDueAfterCreditSyp.toLocaleString('ar-SY')} ل.س</strong>
                  {cashDueAfterCreditSyp === 0 ? ' — يكفي الرصيد لتسديد البند بالكامل' : null}
                </div>
              </div>
            ) : null}
            {(payItem.outstandingDebtSyp || 0) > 0 || (payItem.outstandingDebtUsd || 0) > 0 ? (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--warning)' }}>
                تنبيه: على المريض ذمة قائمة
                {(payItem.outstandingDebtSyp || 0) > 0
                  ? ` ${(payItem.outstandingDebtSyp || 0).toLocaleString('ar-SY')} ل.س`
                  : ''}
                {(payItem.outstandingDebtSyp || 0) > 0 && (payItem.outstandingDebtUsd || 0) > 0 ? ' و' : ''}
                {(payItem.outstandingDebtUsd || 0) > 0
                  ? ` ${Number(payItem.outstandingDebtUsd).toLocaleString('en-US', { maximumFractionDigits: 6 })} USD`
                  : ''}
                .
              </p>
            ) : null}
            {itemBillingCurrency(payItem) === 'SYP' && payPreviewRate && itemEffectiveDueSyp(payItem) > 0 ? (
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }} dir="ltr">
                يعادل المستحق المحفوظ للبند:{' '}
                {(itemEffectiveDueSyp(payItem) / payPreviewRate).toLocaleString('en-US', {
                  maximumFractionDigits: 6,
                })}{' '}
                USD عند سعر {payPreviewRate.toLocaleString('ar-SY')} ل.س لكل 1 USD
              </p>
            ) : null}
            {itemBillingCurrency(payItem) === 'USD' && itemEffectiveDueSyp(payItem) > 0 ? (
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                السعر الأصلي بالدولار — يمكن التحصيل بالليرة أو بالدولار. الجرد يظهر عملة الاستلام فقط، دون فرق تسوية
                إذا طابق المبلغ المستحق.
              </p>
            ) : null}
            {payCurrency === 'USD' && payPreviewRate != null && usdCashOffer ? (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                وفق سعر اليوم ({payPreviewRate.toLocaleString('ar-SY')} ل.س لكل 1 USD): اقتراح عملي — استلام{' '}
                <strong dir="ltr">{usdCashOffer.usdFieldValue}</strong> USD
                {usdCashOffer.impliedRefundSyp > 0 ? (
                  <>
                    {' '}
                    ثم ترجيع <strong>{usdCashOffer.impliedRefundSyp.toLocaleString('ar-SY')}</strong> ل.س فيُحسب الصافي
                    مطابقاً للمستحق دون رصيد إضافي — اضغط «تعبئة المبلغ» لتعبئة المستلم والترجيع معاً.
                  </>
                ) : (
                  <> يطابق المستحق بالليرة. استخدم «تعبئة المبلغ» لتعبئة الحقل.</>
                )}
              </p>
            ) : payItem.businessDate && businessDate && payItem.businessDate !== businessDate ? (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
                تاريخ البند يختلف عن يوم العمل الحالي — عند الدفع بالدولار يُستخدم سعر الصرف المحفوظ لذلك التاريخ.
              </p>
            ) : payCurrency === 'USD' && !payPreviewRate ? (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
                لا يتوفر سعر صرف في الواجهة لهذا البند — سيتحقق الخادم من السعر المحفوظ لتاريخ البند.
              </p>
            ) : null}
            {!itemHasCollectableDue(payItem) ? (
              <p style={{ color: 'var(--danger)', marginTop: '0.35rem', fontSize: '0.88rem' }}>
                لا يمكن تأكيد الدفع: المستحق صفر. أغلق النافذة وراجع تسعير الجلسة في ملف المريض.
              </p>
            ) : null}
            {payItem.isCreditTopUp ? (
              <p style={{ margin: '0.55rem 0 0', fontSize: '0.86rem', color: 'var(--success)', lineHeight: 1.5 }}>
                هذا البند شحن رصيد أسنان إضافي. بعد تأكيد القبض يُضاف لرصيد الأسنان فقط، ثم يُخصم عند تحصيل إجراءات
                الأسنان — لا يُخصم لليزر أو الجلدية أو البشرة.
              </p>
            ) : null}
            {payItem.isCreditTopUp ? null : (
            <div style={{ marginTop: '0.55rem', paddingTop: '0.55rem', borderTop: '1px solid var(--border)' }}>
              {(Number(payItem.discountPercent) || 0) > 0 ? (
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  هذا البند عليه خصم مُدخل مسبقاً، وسيتم التحصيل على السعر بعد الخصم. يمكنك إضافة خصم آخر يُحسب على
                  المتبقي ويُسجَّل كسطر مستقل في ملف المريض.
                </p>
              ) : null}
              <DiscountEntryFields
                value={{
                  enabled: payDiscountEnabled,
                  mode: payDiscountMode,
                  percent: payDiscountPercent,
                  amount: payDiscountAmount,
                }}
                onChange={(patch) => {
                  const next = {
                    enabled: patch.enabled ?? payDiscountEnabled,
                    mode: patch.mode ?? payDiscountMode,
                    percent: patch.percent ?? payDiscountPercent,
                    amount: patch.amount ?? payDiscountAmount,
                  }
                  setPayDiscountEnabled(next.enabled)
                  setPayDiscountMode(next.mode)
                  setPayDiscountPercent(next.percent)
                  setPayDiscountAmount(next.amount)
                  if (payCurrency === 'SYP' && payItem) {
                    const pv = computeDiscountPreview({
                      baseSyp: discountBaseSyp,
                      mode: next.mode,
                      value: next.enabled ? (next.mode === 'amount' ? next.amount : next.percent) : '',
                    })
                    const eff = pv.valid ? pv.priceAfterSyp : discountBaseSyp
                    setPaySyp(String(itemCashDueAfterCreditSyp(payItem, eff)))
                  }
                }}
                baseSyp={discountBaseSyp}
                preview={discountPreview}
                allowAmount={itemBillingCurrency(payItem) !== 'USD'}
                isAdditional={(Number(payItem.discountPercent) || 0) > 0}
              />
            </div>
            )}
            <div style={{ marginTop: '0.55rem' }}>
              <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
                عملة التحصيل
              </span>
              {itemBillingCurrency(payItem) === 'USD' ? (
                <p style={{ margin: '0 0 0.45rem', fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  السعر من القسم بالدولار — الاستقبال يختار عملة المبلغ المستلم فعلياً، ويظهر الجرد بتلك العملة دون فرق
                  تسوية إذا طابق المستحق.
                </p>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-currency"
                    checked={payCurrency === 'SYP'}
                    onChange={() => {
                      setPayCurrency('SYP')
                      setPaySyp(String(cashDueAfterCreditSyp))
                      setPayRefundCurrency('SYP')
                      setPayRefundAmount('')
                    }}
                  />
                  ليرة سورية
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-currency"
                    checked={payCurrency === 'USD'}
                    onChange={() => {
                      setPayCurrency('USD')
                      if (itemBillingCurrency(payItem) === 'USD') {
                        setPayUsd(String(itemEffectiveDueUsd(payItem)))
                      } else if (payPreviewRate && cashDueAfterCreditSyp > 0) {
                        const o = usdRoundedUpCashOffer(cashDueAfterCreditSyp, payPreviewRate)
                        if (o) {
                          setPayUsd(o.usdFieldValue)
                          setPayRefundCurrency('SYP')
                          setPayRefundAmount('')
                        } else {
                          setPayUsd('')
                          setPayRefundAmount('')
                        }
                      } else {
                        setPayUsd('')
                        setPayRefundAmount('')
                      }
                    }}
                  />
                  دولار أمريكي (USD)
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-currency"
                    checked={payCurrency === 'MIXED'}
                    onChange={() => {
                      setPayCurrency('MIXED')
                      setPaySyp(String(cashDueAfterCreditSyp))
                      setPayUsd('')
                      setPayRefundCurrency('SYP')
                      setPayRefundAmount('')
                    }}
                  />
                  ليرة ودولار معاً
                </label>
              </div>
              {payCurrency === 'MIXED' && payPreviewRate ? (
                <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  يُحسب الإجمالي: ليرة نقدية + (دولار × {payPreviewRate.toLocaleString('ar-SY')}) ثم يُقارن بالمستحق.
                </p>
              ) : payCurrency === 'MIXED' && !payPreviewRate ? (
                <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--warning)' }}>
                  لا يتوفر سعر صرف — أدخل جزء الليرة فقط أو فعّل يوم العمل لإدخال الدولار.
                </p>
              ) : null}
            </div>
            <div style={{ marginTop: '0.55rem' }}>
              <span className="form-label" style={{ display: 'block', marginBottom: '0.35rem' }}>
                طريقة استلام الدفع
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-channel"
                    checked={payChannel === 'cash'}
                    onChange={() => {
                      setPayChannel('cash')
                      setPayBankName('')
                    }}
                  />
                  كاش
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="pay-channel"
                    checked={payChannel === 'bank'}
                    onChange={() => setPayChannel('bank')}
                  />
                  بنك
                </label>
              </div>
            </div>
            {payChannel === 'bank' ? (
              <div style={{ marginTop: '0.55rem' }}>
                <label className="form-label" htmlFor="pay-bank-select">
                  البنك
                </label>
                <select
                  id="pay-bank-select"
                  className="select"
                  value={payBankName}
                  onChange={(e) => setPayBankName(e.target.value)}
                  style={{ maxWidth: '100%', marginTop: '0.25rem' }}
                >
                  <option value="">— اختر البنك —</option>
                  {bankOptions.map((bk) => (
                    <option key={bk.id} value={bk.name}>
                      {bk.name}
                    </option>
                  ))}
                </select>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  بعد اختيار البنك، أدخل المبلغ المستلم{' '}
                  {payCurrency === 'USD'
                    ? 'بالدولار'
                    : payCurrency === 'MIXED'
                      ? 'بالليرة و/أو بالدولار'
                      : 'بالليرة'}{' '}
                  أدناه.
                </p>
              </div>
            ) : null}
            <div style={{ marginTop: '0.5rem' }}>
              {payCurrency === 'SYP' ? (
                <>
                  <label className="form-label">المبلغ المستلم (ل.س)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={paySyp}
                    onChange={(e) => setPaySyp(e.target.value)}
                    placeholder="0"
                    style={{ marginTop: '0.25rem', maxWidth: 280 }}
                  />
                </>
              ) : payCurrency === 'MIXED' ? (
                <>
                  <label className="form-label">المبلغ المستلم نقداً (ل.س)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={paySyp}
                    onChange={(e) => setPaySyp(e.target.value)}
                    placeholder="0"
                    style={{ marginTop: '0.25rem', maxWidth: 280 }}
                  />
                  <label className="form-label" style={{ display: 'block', marginTop: '0.55rem' }}>
                    المبلغ المستلم (USD)
                  </label>
                  <input
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    step="any"
                    value={payUsd}
                    onChange={(e) => setPayUsd(e.target.value)}
                    placeholder="0"
                    style={{ marginTop: '0.25rem', maxWidth: 320 }}
                  />
                  {payPreviewRate ? (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      مقابل الدولار بالليرة = USD × {payPreviewRate.toLocaleString('ar-SY')} (تقريب أقرب ليرة).
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="form-label">المبلغ المستلم (USD)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    step="any"
                    value={payUsd}
                    onChange={(e) => setPayUsd(e.target.value)}
                    placeholder="0"
                    style={{ marginTop: '0.25rem', maxWidth: 320 }}
                  />
                  {payPreviewRate && effectiveDueSyp > 0 && usdCashOffer ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}
                      onClick={() => applyUsdCashOfferFill()}
                    >
                      تعبئة المبلغ (دولار مُقرّب + ترجيع ليرة عند الحاجة)
                    </button>
                  ) : null}
                  {payPreviewRate ? (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      المقابل بالليرة = المبلغ بالدولار × {payPreviewRate.toLocaleString('ar-SY')} (تقريب أقرب ليرة). إن
                      احتجت دولاراً مُقرّباً مع ترجيع بالليرة لمطابقة المستحق دون رصيد زائد، استخدم زر «تعبئة المبلغ»؛
                      وإلا اترك الترجيع فارغاً (مثلاً قبض المبلغ بالدولار فقط عندما يكفي ذلك).
                    </p>
                  ) : null}
                  <div
                    style={{
                      marginTop: '0.65rem',
                      paddingTop: '0.65rem',
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <span className="form-label" style={{ display: 'block', marginBottom: '0.25rem' }}>
                      ترجيع
                    </span>
                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      المبلغ الذي رُدّ للمريض بعد التحصيل (إن وُجد). يُطرح من المستلم لحساب الصافي مقابل المستحق ولن
                      يُسجَّل رصيد إضافي إذا كان الصافي يطابق المستحق.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="refund-currency"
                          checked={payRefundCurrency === 'SYP'}
                          onChange={() => setPayRefundCurrency('SYP')}
                        />
                        بالليرة السورية
                      </label>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="refund-currency"
                          checked={payRefundCurrency === 'USD'}
                          onChange={() => setPayRefundCurrency('USD')}
                        />
                        بالدولار (USD)
                      </label>
                    </div>
                    <label className="form-label" style={{ display: 'block', marginTop: '0.45rem' }}>
                      مبلغ الترجيع {payRefundCurrency === 'SYP' ? '(ل.س)' : '(USD)'}
                    </label>
                    <input
                      className="input"
                      inputMode="decimal"
                      dir={payRefundCurrency === 'USD' ? 'ltr' : undefined}
                      step={payRefundCurrency === 'USD' ? 'any' : undefined}
                      value={payRefundAmount}
                      onChange={(e) => setPayRefundAmount(e.target.value)}
                      placeholder="اتركه فارغاً إن لم يكن هناك ترجيع"
                      style={{ marginTop: '0.25rem', maxWidth: 320 }}
                    />
                  </div>
                </>
              )}
            </div>
            {(() => {
              const due = cashDueAfterCreditSyp
              const fullDue = effectiveDueSyp
              if (!(fullDue > 0)) return null
              let grossSyp = 0
              let netSyp = 0
              let refSyp = 0
              let refUsd = 0
              let usdParsed = 0
              if (payCurrency === 'SYP') {
                const syp = Number(normalizeDecimalDigits(paySyp))
                if (!Number.isFinite(syp) || syp < 0) return null
                grossSyp = Math.round(syp)
                netSyp = grossSyp
                if (grossSyp === 0) {
                  if (due === 0 && creditTowardDueSyp > 0) {
                    return (
                      <p style={{ marginTop: '0.45rem', color: 'var(--success)' }}>
                        يكفي الرصيد الإضافي ({creditTowardDueSyp.toLocaleString('ar-SY')} ل.س) لتسديد المستحق بالكامل
                        — لن يُحصَّل نقداً وتُصفّى الحساب للبند.
                      </p>
                    )
                  }
                  return (
                    <p style={{ marginTop: '0.45rem', color: 'var(--warning)' }}>
                      لن يُحصَّل مبلغ — سيُخصم الرصيد الإضافي إن وُجد، ويُسجَّل الباقي كذمة (
                      {due.toLocaleString('ar-SY')} ل.س).
                    </p>
                  )
                }
              } else if (payCurrency === 'MIXED') {
                const syp = Number(normalizeDecimalDigits(paySyp))
                const usdRaw = normalizeDecimalDigits(payUsd).trim()
                const usd = usdRaw === '' ? 0 : parseFloat(usdRaw)
                if (!Number.isFinite(syp) || syp < 0 || !Number.isFinite(usd) || usd < 0) return null
                netSyp = mixedNetReceivedSyp(syp, usd, payPreviewRate || 0)
                grossSyp = netSyp
                if (netSyp === 0 && syp === 0 && usd === 0) {
                  if (due === 0 && creditTowardDueSyp > 0) {
                    return (
                      <p style={{ marginTop: '0.45rem', color: 'var(--success)' }}>
                        يكفي الرصيد الإضافي لتسديد المستحق بالكامل — تُصفّى الحساب للبند دون قبض نقدي.
                      </p>
                    )
                  }
                  return (
                    <p style={{ marginTop: '0.45rem', color: 'var(--warning)' }}>
                      لن يُحصَّل مبلغ — سيُخصم الرصيد الإضافي إن وُجد، ويُسجَّل الباقي كذمة (
                      {due.toLocaleString('ar-SY')} ل.س).
                    </p>
                  )
                }
              } else {
                const usdRaw = normalizeDecimalDigits(payUsd).trim()
                const usd = usdRaw === '' ? 0 : parseFloat(usdRaw)
                usdParsed = usd
                if (!Number.isFinite(usd) || usd < 0) return null
                if (usd === 0) {
                  if (due === 0 && creditTowardDueSyp > 0) {
                    return (
                      <p style={{ marginTop: '0.45rem', color: 'var(--success)' }}>
                        يكفي الرصيد الإضافي لتسديد المستحق بالكامل — تُصفّى الحساب للبند دون قبض نقدي.
                      </p>
                    )
                  }
                  return (
                    <p style={{ marginTop: '0.45rem', color: 'var(--warning)' }}>
                      لن يُحصَّل مبلغ — سيُخصم الرصيد الإضافي إن وُجد، ويُسجَّل الباقي كذمة (
                      {due.toLocaleString('ar-SY')} ل.س).
                    </p>
                  )
                }
                if (!payPreviewRate) return null
                grossSyp = Math.round(usd * payPreviewRate)
                if (payRefundAmount.trim()) {
                  if (payRefundCurrency === 'SYP') {
                    const r = Number(normalizeDecimalDigits(payRefundAmount))
                    if (Number.isFinite(r) && r > 0) refSyp = Math.round(r)
                  } else {
                    const r = parseFloat(normalizeDecimalDigits(payRefundAmount))
                    if (Number.isFinite(r) && r > 0) refUsd = r
                  }
                }
                netSyp = netReceivedSypAfterUsdCollection({
                  amountUsd: usd,
                  patientRefundSyp: refSyp,
                  patientRefundUsd: refUsd,
                  rate: payPreviewRate,
                })
              }
              if (!(grossSyp > 0) && netSyp === 0 && payCurrency !== 'MIXED') return null

              if (payCurrency === 'USD' && netSyp < 0) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--danger)' }}>
                    صافي المبلغ بعد الترجيع غير كافٍ — راجع المستلم بالدولار ومبلغ الترجيع.
                  </p>
                )
              }

              let delta = netSyp - due
              if (payCurrency === 'USD' && payPreviewRate) {
                delta = settlementDeltaAfterUsdCashNetAbsorb({
                  payCurrency: 'USD',
                  netReceivedSyp: netSyp,
                  amountDueSyp: due,
                  rate: payPreviewRate,
                  amountUsd: usdParsed,
                  patientRefundSyp: refSyp,
                  patientRefundUsd: refUsd,
                })
              }
              if (Math.abs(netSyp - due) <= 1) delta = 0
              if (
                payCurrency === 'USD' &&
                payItem &&
                itemBillingCurrency(payItem) === 'USD' &&
                !refSyp &&
                !refUsd
              ) {
                const dueU = itemEffectiveDueUsd(payItem)
                if (dueU > 0 && Math.abs(usdParsed - dueU) < 0.02) delta = 0
              }
              if (delta < 0) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--warning)' }}>
                    {creditTowardDueSyp > 0 ? (
                      <>
                        بعد خصم الرصيد الإضافي ({creditTowardDueSyp.toLocaleString('ar-SY')} ل.س من أصل مستحق{' '}
                        {fullDue.toLocaleString('ar-SY')} ل.س): الصافي أقل من المتبقي — ذمة{' '}
                        {Math.abs(delta).toLocaleString('ar-SY')} ل.س.
                      </>
                    ) : (
                      <>
                        الصافي بعد الترجيع أقل من المستحق — سيتم تسجيل الباقي كذمة على المريض (
                        {Math.abs(delta).toLocaleString('ar-SY')} ل.س).
                      </>
                    )}
                  </p>
                )
              }
              if (delta > 0) {
                return (
                  <p style={{ marginTop: '0.45rem', color: 'var(--success)' }}>
                    {creditTowardDueSyp > 0 ? (
                      <>
                        بعد خصم الرصيد الإضافي: الصافي أعلى من المتبقي — زيادة{' '}
                        {delta.toLocaleString('ar-SY')} ل.س تُضاف للرصيد الإضافي (بعد تسديد أي ذمة قائمة).
                      </>
                    ) : (
                      <>
                        الصافي بعد الترجيع أعلى من المستحق — سيتم تسجيل الزيادة كرصيد إضافي للمريض (
                        {delta.toLocaleString('ar-SY')} ل.س).
                      </>
                    )}
                  </p>
                )
              }
              return (
                <p style={{ marginTop: '0.45rem', color: 'var(--text-muted)' }}>
                  {creditTowardDueSyp > 0
                    ? `تصفية تامة للبند: رصيد إضافي ${creditTowardDueSyp.toLocaleString('ar-SY')} ل.س + صافي مستلم مطابق للمتبقي.`
                    : `الصافي بعد الترجيع مطابق للمستحق${payDiscountEnabled ? ' بعد الخصم' : ''} (محاسبياً بالليرة).`}
                </p>
              )
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPayOpen(false)
                  setPayRefundCurrency('SYP')
                  setPayRefundAmount('')
                  setPayDiscountEnabled(false)
                  setPayDiscountPercent('')
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyId === payItem.id || !itemHasCollectableDue(payItem)}
                onClick={() => void completePay(payItem.id)}
              >
                {busyId === payItem.id ? 'جاري الحفظ…' : 'تأكيد استلام الدفع'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deductItem && deductItem.laserPackageDeduction && deductItem.laserSessionId ? (
        <LaserAreaDeductionModal
          patientId={deductItem.patientId}
          patientName={deductItem.patientName}
          laserSessionId={deductItem.laserSessionId}
          preview={deductItem.laserPackageDeduction}
          onClose={() => setDeductItem(null)}
          onBusy={(busy) => setPackageBusyId(busy ? deductItem.id : null)}
          onDone={async () => {
            setDeductItem(null)
            await load()
          }}
        />
      ) : null}

      {adminEditItem && user?.role === 'super_admin' ? (
        <BillingItemAdminEditModal
          billingItemId={adminEditItem.id}
          onClose={() => setAdminEditItem(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </>
  )
}
