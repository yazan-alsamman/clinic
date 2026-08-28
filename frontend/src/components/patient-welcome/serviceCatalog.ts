export type ServiceGeometry = 'dentistry' | 'dermatology' | 'skincare' | 'solarium' | 'laser'

export interface ServiceDef {
  id: ServiceGeometry
  name: string
  description: string
  href: string
  /** Accent hue used for this service's material + glow, as an [r,g,b] 0..1 triple. */
  accent: [number, number, number]
}

// Accent colors are drawn from the clinic's brand palette (blush rose-gold from the
// wordmark, plus the app's existing cyan/violet/magenta system) so all five objects
// read as one family rather than five random colors.
export const SERVICES: ServiceDef[] = [
  {
    id: 'dentistry',
    name: 'طب الأسنان',
    description: 'ابتسامة مصممة بعناية — من الفحص الأول حتى خطة العلاج المعتمدة.',
    href: '/patient/records#section-dental',
    accent: [0.98, 0.96, 0.93],
  },
  {
    id: 'dermatology',
    name: 'الجلدية',
    description: 'عناية جلدية متخصصة وفق أحدث البروتوكولات الطبية.',
    href: '/patient/records#section-dermatology',
    accent: [0.86, 0.6, 0.71],
  },
  {
    id: 'skincare',
    name: 'العناية بالبشرة',
    description: 'نضارة وتجديد للبشرة بلمسة تجميلية راقية.',
    href: '/patient/records#section-dermatology',
    accent: [0.95, 0.78, 0.64],
  },
  {
    id: 'solarium',
    name: 'السولاريوم',
    description: 'إشراقة طبيعية متوازنة بجلسات مدروسة وآمنة.',
    href: '/patient/appointments',
    accent: [0.98, 0.75, 0.35],
  },
  {
    id: 'laser',
    name: 'إزالة الشعر بالليزر',
    description: 'إزالة شعر دائمة بتقنية ليزر متقدمة ومريحة.',
    href: '/patient/records#section-laser',
    accent: [0.42, 0.6, 0.98],
  },
]
