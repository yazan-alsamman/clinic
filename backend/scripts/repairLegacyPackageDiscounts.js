/**
 * إصلاح الباكجات القديمة التي خُصمت عند تحصيلها (الخصم كان يتحوّل لذمة على المريض).
 *
 * عرض فقط (لا يغيّر شيئاً) — الافتراضي:
 *   node scripts/repairLegacyPackageDiscounts.js
 *   node scripts/repairLegacyPackageDiscounts.js --patient=<patientId>
 *
 * التطبيق (بعد مراجعة القائمة والموافقة):
 *   node scripts/repairLegacyPackageDiscounts.js --apply
 *
 * يطبّق فقط الحالات «ready». حالات «manual_review» (ذمة المريض الحالية أقل من الزائدة — ربما سُدّدت)
 * تُعرض ولا تُعدَّل. لا يلمس قيود الصندوق/الدفتر؛ فرق الإيراد يُعرض فقط.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import {
  applyLegacyPackageDiscountRepair,
  collectLegacyPackageDiscountRepairs,
} from '../src/services/legacyPackageDiscountRepair.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const patientArg = args.find((a) => a.startsWith('--patient='))
const patientId = patientArg ? patientArg.split('=')[1] : null

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')

async function main() {
  await mongoose.connect(config.mongoUri)
  const plans = await collectLegacyPackageDiscountRepairs({ patientId })
  if (!plans.length) {
    console.log('لا توجد باكجات متأثرة.')
    await mongoose.disconnect()
    return
  }
  console.log(`باكجات متأثرة: ${plans.length}${apply ? ' — وضع التطبيق' : ' — عرض فقط (أضف --apply للتطبيق)'}\n`)
  let totalDebt = 0
  let totalRevenue = 0
  for (const p of plans) {
    totalDebt += p.debtReductionSyp
    totalRevenue += p.revenueUnderstatedSyp
    console.log(
      [
        `[${p.status}] ${p.patientName} (إضبارة ${p.fileNumber}) — ${p.packageTitle}`,
        `  السعر ${fmt(p.listPriceSyp)} − خصم ${p.discountPercent}% (${fmt(p.discountAmountSyp)}) = ${fmt(p.correctTotalSyp)} — المدفوع ${fmt(p.paidSyp)}`,
        `  تخفيض الذمة: ${fmt(p.debtReductionSyp)} — زيادة الرصيد: ${fmt(p.creditIncreaseSyp)} — إيراد غير مرحّل (للمحاسب): ${fmt(p.revenueUnderstatedSyp)}`,
        p.reason ? `  ملاحظة: ${p.reason}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  console.log(`\nالإجمالي: تخفيض ذمم ${fmt(totalDebt)} ل.س — إيراد غير مرحّل ${fmt(totalRevenue)} ل.س`)

  if (apply) {
    const actor = { _id: null, name: 'سكربت إصلاح خصم الباكجات' }
    let ok = 0
    for (const p of plans.filter((x) => x.status === 'ready')) {
      const r = await applyLegacyPackageDiscountRepair(p, actor)
      if (r.applied) ok += 1
      else console.log(`لم يُطبَّق ${p.packageId}: ${r.reason}`)
    }
    console.log(`\nطُبّق: ${ok}`)
  }
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
