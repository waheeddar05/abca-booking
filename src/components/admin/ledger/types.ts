/** Shape of a ledger entry as the admin API returns it. */
export interface LedgerEntry {
  id: string;
  kind: 'REVENUE' | 'EXPENSE';
  revenueCategory: string | null;
  customerName: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  expenseCategory: string | null;
  expenseSubcategory: string | null;
  description: string | null;
  paidTo: string | null;
  amount: number;
  entryDate: string;
  entryTime: string;
  paymentMethod: string;
  remarks: string | null;
  recordedById: string;
  recordedBy: { id: string; name: string | null; email: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerRecorder {
  id: string;
  name: string | null;
  email: string | null;
}

export interface LedgerListResponse {
  entries: LedgerEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: number;
  recorders: LedgerRecorder[];
  canDelete: boolean;
}
