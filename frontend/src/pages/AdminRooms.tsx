import { useEffect, useState } from 'react'
import { api } from '../api/client'

type RoomRow = { number: number; assigned: { id: string; name: string } | null }
type LaserUser = { id: string; name: string; role: string; active: boolean }

export function AdminRooms() {
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [laserUsers, setLaserUsers] = useState<LaserUser[]>([])
  const [pickRoom, setPickRoom] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

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
    </>
  )
}
