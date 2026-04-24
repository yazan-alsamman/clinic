export function patientToDto(p) {
  if (!p) return null
  const o = p.toObject ? p.toObject() : p
  return {
    id: String(o._id),
    fileNumber: o.fileNumber ?? '',
    name: o.name,
    dob: o.dob ?? '',
    marital: o.marital ?? '',
    occupation: o.occupation ?? '',
    medicalHistory: o.medicalHistory ?? '',
    surgicalHistory: o.surgicalHistory ?? '',
    allergies: o.allergies ?? '',
    drugHistory: o.drugHistory ?? '',
    pregnancyStatus: o.pregnancyStatus ?? '',
    lactationStatus: o.lactationStatus ?? '',
    previousTreatments: o.previousTreatments ?? '',
    recentDermTreatments: o.recentDermTreatments ?? '',
    isotretinoinHistory: o.isotretinoinHistory ?? '',
    departments: o.departments ?? [],
    lastVisit: o.lastVisit ? o.lastVisit.toISOString().slice(0, 10) : '',
    phone: o.phone ?? '',
    gender: o.gender === 'male' || o.gender === 'female' ? o.gender : '',
    outstandingDebtSyp: Number(o.outstandingDebtSyp) || 0,
    prepaidCreditSyp: Number(o.prepaidCreditSyp) || 0,
    paperLaserEntries: Array.isArray(o.paperLaserEntries) ? o.paperLaserEntries : [],
    sessionPackages: Array.isArray(o.sessionPackages)
      ? o.sessionPackages.map((pkg) => ({
          id: String(pkg?._id || ''),
          department: String(pkg?.department || 'laser'),
          title: String(pkg?.title || ''),
          sessionsCount: Number(pkg?.sessionsCount) || 0,
          packageTotalSyp: Number(pkg?.packageTotalSyp) || 0,
          paidAmountSyp: Number(pkg?.paidAmountSyp) || 0,
          settlementDeltaSyp: Number(pkg?.settlementDeltaSyp) || 0,
          notes: String(pkg?.notes || ''),
          createdAt: pkg?.createdAt ? new Date(pkg.createdAt).toISOString() : null,
          sessions: Array.isArray(pkg?.sessions)
            ? pkg.sessions.map((s) => ({
                id: String(s?._id || ''),
                label: String(s?.label || ''),
                completedByReception: s?.completedByReception === true,
                completedAt: s?.completedAt ? new Date(s.completedAt).toISOString() : null,
                completedByUserId: s?.completedByUserId ? String(s.completedByUserId) : null,
                linkedLaserSessionId: s?.linkedLaserSessionId ? String(s.linkedLaserSessionId) : null,
                linkedBillingItemId: s?.linkedBillingItemId ? String(s.linkedBillingItemId) : null,
              }))
            : [],
        }))
      : [],
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
