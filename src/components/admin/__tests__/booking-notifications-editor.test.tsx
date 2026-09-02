import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

import { BookingNotificationsEditor } from '../BookingNotificationsEditor';
import { BOOKING_NOTIFICATION_POLICY_KEY } from '@/lib/booking-notifications';

const fetchMock = vi.fn();

function policyResponse(rows: Array<{ key: string; value: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => rows,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every POST body sent to the policies API, parsed. */
function postedPolicies(): Array<{ key: string; value: string }> {
  return fetchMock.mock.calls
    .filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')
    .map((c) => JSON.parse((c[1] as { body: string }).body));
}

describe('BookingNotificationsEditor', () => {
  it('renders the stored config, not the shipped defaults', async () => {
    fetchMock.mockResolvedValue(
      policyResponse([
        {
          key: BOOKING_NOTIFICATION_POLICY_KEY,
          value: JSON.stringify({ roles: { ADMIN: true, MODERATOR: false }, whatsapp: false }),
        },
      ]),
    );

    render(<BookingNotificationsEditor scope="center" centerLabel="Toplay" />);

    await waitFor(() => expect(screen.getByText('Center Admin')).toBeInTheDocument());
    // The summary line reflects what was stored: admin on, moderator off,
    // WhatsApp off — the shipped default is the exact opposite.
    expect(screen.getByText(/Center Admin will be notified/)).toBeInTheDocument();
    expect(screen.getByText(/in-app only/)).toBeInTheDocument();
  });

  it('saves what was loaded when the page-level Save fires', async () => {
    fetchMock.mockResolvedValue(
      policyResponse([
        {
          key: BOOKING_NOTIFICATION_POLICY_KEY,
          value: JSON.stringify({ roles: { ADMIN: true, MODERATOR: true, OPERATOR: true } }),
        },
      ]),
    );

    const { rerender } = render(
      <BookingNotificationsEditor scope="center" centerLabel="Toplay" externalSaveTrigger={0} />,
    );
    await waitFor(() => expect(screen.getByText('Center Admin')).toBeInTheDocument());

    await act(async () => {
      rerender(
        <BookingNotificationsEditor scope="center" centerLabel="Toplay" externalSaveTrigger={1} />,
      );
    });

    await waitFor(() => expect(postedPolicies()).toHaveLength(1));
    const saved = JSON.parse(postedPolicies()[0].value);
    expect(saved.roles).toMatchObject({ ADMIN: true, MODERATOR: true, OPERATOR: true });
  });

  it('does NOT overwrite the stored config when the load failed', async () => {
    // The GET fails (transient 500 / "No center selected"). Previously the
    // card fell back to the shipped defaults and the page's single Save
    // button happily POSTed them, silently wiping the center's real
    // subscriptions while the admin was editing an unrelated field.
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });

    const { rerender } = render(
      <BookingNotificationsEditor scope="center" centerLabel="Toplay" externalSaveTrigger={0} />,
    );

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
    // No editable form on a bad baseline.
    expect(screen.queryByText('Center Admin')).not.toBeInTheDocument();
    expect(screen.getByText(/won't be overwritten by Save/)).toBeInTheDocument();

    await act(async () => {
      rerender(
        <BookingNotificationsEditor scope="center" centerLabel="Toplay" externalSaveTrigger={1} />,
      );
    });

    expect(postedPolicies()).toHaveLength(0);
  });

  it('reports the refusal to the parent page so the Save banner shows it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    const onSaveStatus = vi.fn();

    const { rerender } = render(
      <BookingNotificationsEditor
        scope="center"
        centerLabel="Toplay"
        externalSaveTrigger={0}
        onSaveStatus={onSaveStatus}
      />,
    );
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());

    await act(async () => {
      rerender(
        <BookingNotificationsEditor
          scope="center"
          centerLabel="Toplay"
          externalSaveTrigger={1}
          onSaveStatus={onSaveStatus}
        />,
      );
    });

    await waitFor(() =>
      expect(onSaveStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({ ok: false, text: expect.stringContaining('never loaded') }),
        }),
      ),
    );
  });

  it('falls back to the shipped defaults when the center has no stored row', async () => {
    fetchMock.mockResolvedValue(policyResponse([{ key: 'SOMETHING_ELSE', value: 'x' }]));

    render(<BookingNotificationsEditor scope="center" centerLabel="Toplay" />);

    // MODERATOR on by default — the headline requirement, visible in the UI.
    await waitFor(() =>
      expect(screen.getByText(/Center Moderator will be notified/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/new bookings and cancellations/)).toBeInTheDocument();
  });
});
