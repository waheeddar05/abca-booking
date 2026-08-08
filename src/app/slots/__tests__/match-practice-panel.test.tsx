import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const apiGet = vi.fn();
vi.mock('@/lib/api-client', () => ({ api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('@/lib/useRazorpay', () => ({
  useRazorpay: () => ({ initiatePayment: vi.fn(), processing: false }),
}));

import MatchPracticePanel from '../MatchPracticePanel';

const HALF_MONTH = { enabled: false, fee: 0, firstHalf: false, secondHalf: false, splitDay: 15 };

function availability({
  corporate = true,
  simulation = true,
}: { corporate?: boolean; simulation?: boolean } = {}) {
  return {
    centerId: 'ctr_toplay',
    corporateBatch: {
      enabled: corporate,
      days: [1, 3, 5],
      startTime: '07:00',
      endTime: '09:00',
      coachName: 'Govind Lashkare',
      monthlyFee: 2000,
      regularFee: 200,
      maxCapacity: 25,
      halfMonth: HALF_MONTH,
      months: [{
        period: '2026-09', label: 'September 2026', fee: 2000, enrolled: 4,
        capacity: 25, isFull: false, startsOn: '2026-09-01',
        slot: { date: '2026-09-01', startTime: '07:00', endTime: '09:00' },
      }],
      sessions: [{
        date: '2026-08-10', dayLabel: 'Mon', startTime: '2026-08-10T01:30:00.000Z',
        endTime: '2026-08-10T03:30:00.000Z', fee: 200, seatsBooked: 3,
        capacity: 25, remaining: 22, isFull: false,
      }],
    },
    matchSimulation: {
      enabled: simulation,
      sessions: [{
        sessionId: 'sim1', label: 'Morning Sim', coachName: null,
        date: '2026-08-11', dayLabel: 'Tue', startTime: '2026-08-11T01:30:00.000Z',
        endTime: '2026-08-11T03:30:00.000Z', fee: 500, booked: 2,
        capacity: 10, remaining: 8, isFull: false,
      }],
      monthly: {
        enabled: true,
        sessions: [{
          sessionId: 'sim1', label: 'Morning Sim', coachName: null, days: [2, 4],
          startTime: '07:00', endTime: '09:00', monthlyFee: 3000, capacity: 10,
          halfMonth: HALF_MONTH,
          months: [{
            period: '2026-09', label: 'September 2026', fee: 3000, enrolled: 1,
            capacity: 10, isFull: false, startsOn: '2026-09-01',
            slot: { date: '2026-09-01', startTime: '07:00', endTime: '09:00' },
          }],
        }],
      },
    },
  };
}

function renderPanel(data: ReturnType<typeof availability>) {
  apiGet.mockResolvedValue(data);
  return render(
    <MatchPracticePanel
      playerName="Asha"
      userEmail="asha@example.com"
      isFreeBooking={false}
      paymentConfig={{
        paymentEnabled: true, slotPaymentRequired: true,
        cashPaymentEnabled: false, walletEnabled: false,
      }}
    />,
  );
}

/** A toggle tile is "selected" when it carries the solid accent fill. */
function isSelected(label: string): boolean {
  const button = screen.getByText(label).closest('button') as HTMLElement;
  return button.className.includes('bg-accent');
}

describe('MatchPracticePanel — Session Type visibility', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('shows both options when both session types are enabled', async () => {
    renderPanel(availability());

    expect(await screen.findByText('Session Type')).toBeInTheDocument();
    expect(screen.getByText('Match Simulation')).toBeInTheDocument();
    expect(screen.getByText('Corporate Batch')).toBeInTheDocument();
  });

  it('still shows the box — with only the enabled option — when Corporate Batch is disabled', async () => {
    renderPanel(availability({ corporate: false }));

    expect(await screen.findByText('Session Type')).toBeInTheDocument();
    expect(screen.getByText('Match Simulation')).toBeInTheDocument();
    expect(screen.queryByText('Corporate Batch')).not.toBeInTheDocument();
  });

  it('still shows the box — with only the enabled option — when Match Simulation is disabled', async () => {
    renderPanel(availability({ simulation: false }));

    expect(await screen.findByText('Session Type')).toBeInTheDocument();
    expect(screen.getByText('Corporate Batch')).toBeInTheDocument();
    expect(screen.queryByText('Match Simulation')).not.toBeInTheDocument();
  });

  it('hides Match Practice entirely only when both session types are disabled', async () => {
    renderPanel(availability({ corporate: false, simulation: false }));

    expect(await screen.findByText(/isn't available at this center yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Session Type')).not.toBeInTheDocument();
  });
});

describe('MatchPracticePanel — landing defaults', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('lands on Match Simulation + Regular with no user action', async () => {
    renderPanel(availability());

    await screen.findByText('Session Type');
    expect(isSelected('Match Simulation')).toBe(true);
    expect(isSelected('Corporate Batch')).toBe(false);

    // Booking Option defaults to Regular, so the per-session picker is what
    // the user sees first — not the monthly month cards.
    expect(isSelected('Regular')).toBe(true);
    expect(isSelected('Monthly')).toBe(false);
    expect(screen.getByText('Upcoming Sessions')).toBeInTheDocument();
    expect(screen.queryByText('Select Month')).not.toBeInTheDocument();
  });

  it('defaults Corporate Batch to Regular too, when it is the only type enabled', async () => {
    renderPanel(availability({ simulation: false }));

    await screen.findByText('Session Type');
    expect(isSelected('Corporate Batch')).toBe(true);
    expect(isSelected('Regular')).toBe(true);
    expect(screen.getByText('Upcoming Sessions')).toBeInTheDocument();
  });
});
