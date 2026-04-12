import type { LaserCategory } from '../types'

/** Sample hierarchical catalog (subset from spec) */
export const laserAreaCatalog: LaserCategory[] = [
  {
    id: 'f-upper',
    title: 'وجه علوي',
    areas: [
      { id: 'f-forehead', label: 'جبين', minutes: 10 },
      { id: 'f-chin', label: 'ذقن', minutes: 10 },
      { id: 'f-nose', label: 'أنف', minutes: 10 },
      { id: 'f-mustache', label: 'شارب', minutes: 10 },
    ],
  },
  {
    id: 'neck',
    title: 'الرقبة',
    areas: [
      { id: 'neck-full', label: 'رقبة كاملة', minutes: 5 },
      { id: 'neck-partial', label: 'رقبة نقرة', minutes: 5 },
    ],
  },
  {
    id: 'upper-limbs',
    title: 'أطراف علوية',
    areas: [
      { id: 'armpits', label: 'إبطين', minutes: 30 },
      { id: 'forearms', label: 'سواعد', minutes: 30 },
      { id: 'elbows', label: 'زنود', minutes: 30 },
      { id: 'hands', label: 'كفّي اليدين', minutes: 30 },
    ],
  },
  {
    id: 'torso',
    title: 'جذع',
    areas: [
      { id: 'chest-line', label: 'خط الصدر', minutes: 10 },
      { id: 'abdomen', label: 'بطن', minutes: 10 },
      { id: 'lower-back', label: 'أسفل الظهر', minutes: 5 },
    ],
  },
  {
    id: 'm-upper',
    title: 'وجه علوي',
    areas: [
      { id: 'm-nose', label: 'أنف', minutes: 10 },
      { id: 'm-forehead', label: 'جبهة', minutes: 10 },
      { id: 'm-chin-u', label: 'ذقن أعلى', minutes: 10 },
    ],
  },
]
