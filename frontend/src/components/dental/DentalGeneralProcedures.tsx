import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useClinic } from '../../context/ClinicContext'
import {
  emptyLabWork,
  emptyTreatment,
  formatUsdAmount,
  generalAnesthesiaEffectiveSyp,
  labEffectiveAmountSyp,
  labWorkHasData,
  normalizeLabWork,
  normalizeTreatment,
  roundUsd,
  treatmentEffectiveTotalSyp,
  treatmentHasData,
  treatmentPaidTotal,
  treatmentPaidTotalUsd,
  treatmentRemaining,
  type DentalChartDto,
  type DentalLabWork,
  type DentalToothTreatment,
} from './dentalChartTypes'
import type { DentalLabOption, DentalProviderOption } from './ToothTreatmentModal'

type Props = {
  patientId: string
  canEdit: boolean
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** معرّف ObjectId صالح يُرسل للخادم لربط المخبر بالإجراء عند الإنشاء */
function newClientObjectId() {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0')
  let rest = ''
  for (let i = 0; i < 16; i += 1) rest += Math.floor(Math.random() * 16).toString(16)
  return `${time}${rest}`
}

function softLabKey(t: Pick<DentalToothTreatment, 'businessDate' | 'procedureDescription' | 'providerUserId' | 'doctorName'>) {
  return [
    String(t.businessDate || '').trim(),
    String(t.procedureDescription || '').trim(),
    String(t.providerUserId || '').trim(),
    String(t.doctorName || '').trim(),
  ].join('|')
}

export function DentalGeneralProcedures({ patientId, canEdit }: Props) {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'super_admin'
  const { usdSypRate } = useClinic()
  const rate = usdSypRate != null && usdSypRate > 0 ? usdSypRate : null

  const [rows, setRows] = useState<DentalToothTreatment[]>([])
  const [labRows, setLabRows] = useState<DentalLabWork[]>([])
  const [providers, setProviders] = useState<DentalProviderOption[]>([])
  const [labs, setLabs] = useState<DentalLabOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [desc, setDesc] = useState('')
  const [costSyp, setCostSyp] = useState(0)
  const [costUsd, setCostUsd] = useState(0)
  const [providerId, setProviderId] = useState('')
  const [businessDate, setBusinessDate] = useState(todayIsoDate)
  const [labId, setLabId] = useState('')
  const [labAmountSyp, setLabAmountSyp] = useState(0)
  const [labAmountUsd, setLabAmountUsd] = useState(0)
  const [generalAnesthesia, setGeneralAnesthesia] = useState(false)
  const [gaAmountSyp, setGaAmountSyp] = useState(0)
  const [gaAmountUsd, setGaAmountUsd] = useState(0)

  const load = useCallback(async () => {
    setErr('')
    setLoading(true)
    try {
      const [chartRes, providersRes, labsRes] = await Promise.all([
        api<{ chart: DentalChartDto }>(`/api/dental/chart/${encodeURIComponent(patientId)}`),
        api<{ providers: DentalProviderOption[] }>('/api/dental/providers').catch(() => ({
          providers: [] as DentalProviderOption[],
        })),
        api<{ labs: DentalLabOption[] }>('/api/dental/labs').catch(() => ({
          labs: [] as DentalLabOption[],
        })),
      ])
      setProviders(providersRes.providers || [])
      setLabs(labsRes.labs || [])
      const list = (chartRes.chart?.generalTreatments || []).map((t) => normalizeTreatment(t, rate))
      setRows(list.filter(treatmentHasData))
      const labsList = (chartRes.chart?.generalLabWorks || []).map((x) => normalizeLabWork(x, rate))
      setLabRows(labsList.filter(labWorkHasData))
    } catch (e) {
      setRows([])
      setLabRows([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الإجراءات العامة')
    } finally {
      setLoading(false)
    }
  }, [patientId, rate])

  useEffect(() => {
    void load()
  }, [load])

  const labByTreatmentId = useMemo(() => {
    const map = new Map<string, DentalLabWork>()
    const used = new Set<string>()
    for (const lab of labRows) {
      const link = lab.linkedGeneralTreatmentId ? String(lab.linkedGeneralTreatmentId) : ''
      if (link && !map.has(link)) {
        map.set(link, lab)
        if (lab.id) used.add(lab.id)
      }
    }
    for (const t of rows) {
      const tid = t.id ? String(t.id) : ''
      if (!tid || map.has(tid)) continue
      const key = softLabKey(t)
      const match = labRows.find((lab) => {
        if (lab.id && used.has(lab.id)) return false
        if (lab.linkedGeneralTreatmentId) return false
        return softLabKey({
          businessDate: lab.businessDate,
          procedureDescription: lab.procedureDescription,
          providerUserId: lab.providerUserId || null,
          doctorName: lab.doctorName || '',
        }) === key
      })
      if (match) {
        map.set(tid, match)
        if (match.id) used.add(match.id)
      }
    }
    return map
  }, [rows, labRows])

  const orphanLabs = useMemo(() => {
    const linkedIds = new Set(
      [...labByTreatmentId.values()].map((l) => (l.id ? String(l.id) : '')).filter(Boolean),
    )
    return labRows.filter((l) => !(l.id && linkedIds.has(String(l.id))))
  }, [labRows, labByTreatmentId])

  function resetForm() {
    setDesc('')
    setCostSyp(0)
    setCostUsd(0)
    setProviderId('')
    setBusinessDate(todayIsoDate())
    setLabId('')
    setLabAmountSyp(0)
    setLabAmountUsd(0)
    setGeneralAnesthesia(false)
    setGaAmountSyp(0)
    setGaAmountUsd(0)
  }

  async function saveAll(nextTreatments: DentalToothTreatment[], nextLabs: DentalLabWork[]) {
    setSaving(true)
    setErr('')
    setOkMsg('')
    try {
      const treatmentsPayload = nextTreatments
        .map((t) =>
          normalizeTreatment({
            ...t,
            procedureDescription: String(t.procedureDescription || '').trim(),
          }),
        )
        .filter(treatmentHasData)
      const labsPayload = nextLabs
        .map((x) =>
          normalizeLabWork(
            {
              ...x,
              procedureDescription: String(x.procedureDescription || '').trim(),
            },
            rate,
          ),
        )
        .filter(labWorkHasData)
      const data = await api<{ chart: DentalChartDto }>(
        `/api/dental/chart/${encodeURIComponent(patientId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            generalTreatments: treatmentsPayload,
            generalLabWorks: labsPayload,
          }),
        },
      )
      const list = (data.chart?.generalTreatments || []).map((t) => normalizeTreatment(t, rate))
      setRows(list.filter(treatmentHasData))
      const labsList = (data.chart?.generalLabWorks || []).map((x) => normalizeLabWork(x, rate))
      setLabRows(labsList.filter(labWorkHasData))
      setOkMsg('تم الحفظ — البنود ذات السعر تذهب للتحصيل')
      return true
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حفظ الإجراء العام')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function addProcedure() {
    const description = desc.trim()
    if (!description) {
      setErr('أدخل وصف الإجراء (مثل تنظيف أو تبييض)')
      return
    }
    if (!(costSyp >= 0) || !(costUsd >= 0)) {
      setErr('السعر غير صالح')
      return
    }
    const p = providers.find((x) => x.id === providerId)
    if (!p) {
      setErr('اختر الطبيب')
      return
    }

    const selectedLab = labId ? labs.find((x) => x.id === labId) : null
    if (labId && !selectedLab) {
      setErr('اختر مخبراً صالحاً أو اتركه فارغاً')
      return
    }
    if (selectedLab && !(labAmountSyp > 0) && !(labAmountUsd > 0)) {
      setErr('أدخل مبلغ المخبر (ل.س أو دولار) أو أزل اختيار المخبر')
      return
    }
    if (generalAnesthesia && !(gaAmountSyp > 0) && !(gaAmountUsd > 0)) {
      setErr('أدخل مبلغ التخدير العام أو أزل التحديد')
      return
    }

    const treatmentId = newClientObjectId()
    const row = normalizeTreatment(
      {
        ...emptyTreatment(),
        id: treatmentId,
        procedureDescription: description,
        totalCostSyp: costSyp,
        totalCostUsd: costUsd,
        costUsdSypRate: costUsd > 0 ? rate || 0 : 0,
        doctorName: p.name,
        providerUserId: p.id,
        providerKey: p.id === '__elias__' || p.noShare ? 'elias' : '',
        businessDate,
        payments: [],
        generalAnesthesia,
        generalAnesthesiaAmountSyp: generalAnesthesia ? gaAmountSyp : 0,
        generalAnesthesiaAmountUsd: generalAnesthesia ? gaAmountUsd : 0,
        generalAnesthesiaUsdSypRate: generalAnesthesia && gaAmountUsd > 0 ? rate || 0 : 0,
      },
      rate,
    )

    let nextLabs = labRows
    if (selectedLab) {
      const labRow = normalizeLabWork(
        {
          ...emptyLabWork(),
          labId: selectedLab.id,
          labName: selectedLab.name,
          procedureDescription: description,
          amountSyp: labAmountSyp,
          amountUsd: labAmountUsd,
          usdSypRate: labAmountUsd > 0 ? rate || 0 : 0,
          businessDate,
          doctorName: p.name,
          providerUserId: p.id,
          providerKey: p.id === '__elias__' || p.noShare ? 'elias' : '',
          linkedGeneralTreatmentId: treatmentId,
        },
        rate,
      )
      nextLabs = [...labRows, labRow]
    }

    const ok = await saveAll([...rows, row], nextLabs)
    if (ok) resetForm()
  }

  async function removeRow(idx: number) {
    if (!canEdit || saving) return
    const t = rows[idx]
    if (!t) return
    const tid = t.id ? String(t.id) : ''
    const effective = treatmentEffectiveTotalSyp(t, rate)
    const paid = treatmentPaidTotal(t)
    const remaining = treatmentRemaining(t, rate)
    const isPaid = t.billingStatus === 'paid' || (effective > 0 && paid > 0 && remaining <= 0)

    if (isPaid && !isSuperAdmin) {
      setErr('لا يمكن حذف إجراء محصّل — يحتاجه مدير النظام')
      return
    }

    if (isSuperAdmin && tid) {
      const confirmMsg = isPaid
        ? 'حذف هذا الإجراء العام نهائياً مع كل سجلاته المالية (حتى لو كان محصّلاً)؟\nسيُحذف من التحصيل والجرد واللوحة المالية، ويُزال أي مخبر مرتبط.'
        : 'حذف هذا الإجراء العام نهائياً مع سجلاته المالية وأي مخبر مرتبط؟'
      if (!window.confirm(confirmMsg)) return
      setSaving(true)
      setErr('')
      setOkMsg('')
      try {
        await api(
          `/api/dental/admin/patients/${encodeURIComponent(patientId)}/treatments/${encodeURIComponent(tid)}`,
          { method: 'DELETE' },
        )
        setOkMsg('تم حذف الإجراء العام وسجلاته المالية.')
        await load()
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : 'تعذر حذف الإجراء')
      } finally {
        setSaving(false)
      }
      return
    }

    if (!window.confirm('حذف هذا الإجراء العام؟' + (tid && labByTreatmentId.has(tid) ? ' (مع المخبر المرتبط إن وُجد)' : ''))) {
      return
    }
    const linkedLab = tid ? labByTreatmentId.get(tid) : null
    const nextLabs = linkedLab
      ? labRows.filter((l) => l !== linkedLab && !(linkedLab.id && l.id === linkedLab.id))
      : labRows
    await saveAll(
      rows.filter((_, i) => i !== idx),
      nextLabs,
    )
  }

  async function removeOrphanLab(lab: DentalLabWork) {
    if (!canEdit || saving) return
    if (!window.confirm('حذف سجل المخبر هذا؟')) return
    await saveAll(
      rows,
      labRows.filter((l) => l !== lab && !(lab.id && l.id === lab.id)),
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2 className="card-title">إجراءات عامة</h2>
      <p style={{ marginTop: '-0.35rem', marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
        إجراءات على كامل الفم وليست مرتبطة بسن واحد — مثل التنظيف أو التبييض. يمكن إدخال 0 ل.س أو 0 دولار (مجاني). عند
        إدخال سعر أكبر من صفر مع الطبيب يُرسل البند إلى التحصيل. يمكن اختيار مخبر أو تخدير عام اختيارياً؛ تكلفتهما تُحسب
        مالياً مثل المخابر
        {isSuperAdmin
          ? '. مدير النظام يمكنه حذف أي إجراء عام مع كل سجلاته المالية حتى بعد التحصيل.'
          : '.'}
      </p>

      {err ? (
        <p style={{ color: 'var(--danger)', margin: '0 0 0.75rem', fontSize: '0.88rem' }}>{err}</p>
      ) : null}
      {okMsg ? (
        <p style={{ color: 'var(--success)', margin: '0 0 0.75rem', fontSize: '0.88rem' }}>{okMsg}</p>
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
      ) : (
        <>
          {rows.length === 0 && orphanLabs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: '0 0 1rem' }}>لا توجد إجراءات عامة بعد.</p>
          ) : (
            <div className="table-wrap" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الوصف</th>
                    <th>الطبيب</th>
                    <th>السعر</th>
                    <th>المخبر</th>
                    <th>تخدير عام</th>
                    <th>التحصيل</th>
                    {canEdit ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, idx) => {
                    const effective = treatmentEffectiveTotalSyp(t, rate)
                    const paid = treatmentPaidTotal(t)
                    const paidUsd = treatmentPaidTotalUsd(t)
                    const remaining = treatmentRemaining(t, rate)
                    const statusLabel =
                      t.billingStatus === 'paid' || (paid > 0 && remaining <= 0)
                        ? 'محصّل'
                        : t.billingStatus === 'pending_payment' || t.billingItemId
                          ? 'بانتظار التحصيل'
                          : '—'
                    const linkedLab = t.id ? labByTreatmentId.get(String(t.id)) : undefined
                    const labEffective = linkedLab ? labEffectiveAmountSyp(linkedLab, rate) : 0
                    const gaEffective = generalAnesthesiaEffectiveSyp(t, rate)
                    return (
                      <tr key={t.id || `g-${idx}`}>
                        <td>{t.businessDate || '—'}</td>
                        <td>{t.procedureDescription.trim() || '—'}</td>
                        <td>{t.doctorName || '—'}</td>
                        <td>
                          {effective.toLocaleString('ar-SY')} ل.س
                          {t.totalCostUsd > 0 ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              منها {formatUsdAmount(t.totalCostUsd)} USD
                              {paidUsd > 0 ? ` · محصّل ${formatUsdAmount(paidUsd)} USD` : ''}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {linkedLab ? (
                            <>
                              {linkedLab.labName || '—'}
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {labEffective.toLocaleString('ar-SY')} ل.س
                                {linkedLab.amountUsd > 0
                                  ? ` · ${formatUsdAmount(linkedLab.amountUsd)} USD`
                                  : ''}
                              </div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {t.generalAnesthesia && gaEffective > 0 ? (
                            <>
                              نعم
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {gaEffective.toLocaleString('ar-SY')} ل.س
                                {(t.generalAnesthesiaAmountUsd || 0) > 0
                                  ? ` · ${formatUsdAmount(t.generalAnesthesiaAmountUsd || 0)} USD`
                                  : ''}
                              </div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td
                          style={{
                            color:
                              statusLabel === 'محصّل'
                                ? 'var(--success)'
                                : statusLabel === 'بانتظار التحصيل'
                                  ? 'var(--warning)'
                                  : undefined,
                          }}
                        >
                          {statusLabel}
                        </td>
                        {canEdit ? (
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.78rem' }}
                              disabled={saving || (t.billingStatus === 'paid' && !isSuperAdmin)}
                              title={
                                t.billingStatus === 'paid' && !isSuperAdmin
                                  ? 'لا يمكن حذف إجراء محصّل إلا لمدير النظام'
                                  : isSuperAdmin
                                    ? 'حذف الإجراء مع سجلاته المالية'
                                    : undefined
                              }
                              onClick={() => void removeRow(idx)}
                            >
                              حذف
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                  {orphanLabs.map((lab, idx) => {
                    const labEffective = labEffectiveAmountSyp(lab, rate)
                    return (
                      <tr key={lab.id || `orphan-lab-${idx}`}>
                        <td>{lab.businessDate || '—'}</td>
                        <td>{lab.procedureDescription.trim() || 'مخبر'}</td>
                        <td>{lab.doctorName || '—'}</td>
                        <td>—</td>
                        <td>
                          {lab.labName || '—'}
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {labEffective.toLocaleString('ar-SY')} ل.س
                            {lab.amountUsd > 0 ? ` · ${formatUsdAmount(lab.amountUsd)} USD` : ''}
                          </div>
                        </td>
                        <td>—</td>
                        <td>—</td>
                        {canEdit ? (
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.78rem' }}
                              disabled={saving}
                              onClick={() => void removeOrphanLab(lab)}
                            >
                              حذف
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canEdit ? (
            <div
              style={{
                display: 'grid',
                gap: '0.65rem',
                padding: '0.85rem',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                marginBottom: '1rem',
              }}
            >
              <strong style={{ fontSize: '0.92rem' }}>إضافة إجراء عام</strong>
              <label className="form-label">وصف الإجراء</label>
              <input
                className="input"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="مثال: تنظيف أسنان / تبييض"
                disabled={saving}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '0.55rem',
                }}
              >
                <div>
                  <label className="form-label">السعر (ل.س)</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={String(costSyp)}
                    onChange={(e) =>
                      setCostSyp(Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)))
                    }
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="form-label">السعر (USD)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={String(costUsd)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^\d.]/g, '')
                      setCostUsd(Math.max(0, roundUsd(Number(cleaned) || 0)))
                    }}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="form-label">التاريخ</label>
                  <input
                    className="input"
                    type="date"
                    value={businessDate}
                    onChange={(e) => setBusinessDate(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="form-label">الطبيب</label>
                  <select
                    className="select"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    disabled={saving}
                  >
                    <option value="">— اختر الطبيب —</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">المخبر (اختياري)</label>
                  {labs.length > 0 ? (
                    <select
                      className="select"
                      value={labId}
                      onChange={(e) => {
                        setLabId(e.target.value)
                        if (!e.target.value) {
                          setLabAmountSyp(0)
                          setLabAmountUsd(0)
                        }
                      }}
                      disabled={saving}
                    >
                      <option value="">— بدون مخبر —</option>
                      {labs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      لا مخابر في القائمة — أضفها من صفحة «المخابر» إن لزم.
                    </p>
                  )}
                </div>
                {labId ? (
                  <>
                    <div>
                      <label className="form-label">مبلغ المخبر (ل.س)</label>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={String(labAmountSyp)}
                        onChange={(e) =>
                          setLabAmountSyp(
                            Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)),
                          )
                        }
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className="form-label">مبلغ المخبر (USD)</label>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={String(labAmountUsd)}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^\d.]/g, '')
                          setLabAmountUsd(Math.max(0, roundUsd(Number(cleaned) || 0)))
                        }}
                        disabled={saving}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem',
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={generalAnesthesia}
                  onChange={(e) => {
                    setGeneralAnesthesia(e.target.checked)
                    if (!e.target.checked) {
                      setGaAmountSyp(0)
                      setGaAmountUsd(0)
                    }
                  }}
                  disabled={saving}
                />
                تخدير عام
              </label>
              {generalAnesthesia ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '0.55rem',
                  }}
                >
                  <div>
                    <label className="form-label">مبلغ التخدير (ل.س)</label>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={String(gaAmountSyp)}
                      onChange={(e) =>
                        setGaAmountSyp(
                          Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)),
                        )
                      }
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="form-label">مبلغ التخدير (USD)</label>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={String(gaAmountUsd)}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^\d.]/g, '')
                        setGaAmountUsd(Math.max(0, roundUsd(Number(cleaned) || 0)))
                      }}
                      disabled={saving}
                    />
                  </div>
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => void addProcedure()}
                >
                  {saving
                    ? 'جاري الحفظ…'
                    : costSyp > 0 || costUsd > 0
                      ? 'حفظ وإرسال للتحصيل'
                      : 'حفظ'}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
