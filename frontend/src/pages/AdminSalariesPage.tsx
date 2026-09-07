import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type Payment = {
  id: string
  amountSyp: number
  amountUsd: number
  usdSypRate: number
  effectiveAmountSyp: number
  businessDate: string
  note: string
}

type EmployeeRow = {
  id: string
  name: string
  title: string
  monthlySalarySyp: number
  active: boolean
  paymentCount: number
  paidSyp: number
  remainingSyp: number
  lastPaymentDate: string
  payments: Payment[]
}

type Payload = {
  from: string
  to: string
  employees: EmployeeRow[]
  totals: { employeeCount: number; paymentCount: number; paidSyp: number }
}

function monthStartYmd(businessDate: string) {
  const d = String(businessDate || '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d.slice(0, 7)}-01`
  const x = new Date()
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(Math.round(n || 0))} ل.س`
}

const cell: CSSProperties = {
  border: '1px solid #c5d0c8',
  padding: '0.28rem 0.4rem',
  fontSize: '0.84rem',
  verticalAlign: 'middle',
  background: '#fff',
}

const headCell: CSSProperties = {
  ...cell,
  background: '#1b5e3b',
  color: '#fff',
  fontWeight: 700,
  position: 'sticky',
  top: 0,
  zIndex: 1,
  whiteSpace: 'nowrap',
}

const inputCell: CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  font: 'inherit',
  padding: 0,
}

export function AdminSalariesPage() {
  const { user } = useAuth()
  const { businessDate, usdSypRate } = useClinic()
  const allowed = user?.role === 'super_admin'

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newMonthly, setNewMonthly] = useState('')

  const [payEmp, setPayEmp] = useState<string | null>(null)
  const [paySyp, setPaySyp] = useState('')
  const [payUsd, setPayUsd] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payNote, setPayNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!from && businessDate) setFrom(monthStartYmd(businessDate))
    if (!to && businessDate) setTo(businessDate)
    if (!payDate && businessDate) setPayDate(businessDate)
  }, [businessDate, from, to, payDate])

  const load = useCallback(async () => {
    if (!allowed || !from || !to) return
    setLoading(true)
    setErr('')
    try {
      const res = await api<Payload>(
        `/api/finance/salaries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الرواتب')
    } finally {
      setLoading(false)
    }
  }, [allowed, from, to])

  useEffect(() => {
    void load()
  }, [load])

  async function addEmployee() {
    const name = newName.trim()
    if (!name) {
      setErr('أدخل اسم الموظف')
      return
    }
    setSaving(true)
    setErr('')
    try {
      await api('/api/finance/salaries/employees', {
        method: 'POST',
        body: JSON.stringify({
          name,
          title: newTitle.trim(),
          monthlySalarySyp: Math.round(Number(newMonthly) || 0),
        }),
      })
      setNewName('')
      setNewTitle('')
      setNewMonthly('')
      setOkMsg('أُضيف الموظف.')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر إضافة الموظف')
    } finally {
      setSaving(false)
    }
  }

  async function saveEmployeeField(id: string, patch: Partial<EmployeeRow>) {
    setErr('')
    try {
      await api(`/api/finance/salaries/employees/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حفظ الموظف')
    }
  }

  async function deleteEmployee(row: EmployeeRow) {
    if (!window.confirm(`حذف الموظف «${row.name}»؟ لا يمكن إن كان لديه دفعات.`)) return
    try {
      await api(`/api/finance/salaries/employees/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حذف الموظف')
    }
  }

  async function addPayment(employeeId: string) {
    const amountSyp = Math.round(Number(paySyp) || 0)
    const amountUsd = Math.round((Number(payUsd) || 0) * 100) / 100
    if (!(amountSyp > 0 || amountUsd > 0)) {
      setErr('أدخل مبلغ الدفعة (كامل أو جزء من الراتب)')
      return
    }
    setSaving(true)
    setErr('')
    try {
      await api('/api/finance/salaries/payments', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          amountSyp,
          amountUsd,
          businessDate: payDate || businessDate,
          note: payNote.trim(),
          usdSypRate: amountUsd > 0 ? usdSypRate || undefined : 0,
        }),
      })
      setPaySyp('')
      setPayUsd('')
      setPayNote('')
      setPayEmp(null)
      setOkMsg('سُجّلت الدفعة وتُخصم من أرباح المركز.')
      setOpenId(employeeId)
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر تسجيل الدفعة')
    } finally {
      setSaving(false)
    }
  }

  async function deletePayment(p: Payment) {
    if (!window.confirm(`حذف دفعة ${fmtSyp(p.effectiveAmountSyp)} بتاريخ ${p.businessDate}؟`)) return
    try {
      await api(`/api/finance/salaries/payments/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حذف الدفعة')
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">الرواتب</h1>
        <p className="page-desc">هذه الصفحة متاحة لمدير النظام فقط.</p>
      </>
    )
  }

  const rows = data?.employees || []
  const totals = data?.totals

  return (
    <>
      <h1 className="page-title">الرواتب</h1>
      <p className="page-desc">
        جدول موظفين شبيه بالإكسل: راتب شهري مرجعي، ودفعات (كاملة أو جزئية) مع التاريخ. كل دفعة تُطرح من صافي أرباح
        المركز في{' '}
        <Link to="/admin/finance-dashboard">لوحة المالية العامة</Link>
        {usdSypRate != null ? ` — سعر الصرف الحالي ${usdSypRate.toLocaleString('ar-SY')} ل.س` : ''}.
      </p>

      <div
        className="toolbar"
        style={{ marginTop: '0.9rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}
      >
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <span>من</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <span>إلى</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          {loading ? 'جاري التحديث…' : 'تحديث'}
        </button>
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{err}</p> : null}
      {okMsg ? <p style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{okMsg}</p> : null}

      {totals ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.55rem',
            margin: '1rem 0',
          }}
        >
          <div className="stat-card">
            <div className="lbl">الموظفون النشطون</div>
            <div className="val">{totals.employeeCount}</div>
          </div>
          <div className="stat-card">
            <div className="lbl">عدد الدفعات في النطاق</div>
            <div className="val">{totals.paymentCount}</div>
          </div>
          <div className="stat-card">
            <div className="lbl">المدفوع (مكافئ ل.س)</div>
            <div className="val">{fmtSyp(totals.paidSyp)}</div>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '70vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
          <thead>
            <tr>
              <th style={{ ...headCell, width: 36 }} />
              <th style={headCell}>الموظف</th>
              <th style={headCell}>المسمّى</th>
              <th style={headCell}>الراتب الشهري</th>
              <th style={headCell}>الدفعات</th>
              <th style={headCell}>المدفوع في النطاق</th>
              <th style={headCell}>المتبقي من الراتب</th>
              <th style={headCell}>آخر دفعة</th>
              <th style={headCell}>حالة</th>
              <th style={headCell}>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ ...cell, color: 'var(--text-muted)', textAlign: 'center' }}>
                  لا موظفون بعد — أضف صفاً في أسفل الجدول.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const opened = openId === row.id
                return (
                  <EmployeeBlock
                    key={row.id}
                    row={row}
                    opened={opened}
                    onToggle={() => setOpenId(opened ? null : row.id)}
                    onSaveField={saveEmployeeField}
                    onDelete={() => void deleteEmployee(row)}
                    onDeletePayment={(p) => void deletePayment(p)}
                    payEmp={payEmp}
                    setPayEmp={setPayEmp}
                    paySyp={paySyp}
                    setPaySyp={setPaySyp}
                    payUsd={payUsd}
                    setPayUsd={setPayUsd}
                    payDate={payDate}
                    setPayDate={setPayDate}
                    payNote={payNote}
                    setPayNote={setPayNote}
                    saving={saving}
                    onAddPayment={() => void addPayment(row.id)}
                  />
                )
              })
            )}
            <tr>
              <td style={{ ...cell, background: '#f3fbf6' }} />
              <td style={{ ...cell, background: '#f3fbf6' }}>
                <input
                  style={inputCell}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="اسم موظف جديد"
                />
              </td>
              <td style={{ ...cell, background: '#f3fbf6' }}>
                <input
                  style={inputCell}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="المسمّى"
                />
              </td>
              <td style={{ ...cell, background: '#f3fbf6' }}>
                <input
                  style={inputCell}
                  type="number"
                  min={0}
                  value={newMonthly}
                  onChange={(e) => setNewMonthly(e.target.value)}
                  placeholder="راتب شهري (اختياري)"
                />
              </td>
              <td colSpan={5} style={{ ...cell, background: '#f3fbf6', color: 'var(--text-muted)' }}>
                صف إضافة — لا يُحفظ إلا بعد «إضافة»
              </td>
              <td style={{ ...cell, background: '#f3fbf6' }}>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void addEmployee()}>
                  إضافة
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

function EmployeeBlock({
  row,
  opened,
  onToggle,
  onSaveField,
  onDelete,
  onDeletePayment,
  payEmp,
  setPayEmp,
  paySyp,
  setPaySyp,
  payUsd,
  setPayUsd,
  payDate,
  setPayDate,
  payNote,
  setPayNote,
  saving,
  onAddPayment,
}: {
  row: EmployeeRow
  opened: boolean
  onToggle: () => void
  onSaveField: (id: string, patch: Partial<EmployeeRow>) => Promise<void>
  onDelete: () => void
  onDeletePayment: (p: Payment) => void
  payEmp: string | null
  setPayEmp: (id: string | null) => void
  paySyp: string
  setPaySyp: (v: string) => void
  payUsd: string
  setPayUsd: (v: string) => void
  payDate: string
  setPayDate: (v: string) => void
  payNote: string
  setPayNote: (v: string) => void
  saving: boolean
  onAddPayment: () => void
}) {
  const [name, setName] = useState(row.name)
  const [title, setTitle] = useState(row.title)
  const [monthly, setMonthly] = useState(row.monthlySalarySyp ? String(row.monthlySalarySyp) : '')
  const showPay = payEmp === row.id

  useEffect(() => {
    setName(row.name)
    setTitle(row.title)
    setMonthly(row.monthlySalarySyp ? String(row.monthlySalarySyp) : '')
  }, [row.id, row.name, row.title, row.monthlySalarySyp])

  const dim = !row.active

  return (
    <>
      <tr style={{ opacity: dim ? 0.55 : 1 }}>
        <td style={cell}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={onToggle}>
            {opened ? '▼' : '◀'}
          </button>
        </td>
        <td style={cell}>
          <input
            style={inputCell}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== row.name) void onSaveField(row.id, { name: name.trim() })
            }}
          />
        </td>
        <td style={cell}>
          <input
            style={inputCell}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title !== row.title) void onSaveField(row.id, { title })
            }}
          />
        </td>
        <td style={cell}>
          <input
            style={inputCell}
            type="number"
            min={0}
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            onBlur={() => {
              const n = Math.round(Number(monthly) || 0)
              if (n !== row.monthlySalarySyp) void onSaveField(row.id, { monthlySalarySyp: n })
            }}
          />
        </td>
        <td style={cell}>{row.paymentCount}</td>
        <td style={{ ...cell, fontWeight: 700 }}>{fmtSyp(row.paidSyp)}</td>
        <td style={cell}>{row.monthlySalarySyp > 0 ? fmtSyp(row.remainingSyp) : '—'}</td>
        <td style={cell}>{row.lastPaymentDate || '—'}</td>
        <td style={cell}>{row.active ? 'نشط' : 'موقوف'}</td>
        <td style={cell}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem' }}
            onClick={() => {
              setPayEmp(showPay ? null : row.id)
              setOpenIdSafe(onToggle, opened)
            }}
          >
            دفعة
          </button>{' '}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem' }}
            onClick={() => void onSaveField(row.id, { active: !row.active })}
          >
            {row.active ? 'إيقاف' : 'تفعيل'}
          </button>{' '}
          <button type="button" className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={onDelete}>
            حذف
          </button>
        </td>
      </tr>
      {opened || showPay ? (
        <tr>
          <td colSpan={10} style={{ ...cell, background: '#f8faf8', padding: '0.65rem 0.75rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.45rem' }}>سجل دفعات «{row.name}» ضمن النطاق</div>
            {row.payments.length === 0 ? (
              <p style={{ margin: '0 0 0.6rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                لا دفعات في هذا النطاق — يمكن صرف جزء من الراتب أو الراتب كاملاً.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.65rem' }}>
                <thead>
                  <tr>
                    <th style={{ ...headCell, background: '#2d6a4f' }}>التاريخ</th>
                    <th style={{ ...headCell, background: '#2d6a4f' }}>ل.س</th>
                    <th style={{ ...headCell, background: '#2d6a4f' }}>USD</th>
                    <th style={{ ...headCell, background: '#2d6a4f' }}>مكافئ ل.س</th>
                    <th style={{ ...headCell, background: '#2d6a4f' }}>ملاحظة</th>
                    <th style={{ ...headCell, background: '#2d6a4f' }} />
                  </tr>
                </thead>
                <tbody>
                  {row.payments.map((p) => (
                    <tr key={p.id}>
                      <td style={cell}>{p.businessDate}</td>
                      <td style={cell}>{p.amountSyp ? fmtSyp(p.amountSyp) : '—'}</td>
                      <td style={cell}>
                        {p.amountUsd > 0
                          ? `${p.amountUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`
                          : '—'}
                      </td>
                      <td style={cell}>{fmtSyp(p.effectiveAmountSyp)}</td>
                      <td style={cell}>{p.note || '—'}</td>
                      <td style={cell}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.76rem' }}
                          onClick={() => onDeletePayment(p)}
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '0.4rem',
                alignItems: 'end',
              }}
            >
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem' }}>
                مبلغ الدفعة (ل.س)
                <input className="input" type="number" min={0} value={showPay ? paySyp : ''} onChange={(e) => {
                  setPayEmp(row.id)
                  setPaySyp(e.target.value)
                }} placeholder="جزء أو كامل" />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem' }}>
                USD (اختياري)
                <input className="input" type="number" min={0} step={0.01} value={showPay ? payUsd : ''} onChange={(e) => {
                  setPayEmp(row.id)
                  setPayUsd(e.target.value)
                }} />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem' }}>
                التاريخ
                <input className="input" type="date" value={payDate} onChange={(e) => {
                  setPayEmp(row.id)
                  setPayDate(e.target.value)
                }} />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.78rem' }}>
                ملاحظة
                <input className="input" value={showPay ? payNote : ''} onChange={(e) => {
                  setPayEmp(row.id)
                  setPayNote(e.target.value)
                }} placeholder="سلفة / دفعة أولى / …" />
              </label>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={onAddPayment}>
                تسجيل الدفعة
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function setOpenIdSafe(onToggle: () => void, opened: boolean) {
  if (!opened) onToggle()
}
