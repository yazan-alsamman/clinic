export type BankRow = { bankName: string; totalSyp: number; totalUsd: number }

export type DeptRow = {
  key: string
  label: string
  transactionCount: number
  cashSyp: number
  cashUsd: number
  bankSyp: number
  bankUsd: number
}

export type TxRow = {
  billingItemId: string
  paymentId: string
  transactionKind?: 'billing' | 'debt_settlement'
  paidAt: string | null
  patientName: string
  providerName: string
  receivedByName: string
  department: string
  departmentLabel: string
  procedureLabel: string
  paymentChannel: 'cash' | 'bank'
  bankName: string
  payCurrency: 'SYP' | 'USD'
  receivedAmountSyp: number
  receivedAmountUsd: number
  amountDueSyp: number
  settlementDeltaSyp: number
  patientRefundSyp: number
  patientRefundUsd: number
}

export type InventoryPayload = {
  businessDate: string
  dateLockedToToday: boolean
  dayActive: boolean
  usdSypRate: number | null
  summary: {
    cashBase?: { totalSyp: number; totalUsd: number }
    cash: { totalSyp: number; totalUsd: number }
    banks: BankRow[]
    totals: { totalSyp: number; totalUsd: number }
    refundsRecorded: { totalSyp: number; totalUsd: number }
    transactionCount: number
    pendingCollectionCount: number
  }
  cashMovements?: {
    expense: { totalSyp: number; totalUsd: number }
    receipt: { totalSyp: number; totalUsd: number }
    rows: Array<{
      id: string
      kind: 'expense' | 'receipt'
      reason: string
      amountSyp: number
      amountUsd: number
      createdAt: string | null
    }>
  }
  byDepartment: DeptRow[]
  transactions: TxRow[]
}

export type InventoryApiPayload = Partial<InventoryPayload> & {
  inventoryMode?: 'admin_split' | 'reception_shift' | 'reception_unassigned'
  morning?: InventoryPayload
  evening?: InventoryPayload
  outsideShift?: InventoryPayload
  secretaryShift?: 'morning' | 'evening'
  secretaryShiftUnassigned?: boolean
  pendingCollectionCount?: number
  shiftBounds?: {
    morning: { start: string; end: string }
    evening: { start: string; end: string }
  }
}
