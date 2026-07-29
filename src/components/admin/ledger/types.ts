/** A user referenced by a ledger entry (recorder or collector). */
export interface LedgerPerson {
  id: string;
  name: string | null;
  email: string | null;
}

/** Shape of a ledger entry as the admin API returns it. */
export interface LedgerEntry {
  id: string;
  kind: 'REVENUE' | 'EXPENSE';
  revenueCategory: string | null;
  customerName: string | null;
  serviceDate: string | null;
  serviceStartTime: string | null;
  serviceEndTime: string | null;
  expenseCategory: string | null;
  expenseSubcategory: string | null;
  description: string | null;
  paidTo: string | null;
  amount: number;
  entryDate: string;
  entryTime: string;
  paymentMethod: string;
  remarks: string | null;
  /** Who physically handled the money. */
  collectedById: string | null;
  collectedBy: LedgerPerson | null;
  /** Who keyed the entry in — never changes on edit. */
  recordedById: string;
  recordedBy: LedgerPerson | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerListResponse {
  entries: LedgerEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: number;
  /** Everyone who has recorded an entry here — the "Recorded By" filter. */
  recorders: LedgerPerson[];
  /**
   * Everyone who appears as the money handler on an entry here — the
   * "Collected By" / "Expenses Made By" filter. Entry-derived, so a
   * staff member who has since left is still filterable; `collectors`
   * below is the *form's* picker and lists active members only.
   */
  handlers: LedgerPerson[];
  /** Center members selectable as "Collected By". */
  collectors: LedgerPerson[];
  /** Full admins only. */
  canDelete: boolean;
  /** False for moderators, who may edit only their own entries. */
  canEditAll: boolean;
  /** The current user's id, for the per-row edit check. */
  viewerId: string;
}
