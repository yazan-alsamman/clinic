export type ServiceGeometry = 'dentistry' | 'dermatology' | 'skincare' | 'solarium' | 'laser'

export interface ServiceDef {
  id: ServiceGeometry
  name: string
  description: string
  /** Accent hue for this service's equipment materials + glow, as an [r,g,b] 0..1 triple. */
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
    accent: [0.98, 0.96, 0.93],
  },
  {
    id: 'dermatology',
    name: 'الجلدية',
    description: 'عناية جلدية متخصصة وفق أحدث البروتوكولات الطبية.',
    accent: [0.86, 0.6, 0.71],
  },
  {
    id: 'skincare',
    name: 'العناية بالبشرة',
    description: 'نضارة وتجديد للبشرة بلمسة تجميلية راقية.',
    accent: [0.95, 0.78, 0.64],
  },
  {
    id: 'solarium',
    name: 'السولاريوم',
    description: 'إشراقة طبيعية متوازنة بجلسات مدروسة وآمنة.',
    accent: [0.98, 0.75, 0.35],
  },
  {
    id: 'laser',
    name: 'إزالة الشعر بالليزر',
    description: 'إزالة شعر دائمة بتقنية ليزر متقدمة ومريحة.',
    accent: [0.42, 0.6, 0.98],
  },
]
