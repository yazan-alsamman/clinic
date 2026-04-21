import { useEffect, useState } from 'react'
import { api } from '../api/client'

type RoomRow = { number: number; assigned: { id: string; name: string } | null }
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

  async function loadProcedureOptions() {
    setProcLoading(true)
    setProcErr('')
    try {
      const data = await api<{ groups: LaserProcedureGroup[] }>('/api/laser/procedure-options?includeInactive=1')
      setGroups(data.groups || [])
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
                المعيّن: {room.assigned?.name ?? '—'}
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '0.75rem' }}
                onClick={() => setPickRoom(room.number)}
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
              اختر أخصائياً من فريق الليزر
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0' }}>
              {laserUsers.map((u) => (
                <li key={u.id} style={{ marginBottom: '0.35rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%' }}
                    onClick={async () => {
                      await api(`/api/rooms/${pickRoom}/assign`, {
                        method: 'PATCH',
                        body: JSON.stringify({ userId: u.id }),
                      })
                      setPickRoom(null)
                      await load()
                    }}
                  >
                    {u.name}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPickRoom(null)}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">إدارة مناطق وعروض الليزر</h2>
        <p className="page-desc">يمكنك الإضافة والتعديل والحذف والتفعيل/الإيقاف من هنا.</p>
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
