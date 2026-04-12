import { useState } from 'react'
import { laserAreaCatalog } from '../data/laserAreas'
import type { LaserCategory } from '../types'

type Props = {
  catalog?: LaserCategory[]
  onAreasChange?: (ids: string[]) => void
  /** مناطق يدوية إضافية (تُحسب في العدد فقط) */
  extraSelectedCount?: number
}

export function LaserAreaPicker({ catalog, onAreasChange, extraSelectedCount = 0 }: Props) {
  const cats = catalog?.length ? catalog : laserAreaCatalog
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onAreasChange?.([...next])
      return next
    })
  }

  const count = selected.size
  const totalAreas = count + extraSelectedCount

  return (
    <div className="laser-area-picker">
      <div className="laser-area-picker__catalog">
        <h3 className="laser-area-picker__h">فئات المناطق</h3>
        {cats.map((cat) => (
          <details key={cat.id} className="area-cat" open>
            <summary>{cat.title}</summary>
            <div className="area-chips">
              {cat.areas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`area-chip-btn${selected.has(a.id) ? ' selected' : ''}`}
                  onClick={() => toggle(a.id)}
                  title={a.label}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="laser-area-picker__summary">
        <h3 className="laser-area-picker__h">ملخص للفوترة</h3>
        <p className="laser-area-picker__hint">
          اختر المناطق من القائمة أو أضف منطقة يدوياً أسفل النموذج.
        </p>
        <div className="area-summary-bar">
          <span>
            <strong>عدد المناطق:</strong> {totalAreas}
            {extraSelectedCount > 0 ? (
              <span style={{ fontWeight: 500, opacity: 0.9 }}>
                {' '}
                (قائمة: {count} + يدوي: {extraSelectedCount})
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  )
}
