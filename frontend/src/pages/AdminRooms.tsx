import { useEffect, useState } from 'react'
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
  active: boolean
  sortOrder: number
}
type LaserProcedureGroup = { id: string; title: string; items: LaserProcedureItem[] }

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
  const [groups, setGroups] = useState<LaserProcedureGroup[]>([])
  const [procLoading, setProcLoading] = useState(false)
  const [procErr, setProcErr] = useState('')
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('face')
  const [newKind, setNewKind] = useState<'area' | 'offer'>('area')
  const [newPrice, setNewPrice] = useState('55000')
  const [newSortOrder, setNewSortOrder] = useState('999')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState('face')
  const [editKind, setEditKind] = useState<'area' | 'offer'>('area')
  const [editPrice, setEditPrice] = useState('')
  const [editSortOrder, setEditSortOrder] = useState('999')
  const [pulsePriceUsd, setPulsePriceUsd] = useState('0')
  const [pulsePriceSyp, setPulsePriceSyp] = useState('0')
  const [pulsePriceSaving, setPulsePriceSaving] = useState(false)
  const [pulsePriceMsg, setPulsePriceMsg] = useState('')

  async function loadProcedureOptions() {
    setProcLoading(true)
    setProcErr('')
    try {
      const data = await api<{ groups: LaserProcedureGroup[] }>('/api/laser/procedure-options?includeInactive=1')
      setGroups(data.groups || [])
      try {
        const pricing = await api<{ pricePerPulseUsd: number; pricePerPulseSyp: number }>(
          '/api/laser/pricing-settings',
        )
        setPulsePriceUsd(String(Number(pricing.pricePerPulseUsd) || 0))
        setPulsePriceSyp(String(Math.max(0, Math.round(Number(pricing.pricePerPulseSyp) || 0))))
      } catch {
        setPulsePriceUsd('0')
        setPulsePriceSyp('0')
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
      const [rData, uData] = await Promise.all([
        api<{ rooms: RoomRow[] }>('/api/rooms'),
        api<{ users: LaserUser[] }>('/api/users'),
      ])
      setRooms(rData.rooms)
      setLaserUsers(uData.users.filter((u) => u.role === 'laser' && u.active !== false))
    } catch {
      setRooms([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void loadProcedureOptions()
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
            <strong>سعر الضربة × عدد الضربات</strong>. إذا حُدد سعر بالدولار (&gt; 0) يُستخدم للفوترة؛ وإلا يُحسب
            من سعر الليرة مع سعر صرف يوم العمل.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', alignItems: 'center' }}>
            <label className="form-label" htmlFor="pulse-price-usd" style={{ margin: 0 }}>
              سعر الضربة (USD)
            </label>
            <input
              id="pulse-price-usd"
              className="input"
              dir="ltr"
              inputMode="decimal"
              style={{ maxWidth: 160 }}
              value={pulsePriceUsd}
              onChange={(e) => {
                setPulsePriceMsg('')
                setPulsePriceUsd(e.target.value)
              }}
            />
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
                  const nUsd = Math.max(0, parseFloat(pulsePriceUsd.replace(/,/g, '')) || 0)
                  const nSyp = Math.max(0, Math.round(parseFloat(pulsePriceSyp.replace(/,/g, '')) || 0))
                  const data = await api<{ pricePerPulseUsd: number; pricePerPulseSyp: number }>(
                    '/api/laser/pricing-settings',
                    {
                      method: 'PATCH',
                      body: JSON.stringify({ pricePerPulseUsd: nUsd, pricePerPulseSyp: nSyp }),
                    },
                  )
                  setPulsePriceUsd(String(data.pricePerPulseUsd ?? nUsd))
                  setPulsePriceSyp(String(Math.max(0, Math.round(Number(data.pricePerPulseSyp) ?? nSyp))))
                  setPulsePriceMsg('تم حفظ أسعار الضربة.')
                } catch (e) {
                  setPulsePriceMsg(e instanceof ApiError ? e.message : 'تعذر الحفظ')
                } finally {
                  setPulsePriceSaving(false)
                }
              }}
            >
              {pulsePriceSaving ? 'جاري الحفظ…' : 'حفظ أسعار الضربة'}
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
          <input className="input" placeholder="السعر ل.س" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
          <input className="input" placeholder="الترتيب" value={newSortOrder} onChange={(e) => setNewSortOrder(e.target.value)} />
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
                  priceSyp: Number(newPrice) || 0,
                  sortOrder: Number(newSortOrder) || 999,
                }),
              })
              setNewName('')
              setNewPrice('55000')
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
            {groups.map((g) => (
              <div key={g.id} className="table-wrap">
                <h3 style={{ margin: '0 0 0.45rem' }}>{g.title}</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>النوع</th>
                      <th>السعر ل.س</th>
                      <th>الحالة</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.kind === 'offer' ? 'عرض' : 'منطقة'}</td>
                        <td>{Number(item.priceSyp || 0).toLocaleString('en-US')}</td>
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
                              setEditPrice(String(item.priceSyp))
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
          </div>
        )}
      </div>

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
              <input className="input" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
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
                      priceSyp: Number(editPrice) || 0,
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
    </>
  )
}
