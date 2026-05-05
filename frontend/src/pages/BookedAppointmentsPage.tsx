import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import {
  BOOKED_PAGE_PROCEDURE_FILTERS,
  inferProcedureCategory,
  PROCEDURE_FILTER_LABELS,
  type ProcedureCategoryFilter,
} from '../utils/procedureCategory'

type SlotRow = {
  id: string
  businessDate: string
  time: string
  endTime?: string
  providerName: string
  assignedSpecialistName?: string
  serviceType?: string
  roomNumber?: number | null
  arrivedAt?: string | null
  procedureType?: string
  patientName: string
}
type LaserProviderOption = { roomNumber: number; userId: string; name: string }
type DermatologyBoard = {
  id: string
  index: number
  title: string
  assigned: { id: string; name: string } | null
}

type ServiceKey = 'laser' | 'dental' | 'dermatology' | 'solarium' | 'skin' | 'other'

const SERVICE_LABELS: Record<ServiceKey, string> = {
  laser: 'الليزر',
  dental: 'الأسنان',
  dermatology: 'الجلدية',
  solarium: 'السولاريوم',
  skin: 'البشرة',
  other: 'أخرى',
}
const SERVICE_ICONS: Record<ServiceKey, string> = {
  laser: '⚡',
  dental: '🦷',
  dermatology: '🧴',
  solarium: '☀',
  skin: '✨',
  other: '•',
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const canOpenPage = (role: string | undefined) =>
  role === 'super_admin' ||
  role === 'reception' ||
  role === 'laser' ||
  role === 'dermatology' ||
  role === 'dermatology_manager' ||
  role === 'dermatology_assistant_manager' ||
  role === 'dental_branch' ||
  role === 'skin_specialist'

function fullScheduleRoles(role: string | undefined) {
  return role === 'super_admin' || role === 'reception' || role === 'dermatology_manager'
}

function parseRoomNumber(slot: SlotRow) {
  if (Number.isFinite(Number(slot.roomNumber)) && Number(slot.roomNumber) > 0) return Number(slot.roomNumber)
  const m = String(slot.providerName || '').match(/room\s*(\d+)/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeService(slot: SlotRow): ServiceKey {
  const raw = String(slot.serviceType || '')
    .trim()
    .toLowerCase()
  if (raw === 'laser') return 'laser'
  if (raw === 'dental') return 'dental'
  if (raw === 'dermatology') return 'dermatology'
  if (raw === 'skin') return 'skin'
  if (raw === 'solarium') return 'solarium'

  const inferred = inferProcedureCategory(slot.procedureType ?? '', slot.providerName)
  if (inferred === 'laser') return 'laser'
  if (inferred === 'dental') return 'dental'
  if (inferred === 'dermatology') return 'dermatology'
  return 'other'
}

function addMinutesHm(hm: string, minutes: number) {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return ''
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return ''
  const total = h * 60 + mm + minutes
  const outH = Math.floor(total / 60)
  const outM = total % 60
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`
}

function toDisplay12h(hm: string) {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return hm
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return hm
  const h12 = ((h + 11) % 12) + 1
  return `${h12}:${String(mm).padStart(2, '0')}`
}

function renderTimeWithArrival(slot: SlotRow) {
  return (
    <>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {toDisplay12h(slot.time)}
        {slot.endTime ? ` — ${toDisplay12h(slot.endTime)}` : ''}
      </span>
      {slot.arrivedAt ? (
        <span
          title="المريض وصل"
          style={{ marginInlineStart: '0.45rem', color: 'var(--success)', fontSize: '0.9rem', fontWeight: 700 }}
        >
          ✓
        </span>
      ) : null}
    </>
  )
}

function renderServiceLabel(service: ServiceKey) {
  return `${SERVICE_ICONS[service]} ${SERVICE_LABELS[service]}`
}

export function BookedAppointmentsPage() {
  const { user } = useAuth()
  const { businessDate: clinicBusinessDate } = useClinic()
  const [searchParams] = useSearchParams()
  const allowed = canOpenPage(user?.role)
  const fullView = fullScheduleRoles(user?.role)

  const [viewDate, setViewDate] = useState(todayYmd)
  const [procedureFilter, setProcedureFilter] = useState<ProcedureCategoryFilter>('all')
  const [activeTab, setActiveTab] = useState<'booked' | 'clinic_now'>('booked')
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [arrivedSlots, setArrivedSlots] = useState<SlotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [actionSlot, setActionSlot] = useState<SlotRow | null>(null)
  const [actionMode, setActionMode] = useState<'menu' | 'reschedule' | 'provider'>('menu')
  const [providers, setProviders] = useState<string[]>([])
  const [laserProviders, setLaserProviders] = useState<LaserProviderOption[]>([])
  const [dermatologyBoards, setDermatologyBoards] = useState<DermatologyBoard[]>([])
  const [resDate, setResDate] = useState(todayYmd)
  const [resTime, setResTime] = useState('09:00')
  const [resDuration, setResDuration] = useState(60)
  const [resProcedure, setResProcedure] = useState('')
  const [provService, setProvService] = useState<ServiceKey>('other')
  const [provLaserUserId, setProvLaserUserId] = useState('')
  const [provName, setProvName] = useState('')

  useEffect(() => {
    const d = searchParams.get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setViewDate(d)
  }, [searchParams])

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    setLoading(true)
    try {
      const q = fullView
        ? new URLSearchParams({ date: viewDate })
        : new URLSearchParams()
      const data = await api<{ slots: SlotRow[] }>(`/api/schedule/booked?${q.toString()}`)
      setSlots(data.slots)
    } catch (e) {
      setSlots([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل المواعيد')
    } finally {
      setLoading(false)
    }
  }, [allowed, fullView, viewDate, clinicBusinessDate])

  const loadArrived = useCallback(async () => {
    if (!allowed) return
    try {
      const q = fullView
        ? new URLSearchParams({ date: viewDate })
        : new URLSearchParams({ date: clinicBusinessDate || todayYmd() })
      const data = await api<{ slots: SlotRow[] }>(`/api/schedule/arrived?${q.toString()}`)
      setArrivedSlots(data.slots || [])
    } catch {
      setArrivedSlots([])
    }
  }, [allowed, fullView, viewDate, clinicBusinessDate])

  const loadProviders = useCallback(async () => {
    if (!fullView) return
    try {
      const data = await api<{ providers: string[] }>('/api/schedule/providers')
      setProviders(data.providers || [])
    } catch {
      setProviders([])
    }
  }, [fullView])

  const loadLaserProviders = useCallback(async (slotTime?: string) => {
    if (!fullView) return [] as LaserProviderOption[]
    try {
      const q = slotTime ? `?time=${encodeURIComponent(slotTime)}` : ''
      const data = await api<{ providers: LaserProviderOption[] }>(`/api/schedule/laser-provider-options${q}`)
      const providers = data.providers || []
      setLaserProviders(providers)
      return providers
    } catch {
      setLaserProviders([])
      return [] as LaserProviderOption[]
    }
  }, [fullView])

  const loadDermatologyBoards = useCallback(async () => {
    if (!fullView) return
    try {
      const data = await api<{ boards: DermatologyBoard[] }>('/api/schedule/dermatology-boards')
      const rows = Array.isArray(data.boards) ? data.boards : []
      setDermatologyBoards(rows.filter((b) => String(b?.title || '').trim()).sort((a, b) => a.index - b.index))
    } catch {
      setDermatologyBoards([])
    }
  }, [fullView])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadArrived()
  }, [loadArrived])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  useEffect(() => {
    void loadLaserProviders('09:00')
  }, [loadLaserProviders])

  useEffect(() => {
    void loadDermatologyBoards()
  }, [loadDermatologyBoards])

  const grouped = useMemo(() => {
    const filtered = fullView
      ? procedureFilter === 'all'
        ? slots
        : slots.filter(
            (s) => inferProcedureCategory(s.procedureType ?? '', s.providerName) === procedureFilter,
          )
      : slots

    const sorted = [...filtered].sort((a, b) => {
      const c = a.businessDate.localeCompare(b.businessDate)
      if (c !== 0) return c
      const p = a.providerName.localeCompare(b.providerName, 'ar')
      if (p !== 0) return p
      return a.time.localeCompare(b.time, undefined, { numeric: true })
    })

    const byService: Record<ServiceKey, SlotRow[]> = {
      laser: [],
      dental: [],
      dermatology: [],
      solarium: [],
      skin: [],
      other: [],
    }
    for (const s of sorted) byService[normalizeService(s)].push(s)

    const laserRooms = {
      room1: byService.laser.filter((s) => parseRoomNumber(s) === 1),
      room2: byService.laser.filter((s) => parseRoomNumber(s) === 2),
      other: byService.laser.filter((s) => {
        const r = parseRoomNumber(s)
        return r !== 1 && r !== 2
      }),
    }

    return { sorted, byService, laserRooms }
  }, [slots, procedureFilter, fullView])

  const arrivedSorted = useMemo(
    () =>
      [...arrivedSlots].sort((a, b) => {
        const c = a.businessDate.localeCompare(b.businessDate)
        if (c !== 0) return c
        return (a.arrivedAt || '').localeCompare(b.arrivedAt || '')
      }),
    [arrivedSlots],
  )

  const dermatologyBoardsRows = useMemo(() => {
    const rows = grouped.byService.dermatology
    if (rows.length === 0) return []
    if (dermatologyBoards.length === 0) {
      return [{ id: 'default-derm', title: renderServiceLabel('dermatology'), rows }]
    }
    const mapped = dermatologyBoards.map((b) => ({
      id: b.id,
      title: b.title,
      rows: rows.filter((s) => String(s.providerName || '').trim() === String(b.title || '').trim()),
    }))
    const listed = new Set(dermatologyBoards.map((b) => String(b.title || '').trim()))
    const unlisted = rows.filter((s) => !listed.has(String(s.providerName || '').trim()))
    if (unlisted.length > 0) {
      mapped.push({ id: 'unlisted-derm', title: 'جداول غير مصنفة', rows: unlisted })
    }
    return mapped
  }, [grouped.byService.dermatology, dermatologyBoards])

  async function openActionMenu(slot: SlotRow) {
    if (!fullView) return
    let byTime: LaserProviderOption[] = laserProviders
    if (normalizeService(slot) === 'laser') {
      byTime = await loadLaserProviders(slot.time || '09:00')
    }
    setActionSlot(slot)
    setActionMode('menu')
    setResDate(slot.businessDate || viewDate)
    setResTime(slot.time || '09:00')
    setResDuration(60)
    setResProcedure(slot.procedureType || '')
    const svc = normalizeService(slot)
    setProvService(svc)
    const matchedLaser = byTime.find((x) => x.roomNumber === (parseRoomNumber(slot) || 0))
    setProvLaserUserId(matchedLaser?.userId || '')
    setProvName(slot.assignedSpecialistName?.trim() || slot.providerName || '')
  }

  async function markArrived(slot: SlotRow) {
    await api(`/api/schedule/arrive/${slot.id}`, { method: 'POST' })
    await Promise.all([load(), loadArrived()])
    setActionSlot(null)
  }

  async function cancelSlot(slot: SlotRow) {
    await api(`/api/schedule/cancel/${slot.id}`, { method: 'DELETE' })
    await Promise.all([load(), loadArrived()])
    setActionSlot(null)
  }

  async function submitReschedule(slot: SlotRow) {
    const end = addMinutesHm(resTime, resDuration)
    if (!end) {
      setErr('وقت غير صالح')
      return
    }
    await api(`/api/schedule/reschedule/${slot.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        businessDate: resDate,
        time: resTime,
        endTime: end,
        procedureType: resProcedure,
      }),
    })
    await Promise.all([load(), loadArrived()])
    setActionSlot(null)
  }

  async function submitProviderChange(slot: SlotRow) {
    const selectedLaser = laserProviders.find((x) => x.userId === provLaserUserId)
    const slotRoom = parseRoomNumber(slot)
    const payload =
      provService === 'laser'
        ? {
            serviceType: 'laser',
            roomNumber: selectedLaser?.roomNumber ?? slotRoom ?? 1,
            providerName: selectedLaser ? selectedLaser.name : `Laser Room ${slotRoom ?? 1}`,
          }
        : { serviceType: provService, providerName: provName }
    await api(`/api/schedule/provider/${slot.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    await Promise.all([load(), loadArrived()])
    setActionSlot(null)
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">المواعيد المحجوزة</h1>
        <p className="page-desc">هذه الصفحة غير متاحة لدورك الحالي.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">المواعيد المحجوزة</h1>
      <p className="page-desc">
        {fullView ? (
          <>
            عرض المواعيد المحجوزة ليوم واحد تختاره (أو نطاق للمدير/الاستقبال). لحجز موعد جديد استخدم{' '}
            <Link to="/reception/appointment" style={{ color: 'var(--cyan)' }}>
              إضافة موعد
            </Link>
            .
          </>
        ) : (
          <>
            مواعيدك المحجوزة لـ <strong>يوم العمل الحالي</strong> فقط — حسب اسمك كمقدّم في النظام. يجب أن يطابق
            الاسم في الملف الشخصي حقل «المقدّم» عند الحجز. لا يمكنك عرض مواعيد باقي المقدّمين أو تغيير التاريخ من
            هنا.
          </>
        )}
      </p>

      {!fullView ? (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--border)' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            التاريخ المعروض: <strong dir="ltr">{clinicBusinessDate ?? todayYmd()}</strong>
            {' — '}
            إن لم يظهر شيء، تأكد أن اسمك في الإعدادات يطابق «المقدّم» عند الاستقبال.
          </p>
        </div>
      ) : null}

      {fullView ? (
        <div
          className="toolbar"
          style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', alignItems: 'flex-end' }}
        >
          <div>
            <label className="form-label" htmlFor="booked-day" style={{ display: 'block' }}>
              تاريخ اليوم
            </label>
            <input
              id="booked-day"
              type="date"
              className="input"
              value={viewDate}
              onChange={(e) => setViewDate(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="booked-procedure" style={{ display: 'block' }}>
              نوع الإجراء
            </label>
            <select
              id="booked-procedure"
              className="input"
              style={{ minWidth: '11rem' }}
              value={procedureFilter}
              onChange={(e) => setProcedureFilter(e.target.value as ProcedureCategoryFilter)}
            >
              {BOOKED_PAGE_PROCEDURE_FILTERS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
            تحديث
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
            تحديث
          </button>
        </div>
      )}

      {fullView ? (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'booked' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('booked')}
          >
            المواعيد المحجوزة
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'clinic_now' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('clinic_now')}
          >
            حالة العيادة الآن
          </button>
        </div>
      ) : null}

      <div className="card">
        {activeTab === 'clinic_now' && fullView ? (
          arrivedSorted.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا يوجد مرضى تم تسجيل وصولهم بعد.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>من — إلى</th>
                    <th>اسم المريض</th>
                    <th>القسم</th>
                    <th>المقدم</th>
                    <th>وقت الوصول</th>
                  </tr>
                </thead>
                <tbody>
                  {arrivedSorted.map((s) => (
                    <tr key={`arrived-${s.id}`}>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {toDisplay12h(s.time)}
                        {s.endTime ? ` — ${toDisplay12h(s.endTime)}` : ''}
                      </td>
                      <td>{s.patientName || '—'}</td>
                      <td>{renderServiceLabel(normalizeService(s))}</td>
                      <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                      <td>{s.arrivedAt ? new Date(s.arrivedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : err ? (
          <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
        ) : loading ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
        ) : slots.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد مواعيد محجوزة في هذا اليوم.</p>
        ) : grouped.sorted.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {fullView
              ? `لا توجد مواعيد تطابق فلتر «${PROCEDURE_FILTER_LABELS[procedureFilter]}» في هذا اليوم.`
              : 'لا توجد مواعيد باسمك في يوم العمل هذا.'}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {grouped.byService.dental.length > 0 ? (
              <div>
                <h3 style={{ margin: '0 0 0.45rem' }}>{renderServiceLabel('dental')}</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>من — إلى</th>
                        <th>اسم المريض</th>
                        <th>القسم</th>
                        <th>المقدم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.byService.dental.map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => openActionMenu(s)}
                          style={fullView ? { cursor: 'pointer' } : undefined}
                        >
                          <td>{renderTimeWithArrival(s)}</td>
                          <td>{s.patientName || '—'}</td>
                          <td>{renderServiceLabel('dental')}</td>
                          <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {grouped.byService.laser.length > 0 ? (
              <div>
                <h3 style={{ margin: '0 0 0.45rem' }}>{renderServiceLabel('laser')}</h3>
                <div style={{ display: 'grid', gap: '0.8rem', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))' }}>
                  {[
                    { key: 'room1', label: '⚡ Laser Room 1', rows: grouped.laserRooms.room1 },
                    { key: 'room2', label: '⚡ Laser Room 2', rows: grouped.laserRooms.room2 },
                  ].map((room) => (
                    <div key={room.key}>
                      <h4 style={{ margin: '0 0 0.35rem', color: 'var(--text-muted)' }}>{room.label}</h4>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>من — إلى</th>
                              <th>اسم المريض</th>
                              <th>المناطق</th>
                              <th>المقدم</th>
                            </tr>
                          </thead>
                          <tbody>
                            {room.rows.length === 0 ? (
                              <tr>
                                <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                                  لا توجد مواعيد محجوزة
                                </td>
                              </tr>
                            ) : (
                              room.rows.map((s) => (
                                <tr
                                  key={s.id}
                                  onClick={() => openActionMenu(s)}
                                  style={fullView ? { cursor: 'pointer' } : undefined}
                                >
                                  <td>{renderTimeWithArrival(s)}</td>
                                  <td>{s.patientName || '—'}</td>
                                  <td>{s.procedureType?.trim() ? s.procedureType : '—'}</td>
                                  <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  {grouped.laserRooms.other.length > 0 ? (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <h4 style={{ margin: '0 0 0.35rem', color: 'var(--text-muted)' }}>غرف أخرى</h4>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>من — إلى</th>
                              <th>اسم المريض</th>
                              <th>المناطق</th>
                              <th>المقدم</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grouped.laserRooms.other.map((s) => (
                              <tr
                                key={s.id}
                                onClick={() => openActionMenu(s)}
                                style={fullView ? { cursor: 'pointer' } : undefined}
                              >
                                <td>{renderTimeWithArrival(s)}</td>
                                <td>{s.patientName || '—'}</td>
                                <td>{s.procedureType?.trim() ? s.procedureType : '—'}</td>
                                <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {grouped.byService.dermatology.length > 0 ? (
              <div>
                <h3 style={{ margin: '0 0 0.45rem' }}>{renderServiceLabel('dermatology')}</h3>
                <div style={{ display: 'grid', gap: '0.8rem', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))' }}>
                  {dermatologyBoardsRows.map((board) => (
                    <div key={board.id}>
                      <h4 style={{ margin: '0 0 0.35rem', color: 'var(--text-muted)' }}>{board.title}</h4>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>من — إلى</th>
                              <th>اسم المريض</th>
                              <th>القسم</th>
                              <th>المقدم</th>
                            </tr>
                          </thead>
                          <tbody>
                            {board.rows.length === 0 ? (
                              <tr>
                                <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                                  لا توجد مواعيد محجوزة
                                </td>
                              </tr>
                            ) : (
                              board.rows.map((s) => (
                                <tr
                                  key={s.id}
                                  onClick={() => openActionMenu(s)}
                                  style={fullView ? { cursor: 'pointer' } : undefined}
                                >
                                  <td>{renderTimeWithArrival(s)}</td>
                                  <td>{s.patientName || '—'}</td>
                                  <td>{renderServiceLabel('dermatology')}</td>
                                  <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {grouped.byService.solarium.length > 0 ? (
              <div>
                <h3 style={{ margin: '0 0 0.45rem' }}>{renderServiceLabel('solarium')}</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>من — إلى</th>
                        <th>اسم المريض</th>
                        <th>القسم</th>
                        <th>المقدم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.byService.solarium.map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => openActionMenu(s)}
                          style={fullView ? { cursor: 'pointer' } : undefined}
                        >
                          <td>{renderTimeWithArrival(s)}</td>
                          <td>{s.patientName || '—'}</td>
                          <td>{renderServiceLabel('solarium')}</td>
                          <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {grouped.byService.skin.length > 0 ? (
              <div>
                <h3 style={{ margin: '0 0 0.45rem' }}>{renderServiceLabel('skin')}</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>من — إلى</th>
                        <th>اسم المريض</th>
                        <th>القسم</th>
                        <th>المقدم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.byService.skin.map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => openActionMenu(s)}
                          style={fullView ? { cursor: 'pointer' } : undefined}
                        >
                          <td>{renderTimeWithArrival(s)}</td>
                          <td>{s.patientName || '—'}</td>
                          <td>{renderServiceLabel('skin')}</td>
                          <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {grouped.byService.other.length > 0 ? (
              <div>
                <h3 style={{ margin: '0 0 0.45rem' }}>{renderServiceLabel('other')}</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>من — إلى</th>
                        <th>اسم المريض</th>
                        <th>القسم</th>
                        <th>المقدم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.byService.other.map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => openActionMenu(s)}
                          style={fullView ? { cursor: 'pointer' } : undefined}
                        >
                          <td>{renderTimeWithArrival(s)}</td>
                          <td>{s.patientName || '—'}</td>
                          <td>{renderServiceLabel('other')}</td>
                          <td>{s.assignedSpecialistName?.trim() || s.providerName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {fullView && actionSlot ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setActionSlot(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>إدارة الموعد</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '-0.35rem' }}>
              {actionSlot.patientName} — {toDisplay12h(actionSlot.time)}
              {actionSlot.endTime ? ` إلى ${toDisplay12h(actionSlot.endTime)}` : ''}
            </p>

            {actionMode === 'menu' ? (
              <div style={{ display: 'grid', gap: '0.55rem' }}>
                <button type="button" className="btn btn-primary" onClick={() => void markArrived(actionSlot)}>
                  ✅ وصل المريض
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setActionMode('reschedule')}>
                  🕒 تغيير وقت الموعد
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setActionMode('provider')}>
                  👨‍⚕️ تغيير المقدم
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void cancelSlot(actionSlot)}>
                  ❌ إلغاء الموعد
                </button>
              </div>
            ) : null}

            {actionMode === 'reschedule' ? (
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <input className="input" type="date" value={resDate} onChange={(e) => setResDate(e.target.value)} />
                <input className="input" type="time" value={resTime} onChange={(e) => setResTime(e.target.value)} />
                <select
                  className="select"
                  value={String(resDuration)}
                  onChange={(e) => setResDuration(Math.max(15, Number(e.target.value) || 60))}
                >
                  <option value="30">30 دقيقة</option>
                  <option value="45">45 دقيقة</option>
                  <option value="60">60 دقيقة</option>
                  <option value="90">90 دقيقة</option>
                  <option value="120">120 دقيقة</option>
                </select>
                <input
                  className="input"
                  value={resProcedure}
                  onChange={(e) => setResProcedure(e.target.value)}
                  placeholder="الإجراء / المناطق"
                />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setActionMode('menu')}>
                    رجوع
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void submitReschedule(actionSlot)}>
                    حفظ الوقت الجديد
                  </button>
                </div>
              </div>
            ) : null}

            {actionMode === 'provider' ? (
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <select className="select" value={provService} onChange={(e) => setProvService(e.target.value as ServiceKey)}>
                  <option value="laser">{SERVICE_LABELS.laser}</option>
                  <option value="dental">{SERVICE_LABELS.dental}</option>
                  <option value="dermatology">{SERVICE_LABELS.dermatology}</option>
                  <option value="solarium">{SERVICE_LABELS.solarium}</option>
                  <option value="other">{SERVICE_LABELS.other}</option>
                </select>
                {provService === 'laser' ? (
                  <select
                    className="select"
                    value={provLaserUserId}
                    onChange={(e) => setProvLaserUserId(e.target.value)}
                  >
                    <option value="">— اختر أخصائي الليزر —</option>
                    {laserProviders.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    value={provName}
                    onChange={(e) => setProvName(e.target.value)}
                    placeholder="اسم المقدم"
                    list="provider-suggestions"
                  />
                )}
                <datalist id="provider-suggestions">
                  {providers.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setActionMode('menu')}>
                    رجوع
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void submitProviderChange(actionSlot)}>
                    حفظ المقدم
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
