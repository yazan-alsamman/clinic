import { CalculationProfile } from '../models/CalculationProfile.js'

/**
 * خطوات ملف CLINIC_NET_SHARE — نفس المدخلات التي يمرّرها postBillingPayment (gross_syp، خصم، مواد، نسبة حصة).
 * تُستخدم min() وليس Math.min لأن محرّك التعبير الآمن يدعم min فقط.
 */
const CLINIC_NET_SHARE_STEPS = [
  {
    order: 1,
    key: 'net_gross',
    expression: 'input.gross_syp * (1 - min(input.discount_percent, param.discount_percent_cap) / 100)',
    description: 'الإجمالي بعد تطبيق سقف الخصم',
  },
  {
    order: 2,
    key: 'doctor_share_syp',
    expression: 'step.net_gross * input.doctor_share_percent / 100',
    description: 'حصة الطبيب',
  },
  {
    order: 3,
    key: 'clinic_net_syp',
    expression: 'step.net_gross - step.doctor_share_syp - input.material_cost_syp',
    description: 'صافي العيادة',
  },
]

/** يضمن وجود ملف حساب CLINIC_NET_SHARE على قواعد جديدة حتى لا يفشل التحصيل والترحيل. */
export async function ensureDefaultCalculationProfiles() {
  try {
    await CalculationProfile.updateOne(
      { code: 'CLINIC_NET_SHARE' },
      {
        $setOnInsert: {
          code: 'CLINIC_NET_SHARE',
          name: 'صافي العيادة بعد حصة الطبيب (افتراضي)',
          active: true,
          department: '',
          accountingStandardTags: [],
          steps: CLINIC_NET_SHARE_STEPS,
        },
      },
      { upsert: true },
    )
  } catch (e) {
    console.error('ensureDefaultCalculationProfiles:', e?.message || e)
  }
}
