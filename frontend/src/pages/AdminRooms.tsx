import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'

type RoomRow = {
  number: number
  assigned: { id: string; name: string } | null
  morningAssigned: { id: string; name: string } | null
  eveningAssigned: { id: string; name: string } | null
  morningShiftStart: string
  morningShiftEnd: string
  eveningShiftStart: string
  eveningShiftEnd: string
}
type LaserUser = { id: string; name: string; role: string; active: boolean }
type LaserProcedureItem = {
  id: string
  code: string
  name: string
  groupId: string
  groupTitle: string
  kind: 'area' | 'offer'
  priceSyp: number
  priceMaleSyp: number
  priceFemaleSyp: number
  areaCount: number
  active: boolean
  sortOrder: number
}
type LaserProcedureGroup = { id: string; title: string; items: LaserProcedureItem[] }
type LaserPackageTemplateRow = {
  id: string
  name: string
  procedureOptionIds: string[]
  areaCount: number
  listPriceSyp: number
  active: boolean
  sortOrder: number
}
type DermatologyBoard = {
  id: string
  index: number
  title: string
  assigned: { id: string; name: string } | null
}

type SecretaryShiftPayload = {
  morningShiftStart: string
  morningShiftEnd: string
  eveningShiftStart: string
  eveningShiftEnd: string
  morningAssigned: { id: string; name: string } | null
  eveningAssigned: { id: string; name: string } | null
}

const GROUP_OPTIONS = [
  { value: 'face', label: 'الوجه' },
  { value: 'upper', label: 'الجزء العلوي' },
  { value: 'lower', label: 'الجزء السفلي' },
  { value: 'offers', label: 'العروض التوفيرية' },
] as const

