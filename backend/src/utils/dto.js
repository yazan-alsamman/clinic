export function patientToDto(p) {
  if (!p) return null
  const o = p.toObject ? p.toObject() : p
  return {
    id: String(o._id),
    name: o.name,
    dob: o.dob ?? '',
    marital: o.marital ?? '',
    occupation: o.occupation ?? '',
    medicalHistory: o.medicalHistory ?? '',
    surgicalHistory: o.surgicalHistory ?? '',
    allergies: o.allergies ?? '',
    departments: o.departments ?? [],
    lastVisit: o.lastVisit ? o.lastVisit.toISOString().slice(0, 10) : '',
    phone: o.phone ?? '',
    gender: o.gender === 'male' || o.gender === 'female' ? o.gender : '',
  }
}

export function userToPublic(u) {
  if (!u) return null
  const o = u.toObject ? u.toObject() : u
  return {
    id: String(o._id),
    email: o.email,
    name: o.name,
    role: o.role,
    active: o.active !== false,
    doctorSharePercent: Number(o.doctorSharePercent) || 0,
  }
}
