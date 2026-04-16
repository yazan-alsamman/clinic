import { useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

type Dept = 'laser' | 'dermatology' | 'dental' | 'solarium'

type IntakeForm = {
  fileNumber: string
  name: string
  dob: string
  phone: string
  gender: '' | 'male' | 'female'
  marital: string
  occupation: string
  medicalHistory: string
  surgicalHistory: string
  allergies: string
  departments: Dept[]
  paperLaserEntries: Array<{
    therapist: string
    sessionDate: string
    area: string
    laserType: string
    pw: string
    pulse: string
    shots: string
    notes: string
  }>
}

const emptyForm: IntakeForm = {
  fileNumber: '',
  name: '',
  dob: '',
  phone: '',
  gender: '',
  marital: '',
  occupation: '',
  medicalHistory: '',
  surgicalHistory: '',
  allergies: '',
  departments: [],
  paperLaserEntries: [],
}

function normalizeGender(raw: string): '' | 'male' | 'female' {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
  if (['male', 'm', 'ذكر', 'ز'].includes(v)) return 'male'
  if (['female', 'f', 'أنثى', 'انثى', 'ا'].includes(v)) return 'female'
  return ''
}

function parseDepartments(raw: string): Dept[] {
  const parts = String(raw || '')
    .split(/[|,;]+/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  const set = new Set<Dept>()
  for (const p of parts) {
    if (['laser', 'ليزر'].includes(p)) set.add('laser')
    else if (['dermatology', 'جلدية'].includes(p)) set.add('dermatology')
    else if (['dental', 'أسنان', 'اسنان'].includes(p)) set.add('dental')
    else if (['solarium', 'سولاريوم'].includes(p)) set.add('solarium')
  }
  return [...set]
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t')
  if (line.includes('|')) return line.split('|')
  return line.split(',')
}

export function PatientFastIntakePage() {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [form, setForm] = useState<IntakeForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [lastCreatedId, setLastCreatedId] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResult, setBulkResult] = useState('')

  const canUse = user?.role === 'super_admin' || user?.role === 'reception'
  const deptHint = useMemo(() => form.departments.join(', ') || 'بدون أقسام مبدئية', [form.departments])

  function toggleDept(d: Dept) {
    setForm((f) => ({
      ...f,
      departments: f.departments.includes(d) ? f.departments.filter((x) => x !== d) : [...f.departments, d],
    }))
  }

  function addPaperRow() {
    setForm((f) => ({
      ...f,
      paperLaserEntries: [
        ...f.paperLaserEntries,
        { therapist: '', sessionDate: '', area: '', laserType: '', pw: '', pulse: '', shots: '', notes: '' },
      ],
    }))
  }

  function removePaperRow(idx: number) {
    setForm((f) => ({ ...f, paperLaserEntries: f.paperLaserEntries.filter((_, i) => i !== idx) }))
  }

  function patchPaperRow(
    idx: number,
    key: 'therapist' | 'sessionDate' | 'area' | 'laserType' | 'pw' | 'pulse' | 'shots' | 'notes',
    value: string,
  ) {
    setForm((f) => ({
      ...f,
      paperLaserEntries: f.paperLaserEntries.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    }))
  }

  async function saveSingle() {
    setErr('')
    setOk('')
    const fileNumber = form.fileNumber.trim()
    const name = form.name.trim()
    if (!fileNumber) {
      setErr('رقم الإضبارة مطلوب')
      return
    }
    if (!name) {
      setErr('اسم المريض مطلوب')
      return
    }
    setSaving(true)
    try {
      const created = await api<{ patient: { id: string } }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          fileNumber,
          name,
          dob: form.dob,
          phone: form.phone.trim(),
          gender: form.gender,
          marital: form.marital.trim(),
          occupation: form.occupation.trim(),
          medicalHistory: form.medicalHistory.trim(),
          surgicalHistory: form.surgicalHistory.trim(),
          allergies: form.allergies.trim(),
          departments: form.departments,
          paperLaserEntries: form.paperLaserEntries,
        }),
      })
      setLastCreatedId(created.patient.id)
      setOk(`تم حفظ الإضبارة ${fileNumber} بنجاح`)
      setForm((f) => ({ ...emptyForm, dob: f.dob }))
      window.setTimeout(() => fileRef.current?.focus(), 0)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  async function runBulkInsert() {
    setBulkResult('')
    const lines = bulkText
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (!lines.length) {
      setBulkResult('لا يوجد سطور للإدخال')
      return
    }
    setBulkRunning(true)
    let okCount = 0
    let failCount = 0
    const failures: string[] = []
    try {
      for (let i = 0; i < lines.length; i += 1) {
        const cols = splitLine(lines[i]).map((x) => x.trim())
        const [
          fileNumber = '',
          name = '',
          phone = '',
          dob = '',
          genderRaw = '',
          marital = '',
          occupation = '',
          medicalHistory = '',
          surgicalHistory = '',
          allergies = '',
          departmentsRaw = '',
        ] = cols
        if (!fileNumber || !name) {
          failCount += 1
          failures.push(`سطر ${i + 1}: fileNumber أو name مفقود`)
          continue
        }
        try {
          await api('/api/patients', {
            method: 'POST',
            body: JSON.stringify({
              fileNumber,
              name,
              phone,
              dob,
              gender: normalizeGender(genderRaw),
              marital,
              occupation,
              medicalHistory,
              surgicalHistory,
              allergies,
              departments: parseDepartments(departmentsRaw),
              paperLaserEntries: [],
            }),
          })
          okCount += 1
        } catch (e) {
          failCount += 1
          const msg = e instanceof ApiError ? e.message : 'فشل غير معروف'
          failures.push(`سطر ${i + 1} (${fileNumber}): ${msg}`)
        }
      }
      const preview = failures.slice(0, 8).join('\n')
      setBulkResult(
        `تم: ${okCount} | فشل: ${failCount}${preview ? `\n\nأول الأخطاء:\n${preview}` : ''}`,
      )
    } finally {
      setBulkRunning(false)
    }
  }

  if (!canUse) {
    return (
      <>
        <h1 className="page-title">إدخال سريع للأضابير</h1>
        <p className="page-desc">هذه الصفحة متاحة للاستقبال والمدير فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">إدخال سريع للأضابير</h1>
      <p className="page-desc">
        حفظ مباشر إلى قاعدة البيانات. الاختصار: `Ctrl + Enter` للحفظ السريع. ترتيب أعمدة الإدخال الجماعي:
        fileNumber,name,phone,dob,gender,marital,occupation,medicalHistory,surgicalHistory,allergies,departments
      </p>

      <div className="card">
        <h2 className="card-title">إدخال فردي سريع</h2>
        <div className="grid-2">
          <div>
            <label className="form-label">رقم الإضبارة *</label>
            <input
              ref={fileRef}
              className="input"
              value={form.fileNumber}
              onChange={(e) => setForm((f) => ({ ...f, fileNumber: e.target.value }))}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault()
                  void saveSingle()
                }
              }}
              placeholder="مثال: D-008125"
            />
          </div>
          <div>
            <label className="form-label">الاسم الكامل *</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault()
                  void saveSingle()
                }
              }}
            />
          </div>
          <div>
            <label className="form-label">الهاتف</label>
            <input
              className="input"
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">تاريخ الميلاد</label>
            <input
              type="date"
              className="input"
              value={form.dob}
              onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">الجنس</label>
            <select
              className="input"
              value={form.gender}
              onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as IntakeForm['gender'] }))}
            >
              <option value="">غير محدد</option>
              <option value="male">ذكر</option>
              <option value="female">أنثى</option>
            </select>
          </div>
          <div>
            <label className="form-label">الحالة الاجتماعية</label>
            <input
              className="input"
              value={form.marital}
              onChange={(e) => setForm((f) => ({ ...f, marital: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">المهنة</label>
            <input
              className="input"
              value={form.occupation}
              onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">الأقسام المبدئية</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {(['laser', 'dermatology', 'dental', 'solarium'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="chip"
                  style={{ opacity: form.departments.includes(d) ? 1 : 0.5 }}
                  onClick={() => toggleDept(d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{deptHint}</p>
          </div>
        </div>
        <div style={{ marginTop: '0.7rem' }}>
          <label className="form-label">سوابق مرضية</label>
          <textarea
            className="textarea"
            rows={2}
            value={form.medicalHistory}
            onChange={(e) => setForm((f) => ({ ...f, medicalHistory: e.target.value }))}
          />
          <label className="form-label" style={{ marginTop: '0.5rem', display: 'block' }}>
            سوابق جراحية
          </label>
          <textarea
            className="textarea"
            rows={2}
            value={form.surgicalHistory}
            onChange={(e) => setForm((f) => ({ ...f, surgicalHistory: e.target.value }))}
          />
          <label className="form-label" style={{ marginTop: '0.5rem', display: 'block' }}>
            تحسس
          </label>
          <textarea
            className="textarea"
            rows={2}
            value={form.allergies}
            onChange={(e) => setForm((f) => ({ ...f, allergies: e.target.value }))}
          />
        </div>
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <label className="form-label" style={{ margin: 0 }}>
              بيانات جلسات ورقية (إدخال يدوي)
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => addPaperRow()}>
              + إضافة صف
            </button>
          </div>
          <p style={{ margin: '0.35rem 0 0.65rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            مثل الجدول الورقي: المعالج، التاريخ، المنطقة، النوع، P.W، Puls، الضربات، الملاحظات.
          </p>
          {form.paperLaserEntries.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>لا يوجد صفوف مُضافة.</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {form.paperLaserEntries.map((row, idx) => (
                <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.65rem' }}>
                  <div className="grid-2">
                    <div>
                      <label className="form-label">المعالج</label>
                      <input className="input" value={row.therapist} onChange={(e) => patchPaperRow(idx, 'therapist', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">التاريخ</label>
                      <input className="input" value={row.sessionDate} onChange={(e) => patchPaperRow(idx, 'sessionDate', e.target.value)} placeholder="مثال: 22/1/24" />
                    </div>
                    <div>
                      <label className="form-label">المنطقة</label>
                      <input className="input" value={row.area} onChange={(e) => patchPaperRow(idx, 'area', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">Alex / Yag / Mix</label>
                      <input className="input" value={row.laserType} onChange={(e) => patchPaperRow(idx, 'laserType', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">P.W</label>
                      <input className="input" value={row.pw} onChange={(e) => patchPaperRow(idx, 'pw', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">Puls</label>
                      <input className="input" value={row.pulse} onChange={(e) => patchPaperRow(idx, 'pulse', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">الضربات</label>
                      <input className="input" value={row.shots} onChange={(e) => patchPaperRow(idx, 'shots', e.target.value)} />
                    </div>
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <label className="form-label">ملاحظات</label>
                    <textarea className="textarea" rows={2} value={row.notes} onChange={(e) => patchPaperRow(idx, 'notes', e.target.value)} />
                  </div>
                  <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => removePaperRow(idx)}>
                      حذف الصف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {err ? <p style={{ color: 'var(--danger)', marginTop: '0.65rem' }}>{err}</p> : null}
        {ok ? <p style={{ color: 'var(--success)', marginTop: '0.65rem' }}>{ok}</p> : null}
        {lastCreatedId ? (
          <p style={{ color: 'var(--text-muted)', marginTop: '0.4rem', fontSize: '0.82rem' }}>
            آخر ملف محفوظ: {lastCreatedId}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveSingle()}>
            {saving ? 'جاري الحفظ…' : 'حفظ + التالي'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving}
            onClick={() => {
              setForm(emptyForm)
              setErr('')
              setOk('')
              fileRef.current?.focus()
            }}
          >
            تفريغ
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="card-title">إدخال جماعي باللصق</h2>
        <p style={{ marginTop: '-0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          الصق سطور CSV أو TSV (كل سطر = مريض). يمكن استخدام فاصلة `,` أو Tab أو `|`.
        </p>
        <textarea
          className="textarea"
          rows={10}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder="D-008126,محمد أحمد,+9639...,1990-02-20,m,متزوج,موظف,...."
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
          <button type="button" className="btn btn-primary" disabled={bulkRunning} onClick={() => void runBulkInsert()}>
            {bulkRunning ? 'جاري الإدخال…' : 'بدء الإدخال الجماعي'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={bulkRunning} onClick={() => setBulkText('')}>
            مسح النص
          </button>
        </div>
        {bulkResult ? (
          <pre
            style={{
              marginTop: '0.75rem',
              whiteSpace: 'pre-wrap',
              background: 'var(--surface)',
              padding: '0.75rem',
              borderRadius: 8,
              fontFamily: 'inherit',
              fontSize: '0.85rem',
            }}
          >
            {bulkResult}
          </pre>
        ) : null}
      </div>
    </>
  )
}

