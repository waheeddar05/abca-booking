import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';

// Recharts needs a measured container to draw anything, which jsdom never
// provides. The charts are covered by `dashboard-revenue.test.ts` at the data
// layer; here we only care about the summary cards and the operator table.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub,
    Tooltip: Stub, ResponsiveContainer: Stub, Cell: Stub, CartesianGrid: Stub,
  };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import AdminDashboard from '../page';

/** Stats payload shaped like a real /api/admin/stats response. */
const STATS = {
  totalBookings: 120,
  activeAdmins: 2,
  todayBookings: 4,
  upcomingBookings: 9,
  lastMonthBookings: 60,
  totalSlots: 300,
  totalRevenue: 50000,
  bookingRevenue: 30000,
  packageRevenue: 15000,
  manualRevenue: 5000,
  manualExpenses: 12000,
  totalDiscount: 0,
  revenueBreakdown: { axis: 'category', entries: [{ key: 'MACHINE', _sum: { price: 50000 } }] },
  machineTypeRevenue: [{ name: 'Yantra', revenue: 50000 }],
  bookingDistribution: [],
  // 18 + 12 assigned, + 8 self-operated, + 4 unassigned = 42 total.
  operatorSummary: [
    { id: 'op1', name: 'Ravi', sessions: 18 },
    { id: 'op2', name: 'Suresh', sessions: 12 },
  ],
  selfOperatedBookings: 8,
  unassignedBookings: 4,
  operatorSessionsTotal: 42,
  sidearmSummary: [],
  coachSummary: [],
  matchPracticeSummary: { matchSimMonthly: 0, matchSimRegular: 0, corporateMonthly: 0, corporateRegular: 0 },
  systemStatus: 'Healthy',
};

function mockStats(overrides: Partial<typeof STATS> = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...STATS, ...overrides }),
  }));
}

/** The <Link> card whose label matches, so sibling cards can't be confused. */
async function card(label: string): Promise<HTMLElement> {
  const heading = await screen.findByText(label);
  return heading.closest('a') as HTMLElement;
}

/** The two-column Operator Sessions table. */
function operatorRowValue(rowLabel: string): string {
  const cell = screen.getByText(rowLabel);
  const tr = cell.closest('tr') as HTMLElement;
  return within(tr).getAllByRole('cell')[1].textContent?.trim() ?? '';
}

describe('Admin dashboard summary', () => {
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('shows Profit as Total Revenue − Expenses', async () => {
    mockStats();
    render(<AdminDashboard />);

    expect(await within(await card('Total Revenue')).findByText('₹50,000')).toBeInTheDocument();
    expect(within(await card('Expenses')).getByText('₹12,000')).toBeInTheDocument();
    // 50000 − 12000
    expect(within(await card('Profit')).getByText('₹38,000')).toBeInTheDocument();
  });

  it('renders a loss as a negative Profit rather than clamping to zero', async () => {
    mockStats({ totalRevenue: 4000, manualExpenses: 10000 });
    render(<AdminDashboard />);

    expect(await within(await card('Profit')).findByText('-₹6,000')).toBeInTheDocument();
  });

  it('shows ₹0 profit when revenue exactly covers expenses', async () => {
    mockStats({ totalRevenue: 12000, manualExpenses: 12000 });
    render(<AdminDashboard />);

    expect(await within(await card('Profit')).findByText('₹0')).toBeInTheDocument();
  });

  it('breaks operator sessions into per-operator, self-operate and unassigned, and they add up', async () => {
    mockStats();
    render(<AdminDashboard />);

    await screen.findByText('Ravi');
    expect(operatorRowValue('Ravi')).toBe('18');
    expect(operatorRowValue('Suresh')).toBe('12');
    expect(operatorRowValue('Self-Operate')).toBe('8');
    expect(operatorRowValue('Unassigned')).toBe('4');
    expect(operatorRowValue('Total Sessions')).toBe('42');

    const parts = [
      ...STATS.operatorSummary.map(o => o.sessions),
      STATS.selfOperatedBookings,
      STATS.unassignedBookings,
    ];
    expect(parts.reduce((a, b) => a + b, 0)).toBe(Number(operatorRowValue('Total Sessions')));
  });

  it('still shows the self-operate / unassigned / total rows when no operator was assigned', async () => {
    mockStats({
      operatorSummary: [],
      selfOperatedBookings: 7,
      unassignedBookings: 3,
      operatorSessionsTotal: 10,
    });
    render(<AdminDashboard />);

    await screen.findByText('No operator-assigned sessions');
    expect(operatorRowValue('Self-Operate')).toBe('7');
    expect(operatorRowValue('Unassigned')).toBe('3');
    expect(operatorRowValue('Total Sessions')).toBe('10');
  });

  it('falls back to zeroes instead of NaN when the stats request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Boom' }),
    }));
    render(<AdminDashboard />);

    await screen.findByText('Boom');
    await waitFor(async () => {
      expect(within(await card('Profit')).getByText('₹0')).toBeInTheDocument();
    });
    expect(operatorRowValue('Total Sessions')).toBe('0');
  });
});
