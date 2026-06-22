import { PaymentSettings } from '../models/PaymentSettings.js'

const DEFAULT_BANK_SEED = [
  { name: 'بيمو', active: true, sortOrder: 0 },
  { name: 'العربي الإسلامي', active: true, sortOrder: 1 },
  { name: 'سورية و الخليج', active: true, sortOrder: 2 },
]

export async function getOrCreatePaymentSettings() {
  let doc = await PaymentSettings.findById('default').lean()
  if (!doc) {
    await PaymentSettings.create({ _id: 'default', banks: DEFAULT_BANK_SEED })
    doc = await PaymentSettings.findById('default').lean()
  }
  if (!Array.isArray(doc.banks) || doc.banks.length === 0) {
    await PaymentSettings.updateOne({ _id: 'default' }, { $set: { banks: DEFAULT_BANK_SEED } })
    doc = await PaymentSettings.findById('default').lean()
  }
  return doc
}

export async function listActivePaymentBanks() {
  const doc = await getOrCreatePaymentSettings()
  return (doc.banks || [])
    .map((b) => ({
      id: String(b._id),
      name: String(b.name || '').trim(),
      active: b.active !== false,
      sortOrder: Number(b.sortOrder) || 0,
    }))
    .filter((b) => b.name && b.active)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'ar'))
    .map(({ id, name }) => ({ id, name }))
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ paymentChannel: 'cash' | 'bank', bankName: string }>}
 */
export async function resolvePaymentChannelFromBody(body, opts = {}) {
  const paymentChannel = String(body?.paymentChannel || 'cash').toLowerCase() === 'bank' ? 'bank' : 'cash'
  let bankName = ''
  const requireBank = opts.requireBank !== false
  if (paymentChannel === 'bank' && requireBank) {
    bankName = String(body?.bankName || '').trim()
    const allowedNames = new Set((await listActivePaymentBanks()).map((b) => b.name))
    if (!bankName || !allowedNames.has(bankName)) {
      const err = new Error('اختر البنك من القائمة المعتمدة')
      err.code = 'BANK_REQUIRED'
      throw err
    }
  }
  return { paymentChannel, bankName }
}