export function AdminRooms() {
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [laserUsers, setLaserUsers] = useState<LaserUser[]>([])
  const [pickRoom, setPickRoom] = useState<number | null>(null)
  const [pickMorningUserId, setPickMorningUserId] = useState('')
  const [pickEveningUserId, setPickEveningUserId] = useState('')
  const [pickMorningShiftStart, setPickMorningShiftStart] = useState('09:00')
  const [pickMorningShiftEnd, setPickMorningShiftEnd] = useState('15:00')
  const [pickEveningShiftStart, setPickEveningShiftStart] = useState('15:00')
  const [pickEveningShiftEnd, setPickEveningShiftEnd] = useState('21:00')
  const [loading, setLoading] = useState(true)
  const [dermBoards, setDermBoards] = useState<DermatologyBoard[]>([])
  const [dermUsers, setDermUsers] = useState<LaserUser[]>([])
  const [dermEditOpen, setDermEditOpen] = useState<number | null>(null)
  const [dermTitle, setDermTitle] = useState('')
  const [dermUserId, setDermUserId] = useState('')
  const [groups, setGroups] = useState<LaserProcedureGroup[]>([])
  const [procLoading, setProcLoading] = useState(false)
  const [procErr, setProcErr] = useState('')
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('face')
  const [newKind, setNewKind] = useState<'area' | 'offer'>('area')
  const [newPriceMale, setNewPriceMale] = useState('55000')
  const [newPriceFemale, setNewPriceFemale] = useState('55000')
  const [newAreaCount, setNewAreaCount] = useState('1')
  const [newSortOrder, setNewSortOrder] = useState('999')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState('face')
  const [editKind, setEditKind] = useState<'area' | 'offer'>('area')
  const [editPriceMale, setEditPriceMale] = useState('')
  const [editPriceFemale, setEditPriceFemale] = useState('')
  const [editAreaCount, setEditAreaCount] = useState('1')
  const [editSortOrder, setEditSortOrder] = useState('999')
  const [pulsePriceSyp, setPulsePriceSyp] = useState('0')
  const [pulsePriceSaving, setPulsePriceSaving] = useState(false)
  const [pulsePriceMsg, setPulsePriceMsg] = useState('')
  const [laserCoverPriceSyp, setLaserCoverPriceSyp] = useState('0')
  const [laserCoverSaving, setLaserCoverSaving] = useState(false)
  const [laserCoverMsg, setLaserCoverMsg] = useState('')
  const [receptionUsers, setReceptionUsers] = useState<LaserUser[]>([])
  const [secMorningUserId, setSecMorningUserId] = useState('')
  const [secEveningUserId, setSecEveningUserId] = useState('')
  const [secretaryShifts, setSecretaryShifts] = useState<SecretaryShiftPayload | null>(null)
  const [secSaving, setSecSaving] = useState(false)
  const [secMsg, setSecMsg] = useState('')
  const [pkgTemplates, setPkgTemplates] = useState<LaserPackageTemplateRow[]>([])
  const [pkgTplLoading, setPkgTplLoading] = useState(false)
  const [pkgTplErr, setPkgTplErr] = useState('')
  const [pkgTplNewName, setPkgTplNewName] = useState('')
  const [pkgTplNewSel, setPkgTplNewSel] = useState<string[]>([])
  const [pkgTplNewPrice, setPkgTplNewPrice] = useState('')
  const [pkgTplNewSort, setPkgTplNewSort] = useState('0')
  const [pkgTplSaving, setPkgTplSaving] = useState(false)
  const [pkgTplEdit, setPkgTplEdit] = useState<LaserPackageTemplateRow | null>(null)
  const [pkgTplEditName, setPkgTplEditName] = useState('')
  const [pkgTplEditSel, setPkgTplEditSel] = useState<string[]>([])
  const [pkgTplEditPrice, setPkgTplEditPrice] = useState('')
  const [pkgTplEditSort, setPkgTplEditSort] = useState('0')

  const laserGroupsOrdered = useMemo(() => {
    const rest = groups.filter((g) => g.id !== 'offers')
    const off = groups.filter((g) => g.id === 'offers')
    return [...rest, ...off]
  }, [groups])

  const laserProcById = useMemo(() => {
    const m = new Map<string, LaserProcedureItem>()
    for (const g of groups) {
      for (const it of g.items || []) {
        m.set(it.id, it)
      }
    }
    return m
  }, [groups])

  async function loadPackageTemplates() {
    setPkgTplLoading(true)
    setPkgTplErr('')
    try {
      const data = await api<{ templates: LaserPackageTemplateRow[] }>('/api/laser/package-templates?includeInactive=1')
      setPkgTemplates(data.templates || [])
    } catch {
      setPkgTemplates([])
      setPkgTplErr('تعذر تحميل قوالب باكجات الليزر')
    } finally {
      setPkgTplLoading(false)
    }
  }

  async function loadProcedureOptions() {
    setProcLoading(true)
    setProcErr('')
    try {
      const data = await api<{ groups: LaserProcedureGroup[] }>('/api/laser/procedure-options?includeInactive=1')
      setGroups(data.groups || [])
      try {
        const pricing = await api<{ pricePerPulseSyp: number; laserCoverSyp?: number }>(
          '/api/laser/pricing-settings',
        )
        setPulsePriceSyp(String(Math.max(0, Math.round(Number(pricing.pricePerPulseSyp) || 0))))
        setLaserCoverPriceSyp(String(Math.max(0, Math.round(Number(pricing.laserCoverSyp) || 0))))
      } catch {
        setPulsePriceSyp('0')
        setLaserCoverPriceSyp('0')
      }
    } catch {
      setGroups([])
      setProcErr('تعذر تحميل مناطق وعروض الليزر')
    } finally {
      setProcLoading(false)
    }
  }

  async function load() {
    try {
      const [rData, uData, dData] = await Promise.all([
        api<{ rooms: RoomRow[] }>('/api/rooms'),
        api<{ users: LaserUser[] }>('/api/users'),
        api<{ boards: DermatologyBoard[] }>('/api/schedule/dermatology-boards'),
      ])
      setRooms(rData.rooms)
      setLaserUsers(uData.users.filter((u) => u.role === 'laser' && u.active !== false))
      const recv = uData.users.filter((u) => u.role === 'reception' && u.active !== false)
      setReceptionUsers(recv)
      setDermUsers(
        uData.users.filter(
          (u) =>
            (u.role === 'dermatology' ||
              u.role === 'dermatology_manager' ||
              u.role === 'dermatology_assistant_manager') &&
            u.active !== false,
        ),
      )
      setDermBoards((dData.boards || []).sort((a, b) => a.index - b.index))
      try {
        const secData = await api<SecretaryShiftPayload>('/api/rooms/secretary-shifts')
        setSecretaryShifts(secData)
        setSecMorningUserId(secData.morningAssigned?.id || '')
        setSecEveningUserId(secData.eveningAssigned?.id || '')
      } catch {
        setSecretaryShifts(null)
      }
    } catch {
      setRooms([])
      setDermBoards([])
      setSecretaryShifts(null)
      setReceptionUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void loadProcedureOptions()
    void loadPackageTemplates()
  }, [])

  return (
    <>
      <h1 className="page-title">الغرف وتعيين أخصائيي الليزر</h1>
      <p className="page-desc">غرفة ١ و٢ — إعادة توزيع في أي وقت (مدير النظام)</p>
      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
      ) : (
        <div className="grid-2">
          {rooms.map((room) => (
            <div key={room.number} className="card">
              <h2 className="card-title">غرفة {room.number}</h2>
              <p style={{ color: 'var(--text-muted)' }}>
                {room.morningShiftStart} - {room.morningShiftEnd}: {room.morningAssigned?.name ?? room.assigned?.name ?? '—'}
              </p>
              <p style={{ color: 'var(--text-muted)', marginTop: '-0.2rem' }}>
                {room.eveningShiftStart} - {room.eveningShiftEnd}: {room.eveningAssigned?.name ?? room.assigned?.name ?? '—'}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '0.75rem' }}
                onClick={() => {
                  setPickRoom(room.number)
                  setPickMorningUserId(room.morningAssigned?.id || room.assigned?.id || '')
                  setPickEveningUserId(room.eveningAssigned?.id || room.assigned?.id || '')
                  setPickMorningShiftStart(room.morningShiftStart || '09:00')
                  setPickMorningShiftEnd(room.morningShiftEnd || '15:00')
                  setPickEveningShiftStart(room.eveningShiftStart || '15:00')
                  setPickEveningShiftEnd(room.eveningShiftEnd || '21:00')
                }}
              >
                إعادة تعيين
              </button>
            </div>
          ))}
        </div>
      )}
      {pickRoom != null && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>تعيين غرفة {pickRoom}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              اختر أخصائياً وحدد ساعات الدوام لكل شِفت
            </p>
            <div style={{ display: 'grid', gap: '0.6rem', margin: '0.75rem 0' }}>
              <label className="form-label" htmlFor="room-morning">شِفت الصباح</label>
              <select
                id="room-morning"
                className="select"
                value={pickMorningUserId}
                onChange={(e) => setPickMorningUserId(e.target.value)}
              >
                <option value="">— بدون تعيين —</option>
                {laserUsers.map((u) => (
                  <option key={`m-${u.id}`} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <div style={{ display: 'grid', gap: '0.45rem', gridTemplateColumns: '1fr 1fr' }}>
                <input
                  type="time"
                  className="input"
                  value={pickMorningShiftStart}
                  onChange={(e) => setPickMorningShiftStart(e.target.value)}
                />
                <input
                  type="time"
                  className="input"
                  value={pickMorningShiftEnd}
                  onChange={(e) => setPickMorningShiftEnd(e.target.value)}
                />
              </div>

              <label className="form-label" htmlFor="room-evening">شِفت المساء</label>
              <select
                id="room-evening"
                className="select"
                value={pickEveningUserId}
                onChange={(e) => setPickEveningUserId(e.target.value)}
              >
                <option value="">— بدون تعيين —</option>
                {laserUsers.map((u) => (
                  <option key={`e-${u.id}`} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <div style={{ display: 'grid', gap: '0.45rem', gridTemplateColumns: '1fr 1fr' }}>
                <input
                  type="time"
                  className="input"
                  value={pickEveningShiftStart}
                  onChange={(e) => setPickEveningShiftStart(e.target.value)}
                />
                <input
                  type="time"
                  className="input"
                  value={pickEveningShiftEnd}
                  onChange={(e) => setPickEveningShiftEnd(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPickRoom(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  await api(`/api/rooms/${pickRoom}/assign`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      morningUserId: pickMorningUserId || null,
                      eveningUserId: pickEveningUserId || null,
                      morningShiftStart: pickMorningShiftStart,
                      morningShiftEnd: pickMorningShiftEnd,
                      eveningShiftStart: pickEveningShiftStart,
                      eveningShiftEnd: pickEveningShiftEnd,
                    }),
                  })
                  setPickRoom(null)
                  await load()
                }}
              >
                حفظ التعيين
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">ورديات سكرتارية الاستقبال</h2>
        <p className="page-desc">
          حدِّد من يعمل على المكتب في كل وردية — الصباح من الساعة 9 صباحاً إلى 3 عصراً، والمساء من 3 عصراً إلى 9
          مساءً.
        </p>
        {!secretaryShifts && !loading ? (
          <p style={{ color: 'var(--danger)', margin: 0 }}>تعذر تحميل إعدادات الورديات.</p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem', maxWidth: 520 }}>
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
              }}
            >
              <p style={{ margin: '0 0 0.35rem', fontWeight: 700 }}>الوردية الصباحية</p>
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                تنتهي عند تسجيل خروج السكرتيرة من حسابها — كل التحصيل من حسابها يُحسب صباحياً حتى الخروج (لا يُقفل بوقت
                محدد).
              </p>
              <label className="form-label" htmlFor="sec-morning-user">
                السكرتارية
              </label>
              <select
                id="sec-morning-user"
                className="select"
                value={secMorningUserId}
                onChange={(e) => {
                  setSecMsg('')
                  setSecMorningUserId(e.target.value)
                }}
              >
                <option value="">— بدون تعيين —</option>
                {receptionUsers.map((u) => (
                  <option key={`sec-am-${u.id}`} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
              }}
            >
              <p style={{ margin: '0 0 0.35rem', fontWeight: 700 }}>الوردية المسائية</p>
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', color: 'var(--text-muted)' }} dir="ltr">
                {secretaryShifts?.eveningShiftStart ?? '15:00'} – {secretaryShifts?.eveningShiftEnd ?? '21:00'}
              </p>
              <label className="form-label" htmlFor="sec-evening-user">
                السكرتارية
              </label>
              <select
                id="sec-evening-user"
                className="select"
                value={secEveningUserId}
                onChange={(e) => {
                  setSecMsg('')
                  setSecEveningUserId(e.target.value)
                }}
              >
                <option value="">— بدون تعيين —</option>
                {receptionUsers.map((u) => (
                  <option key={`sec-pm-${u.id}`} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={secSaving || !secretaryShifts}
                onClick={async () => {
                  setSecSaving(true)
                  setSecMsg('')
                  try {
                    const saved = await api<SecretaryShiftPayload>('/api/rooms/secretary-shifts', {
                      method: 'PATCH',
                      body: JSON.stringify({
                        morningUserId: secMorningUserId || null,
                        eveningUserId: secEveningUserId || null,
                      }),
                    })
                    setSecretaryShifts(saved)
                    setSecMorningUserId(saved.morningAssigned?.id || '')
                    setSecEveningUserId(saved.eveningAssigned?.id || '')
                    setSecMsg('تم حفظ تعيين الورديات.')
                  } catch (e) {
                    setSecMsg(e instanceof ApiError ? e.message : 'تعذر الحفظ')
                  } finally {
                    setSecSaving(false)
                  }
                }}
              >
                {secSaving ? 'جاري الحفظ…' : 'حفظ تعيين السكرتارية'}
              </button>
            </div>
            {secMsg ? (
              <p
                style={{
                  margin: 0,
                  fontSize: '0.84rem',
                  color: secMsg.includes('تعذر') || secMsg.includes('خطأ') ? 'var(--danger)' : 'var(--success)',
                }}
              >
                {secMsg}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">جداول سكرتاريا الجلدية</h2>
        <p className="page-desc">٣ جداول ثابتة (09:00–21:00) — يمكنك تعديل الاسم وربط كل جدول بطبيب الجلدية.</p>
        <div className="grid-2">
          {dermBoards.map((board) => (
            <div key={board.id} className="card" style={{ margin: 0 }}>
              <h3 style={{ marginTop: 0 }}>{board.title || `جدول ${board.index}`}</h3>
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                الطبيب المرتبط: {board.assigned?.name || '— غير مرتبط —'}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '0.75rem' }}
                onClick={() => {
                  setDermEditOpen(board.index)
                  setDermTitle(board.title || '')
                  setDermUserId(board.assigned?.id || '')
                }}
              >
                تعديل الجدول
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">إدارة مناطق وعروض الليزر</h2>
        <p className="page-desc">يمكنك الإضافة والتعديل والحذف والتفعيل/الإيقاف من هنا.</p>
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.9rem 1rem',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'linear-gradient(135deg, #eef2ff 0%, #f0fdfa 100%)',
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>سعر الضربة (محاسبة بعدد الضربات)</h3>
          <p style={{ margin: '0 0 0.55rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            عندما يفعّل الأخصائي خيار «محاسبة على عدد الضربات» في ملف المريض، يُحسب سعر الجلسة ={' '}
            <strong>سعر الضربة × عدد الضربات</strong> بالليرة السورية.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', alignItems: 'center' }}>
            <label className="form-label" htmlFor="pulse-price-syp" style={{ margin: 0 }}>
              سعر الضربة (ل.س)
            </label>
            <input
              id="pulse-price-syp"
              className="input"
              dir="ltr"
              inputMode="numeric"
              style={{ maxWidth: 160 }}
              value={pulsePriceSyp}
              onChange={(e) => {
                setPulsePriceMsg('')
                setPulsePriceSyp(e.target.value)
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={pulsePriceSaving}
              onClick={async () => {
                setPulsePriceSaving(true)
                setPulsePriceMsg('')
                try {
                  const nSyp = Math.max(0, Math.round(parseFloat(pulsePriceSyp.replace(/,/g, '')) || 0))
                  const data = await api<{ pricePerPulseSyp: number }>('/api/laser/pricing-settings', {
                    method: 'PATCH',
                    body: JSON.stringify({ pricePerPulseSyp: nSyp }),
                  })
                  setPulsePriceSyp(String(Math.max(0, Math.round(Number(data.pricePerPulseSyp) ?? nSyp))))
                  setPulsePriceMsg('تم حفظ سعر الضربة.')
                } catch (e) {
                  setPulsePriceMsg(e instanceof ApiError ? e.message : 'تعذر الحفظ')
                } finally {
                  setPulsePriceSaving(false)
                }
              }}
            >
              {pulsePriceSaving ? 'جاري الحفظ…' : 'حفظ سعر الضربة'}
            </button>
          </div>
          {pulsePriceMsg ? (
            <p
              style={{
                margin: '0.5rem 0 0',
                fontSize: '0.84rem',
                color: pulsePriceMsg.includes('تعذر') ? 'var(--danger)' : 'var(--success)',
              }}
            >
              {pulsePriceMsg}
            </p>
          ) : null}
        </div>
        <div
          style={{
            marginBottom: '1rem',
            marginTop: '0.75rem',
            padding: '0.9rem 1rem',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'linear-gradient(135deg, #faf5ff 0%, #ecfeff 100%)',
          }}
        >
          <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>سعر خيار «كفر ليزر»</h3>
          <p style={{ margin: '0 0 0.55rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            عند إنشاء الجلسة يمكن للأخصائي تفعيل «كفر ليزر»؛ يُضاف هذا المبلغ إلى بند الفوترة للمريض.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', alignItems: 'center' }}>
            <label className="form-label" htmlFor="laser-cover-price-syp" style={{ margin: 0 }}>
              السعر (ل.س)
            </label>
            <input
              id="laser-cover-price-syp"
              className="input"
              dir="ltr"
              inputMode="numeric"
              style={{ maxWidth: 160 }}
              value={laserCoverPriceSyp}
              onChange={(e) => {
                setLaserCoverMsg('')
                setLaserCoverPriceSyp(e.target.value)
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={laserCoverSaving}
              onClick={async () => {
                setLaserCoverSaving(true)
                setLaserCoverMsg('')
                try {
                  const nSyp = Math.max(0, Math.round(parseFloat(laserCoverPriceSyp.replace(/,/g, '')) || 0))
                  const data = await api<{ laserCoverSyp?: number }>('/api/laser/pricing-settings', {
                    method: 'PATCH',
                    body: JSON.stringify({ laserCoverSyp: nSyp }),
                  })
                  setLaserCoverPriceSyp(String(Math.max(0, Math.round(Number(data.laserCoverSyp) ?? nSyp))))
                  setLaserCoverMsg('تم حفظ سعر كفر الليزر.')
                } catch (e) {
                  setLaserCoverMsg(e instanceof ApiError ? e.message : 'تعذر الحفظ')
                } finally {
                  setLaserCoverSaving(false)
                }
              }}
            >
              {laserCoverSaving ? 'جاري الحفظ…' : 'حفظ'}
            </button>
          </div>
          {laserCoverMsg ? (
            <p
              style={{
                margin: '0.5rem 0 0',
                fontSize: '0.84rem',
                color: laserCoverMsg.includes('تعذر') ? 'var(--danger)' : 'var(--success)',
              }}
            >
              {laserCoverMsg}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <input className="input" placeholder="اسم المنطقة/العرض" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select className="select" value={newGroup} onChange={(e) => setNewGroup(e.target.value)}>
            {GROUP_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <select className="select" value={newKind} onChange={(e) => setNewKind(e.target.value as 'area' | 'offer')}>
            <option value="area">منطقة</option>
            <option value="offer">عرض</option>
          </select>
          <input
            className="input"
            placeholder="سعر الذكور ل.س"
            value={newPriceMale}
            onChange={(e) => setNewPriceMale(e.target.value)}
          />
          <input
            className="input"
            placeholder="سعر الإناث ل.س"
            value={newPriceFemale}
            onChange={(e) => setNewPriceFemale(e.target.value)}
          />
          <input className="input" placeholder="الترتيب" value={newSortOrder} onChange={(e) => setNewSortOrder(e.target.value)} />
          <input
            className="input"
            placeholder="عدد المناطق في العرض"
            value={newAreaCount}
            onChange={(e) => setNewAreaCount(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              await api('/api/laser/procedure-options', {
                method: 'POST',
                body: JSON.stringify({
                  name: newName,
                  groupId: newGroup,
                  kind: newKind,
                  priceMaleSyp: Number(newPriceMale) || 0,
                  priceFemaleSyp: Number(newPriceFemale) || 0,
                  areaCount: Math.max(1, Math.min(20, Math.trunc(Number(newAreaCount) || 1))),
                  sortOrder: Number(newSortOrder) || 999,
                }),
              })
              setNewName('')
              setNewPriceMale('55000')
              setNewPriceFemale('55000')
              setNewAreaCount('1')
              setNewSortOrder('999')
              await loadProcedureOptions()
            }}
          >
            إضافة
          </button>
        </div>
        {procErr ? <p style={{ color: 'var(--danger)', marginBottom: 0 }}>{procErr}</p> : null}
        {procLoading ? (
          <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.9rem' }}>
            {laserGroupsOrdered.map((g) => (
              <div key={g.id} className="table-wrap">
                <h3 style={{ margin: '0 0 0.45rem' }}>{g.title}</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>النوع</th>
                      <th>سعر الذكور</th>
                      <th>سعر الإناث</th>
                      <th>عدد المناطق</th>
                      <th>الحالة</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.kind === 'offer' ? 'عرض' : 'منطقة'}</td>
                        <td>{Number(item.priceMaleSyp ?? item.priceSyp ?? 0).toLocaleString('en-US')}</td>
                        <td>{Number(item.priceFemaleSyp ?? item.priceSyp ?? 0).toLocaleString('en-US')}</td>
                        <td>{Math.max(1, Number(item.areaCount) || 1)}</td>
                        <td>{item.active ? 'مفعل' : 'موقوف'}</td>
                        <td style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setEditingId(item.id)
                              setEditName(item.name)
                              setEditGroup(item.groupId)
                              setEditKind(item.kind)
                              setEditPriceMale(String(item.priceMaleSyp ?? item.priceSyp ?? 0))
                              setEditPriceFemale(String(item.priceFemaleSyp ?? item.priceSyp ?? 0))
                              setEditAreaCount(String(Math.max(1, Number(item.areaCount) || 1)))
                              setEditSortOrder(String(item.sortOrder || 999))
                            }}
                          >
                            تعديل
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={async () => {
                              await api(`/api/laser/procedure-options/${item.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ active: !item.active }),
                              })
                              await loadProcedureOptions()
                            }}
                          >
                            {item.active ? 'إيقاف' : 'تفعيل'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={async () => {
                              await api(`/api/laser/procedure-options/${item.id}`, { method: 'DELETE' })
                              await loadProcedureOptions()
                            }}
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div
              style={{
                marginTop: '1.1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border)',
              }}
            >
              <h3 style={{ margin: '0 0 0.35rem' }}>باكجات الليزر (قوالب)</h3>
              <p style={{ margin: '0 0 0.65rem', fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                يُعرَّف الباكج هنا بالاسم والمناطق المشمولة وسعر القائمة. عند بيعه من ملف المريض يُنسخ إلى ملفه مع
                عدد الجلسات والسعر الفعلي الذي يحدده الاستقبال.
              </p>
              {pkgTplErr ? <p style={{ color: 'var(--danger)', marginBottom: '0.5rem' }}>{pkgTplErr}</p> : null}
              <div style={{ display: 'grid', gap: '0.55rem', marginBottom: '0.75rem' }}>
                <input
                  className="input"
                  placeholder="اسم الباكج"
                  value={pkgTplNewName}
                  onChange={(e) => setPkgTplNewName(e.target.value)}
                />
                <div>
                  <p style={{ margin: '0 0 0.35rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    المناطق/العروض المشمولة (اختر من القائمة — العدد يجب أن يطابق «عدد المناطق» المرسل للخادم)
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                      maxHeight: 160,
                      overflow: 'auto',
                      padding: '0.45rem',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--surface-1)',
                    }}
                  >
                    {groups.flatMap((gr) =>
                      (gr.items || []).filter((it) => it.active).map((it) => {
                        const on = pkgTplNewSel.includes(it.id)
                        return (
                          <button
                            key={it.id}
                            type="button"
                            className={`btn ${on ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ fontSize: '0.78rem', padding: '0.28rem 0.5rem' }}
                            onClick={() =>
                              setPkgTplNewSel((prev) =>
                                prev.includes(it.id) ? prev.filter((x) => x !== it.id) : [...prev, it.id],
                              )
                            }
                          >
                            {it.name}
                          </button>
                        )
                      }),
                    )}
                  </div>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    المختار: <strong>{pkgTplNewSel.length}</strong> عنصر
                  </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
                  <input
                    className="input"
                    placeholder="سعر الباكج (ل.س)"
                    inputMode="numeric"
                    value={pkgTplNewPrice}
                    onChange={(e) => setPkgTplNewPrice(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="ترتيب العرض"
                    value={pkgTplNewSort}
                    onChange={(e) => setPkgTplNewSort(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ justifySelf: 'start' }}
                  disabled={pkgTplSaving}
                  onClick={async () => {
                    const name = pkgTplNewName.trim()
                    if (!name) {
                      setPkgTplErr('أدخل اسماً للباكج')
                      return
                    }
                    if (pkgTplNewSel.length < 1) {
                      setPkgTplErr('اختر منطقة أو أكثر من القائمة')
                      return
                    }
                    setPkgTplSaving(true)
                    setPkgTplErr('')
                    try {
                      await api('/api/laser/package-templates', {
                        method: 'POST',
                        body: JSON.stringify({
                          name,
                          procedureOptionIds: pkgTplNewSel,
                          areaCount: pkgTplNewSel.length,
                          listPriceSyp: Math.max(0, Math.round(parseFloat(pkgTplNewPrice.replace(/,/g, '')) || 0)),
                          sortOrder: Math.trunc(Number(pkgTplNewSort) || 0),
                        }),
                      })
                      setPkgTplNewName('')
                      setPkgTplNewSel([])
                      setPkgTplNewPrice('')
                      setPkgTplNewSort('0')
                      await loadPackageTemplates()
                    } catch (e) {
                      setPkgTplErr(e instanceof ApiError ? e.message : 'تعذر إنشاء الباكج')
                    } finally {
                      setPkgTplSaving(false)
                    }
                  }}
                >
                  {pkgTplSaving ? 'جاري الإضافة…' : 'إضافة باكج'}
                </button>
              </div>
              {pkgTplLoading ? (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري تحميل القوالب…</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>الاسم</th>
                        <th>المناطق</th>
                        <th>العدد</th>
                        <th>سعر القائمة</th>
                        <th>الحالة</th>
                        <th>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pkgTemplates.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td style={{ fontSize: '0.82rem', maxWidth: 280 }}>
                            {row.procedureOptionIds
                              .map((oid) => laserProcById.get(oid)?.name || oid)
                              .join('، ')}
                          </td>
                          <td>{row.areaCount}</td>
                          <td>{Number(row.listPriceSyp || 0).toLocaleString('en-US')}</td>
                          <td>{row.active ? 'مفعّل' : 'موقوف'}</td>
                          <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: '0.78rem' }}
                              onClick={() => {
                                setPkgTplEdit(row)
                                setPkgTplEditName(row.name)
                                setPkgTplEditSel([...row.procedureOptionIds])
                                setPkgTplEditPrice(String(row.listPriceSyp))
                                setPkgTplEditSort(String(row.sortOrder ?? 0))
                              }}
                            >
                              تعديل
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ fontSize: '0.78rem' }}
                              onClick={async () => {
                                try {
                                  await api(`/api/laser/package-templates/${encodeURIComponent(row.id)}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ active: !row.active }),
                                  })
                                  await loadPackageTemplates()
                                } catch (e) {
                                  setPkgTplErr(e instanceof ApiError ? e.message : 'تعذر تحديث الحالة')
                                }
                              }}
                            >
                              {row.active ? 'إيقاف' : 'تفعيل'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.78rem' }}
                              onClick={async () => {
                                if (!window.confirm('حذف هذا القالب؟')) return
                                try {
                                  await api(`/api/laser/package-templates/${encodeURIComponent(row.id)}`, {
                                    method: 'DELETE',
                                  })
                                  await loadPackageTemplates()
                                } catch (e) {
                                  setPkgTplErr(e instanceof ApiError ? e.message : 'تعذر الحذف')
                                }
                              }}
                            >
                              حذف
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pkgTemplates.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginTop: '0.5rem' }}>
                      لا توجد قوالب بعد.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {pkgTplEdit ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPkgTplEdit(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>تعديل باكج الليزر</h3>
            <div style={{ display: 'grid', gap: '0.55rem' }}>
              <input
                className="input"
                placeholder="اسم الباكج"
                value={pkgTplEditName}
                onChange={(e) => setPkgTplEditName(e.target.value)}
              />
              <div>
                <p style={{ margin: '0 0 0.35rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>المناطق المشمولة</p>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.4rem',
                    maxHeight: 160,
                    overflow: 'auto',
                    padding: '0.45rem',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  {groups.flatMap((gr) =>
                    (gr.items || []).filter((it) => it.active || pkgTplEditSel.includes(it.id)).map((it) => {
                      const on = pkgTplEditSel.includes(it.id)
                      return (
                        <button
                          key={it.id}
                          type="button"
                          className={`btn ${on ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.78rem', padding: '0.28rem 0.5rem' }}
                          onClick={() =>
                            setPkgTplEditSel((prev) =>
                              prev.includes(it.id) ? prev.filter((x) => x !== it.id) : [...prev, it.id],
                            )
                          }
                        >
                          {it.name}
                        </button>
                      )
                    }),
                  )}
                </div>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  المختار: <strong>{pkgTplEditSel.length}</strong>
                </p>
              </div>
              <input
                className="input"
                placeholder="سعر القائمة (ل.س)"
                inputMode="numeric"
                value={pkgTplEditPrice}
                onChange={(e) => setPkgTplEditPrice(e.target.value)}
              />
              <input
                className="input"
                placeholder="الترتيب"
                value={pkgTplEditSort}
                onChange={(e) => setPkgTplEditSort(e.target.value)}
              />
            </div>
            {pkgTplErr ? <p style={{ color: 'var(--danger)', marginTop: '0.5rem' }}>{pkgTplErr}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.85rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setPkgTplEdit(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pkgTplSaving}
                onClick={async () => {
                  if (!pkgTplEdit) return
                  const name = pkgTplEditName.trim()
                  if (!name) {
                    setPkgTplErr('أدخل اسماً للباكج')
                    return
                  }
                  if (pkgTplEditSel.length < 1) {
                    setPkgTplErr('اختر منطقة أو أكثر')
                    return
                  }
                  setPkgTplSaving(true)
                  setPkgTplErr('')
                  try {
                    await api(`/api/laser/package-templates/${encodeURIComponent(pkgTplEdit.id)}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        name,
                        procedureOptionIds: pkgTplEditSel,
                        areaCount: pkgTplEditSel.length,
                        listPriceSyp: Math.max(0, Math.round(parseFloat(pkgTplEditPrice.replace(/,/g, '')) || 0)),
                        sortOrder: Math.trunc(Number(pkgTplEditSort) || 0),
                      }),
                    })
                    setPkgTplEdit(null)
                    await loadPackageTemplates()
                  } catch (e) {
                    setPkgTplErr(e instanceof ApiError ? e.message : 'تعذر الحفظ')
                  } finally {
                    setPkgTplSaving(false)
                  }
                }}
              >
                {pkgTplSaving ? 'جاري الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingId ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>تعديل المنطقة / العرض</h3>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <select className="select" value={editGroup} onChange={(e) => setEditGroup(e.target.value)}>
                {GROUP_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <select className="select" value={editKind} onChange={(e) => setEditKind(e.target.value as 'area' | 'offer')}>
                <option value="area">منطقة</option>
                <option value="offer">عرض</option>
              </select>
              <input
                className="input"
                placeholder="سعر الذكور"
                value={editPriceMale}
                onChange={(e) => setEditPriceMale(e.target.value)}
              />
              <input
                className="input"
                placeholder="سعر الإناث"
                value={editPriceFemale}
                onChange={(e) => setEditPriceFemale(e.target.value)}
              />
              <input
                className="input"
                placeholder="عدد المناطق في العرض"
                value={editAreaCount}
                onChange={(e) => setEditAreaCount(e.target.value)}
              />
              <input className="input" value={editSortOrder} onChange={(e) => setEditSortOrder(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  await api(`/api/laser/procedure-options/${editingId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      name: editName,
                      groupId: editGroup,
                      kind: editKind,
                      priceMaleSyp: Number(editPriceMale) || 0,
                      priceFemaleSyp: Number(editPriceFemale) || 0,
                      areaCount: Math.max(1, Math.min(20, Math.trunc(Number(editAreaCount) || 1))),
                      sortOrder: Number(editSortOrder) || 999,
                    }),
                  })
                  setEditingId(null)
                  await loadProcedureOptions()
                }}
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dermEditOpen != null ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>تعديل جدول الجلدية رقم {dermEditOpen}</h3>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <div>
                <label className="form-label" htmlFor="derm-board-title">
                  اسم الجدول
                </label>
                <input
                  id="derm-board-title"
                  className="input"
                  value={dermTitle}
                  onChange={(e) => setDermTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="derm-board-user">
                  الطبيب المرتبط
                </label>
                <select
                  id="derm-board-user"
                  className="select"
                  value={dermUserId}
                  onChange={(e) => setDermUserId(e.target.value)}
                >
                  <option value="">— بدون ربط —</option>
                  {dermUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDermEditOpen(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  if (!dermTitle.trim()) return
                  await api(`/api/schedule/dermatology-boards/${dermEditOpen}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      title: dermTitle.trim(),
                      assignedUserId: dermUserId || null,
                    }),
                  })
                  setDermEditOpen(null)
                  await load()
                }}
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
