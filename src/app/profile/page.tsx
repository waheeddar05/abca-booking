'use client';

/**
 * /profile — account details and delivery addresses.
 *
 * The address book exists for the Shop: the default address goes into a
 * WhatsApp order message from a product page (`DeliveryAddressHint` links
 * here). Addresses are global to the account, not center-scoped.
 *
 * Auth is decided the way `/notifications` decides it: `useCurrentUser()`
 * says who is signed in (it sees both the WhatsApp OTP cookie and a
 * legacy NextAuth session — `useSession()` sees only the second, i.e.
 * nobody), and the addresses API then confirms. Every write returns the
 * full refreshed list, which simply replaces the page's state.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { LogIn, MapPin, Plus, UserRound } from 'lucide-react';
import { useCurrentUser } from '@/lib/current-user';
import { MAX_ADDRESSES_PER_USER, formatAddressSummary, type UserAddressView } from '@/lib/addresses';
import { PROFILE_PATH, SHOP_PATH } from '@/lib/marketplace';
import { loginHref } from '@/lib/login-href';
import { PageBackground } from '@/components/ui/PageBackground';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { AccountCard } from '@/components/profile/AccountCard';
import { AddressCard, type AddressPendingAction } from '@/components/profile/AddressCard';
import { AddressFormDialog } from '@/components/profile/AddressFormDialog';
import {
  isSignedOutResponse,
  readApiError,
  toAddressPayload,
} from '@/components/profile/profile-format';

type AddressListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; addresses: UserAddressView[] };

type DialogState = { mode: 'create' } | { mode: 'edit'; address: UserAddressView } | null;

interface PendingMutation {
  id: string;
  action: AddressPendingAction;
}

/** Page chrome shared by every state so the header never jumps. */
function ProfileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <PageBackground />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
          <UserRound className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">My Profile</h1>
          <p className="text-xs text-slate-400">Account details &amp; delivery addresses</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function SignedOutState() {
  return (
    <div className="text-center py-16 bg-white/[0.02] rounded-2xl border border-white/[0.05] animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
        <UserRound className="w-6 h-6 text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-300 mb-1">Please sign in</p>
      <p className="text-xs text-slate-500">Sign in to see your account details and delivery addresses.</p>
      <Link
        href={loginHref(PROFILE_PATH)}
        className="inline-flex items-center gap-2 mt-5 bg-accent hover:bg-accent-light text-primary font-bold rounded-xl px-4 py-2.5 text-sm transition-colors"
      >
        <LogIn className="w-4 h-4" aria-hidden="true" />
        Sign in
      </Link>
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading: userLoading, refresh } = useCurrentUser();
  const toast = useToast();

  const [list, setList] = useState<AddressListState>({ status: 'loading' });
  // The API said "signed out" — possible even with a cached user when the
  // session expired underneath the page.
  const [signedOut, setSignedOut] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<UserAddressView | null>(null);
  const [pending, setPending] = useState<PendingMutation | null>(null);

  const userId = user?.id ?? null;

  const loadAddresses = useCallback(async () => {
    try {
      const res = await fetch('/api/user/addresses');
      if (isSignedOutResponse(res)) {
        setSignedOut(true);
        return;
      }
      if (!res.ok) {
        setList({
          status: 'error',
          message: await readApiError(res, 'Could not load your addresses'),
        });
        return;
      }
      const data = (await res.json()) as { addresses?: UserAddressView[] };
      setList({ status: 'ready', addresses: Array.isArray(data.addresses) ? data.addresses : [] });
    } catch {
      setList({ status: 'error', message: 'Network error. Check your connection and try again.' });
    }
  }, []);

  useEffect(() => {
    if (userLoading || !userId) return;
    void loadAddresses();
  }, [userLoading, userId, loadAddresses]);

  const retry = () => {
    setList({ status: 'loading' });
    void loadAddresses();
  };

  const setDefault = async (address: UserAddressView) => {
    if (pending) return;
    setPending({ id: address.id, action: 'default' });
    try {
      const res = await fetch(`/api/user/addresses/${address.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toAddressPayload(address, true)),
      });
      if (isSignedOutResponse(res)) {
        setSignedOut(true);
        return;
      }
      if (!res.ok) {
        toast.error('Could not change the default', await readApiError(res, 'Please try again.'));
        return;
      }
      const data = (await res.json()) as { addresses: UserAddressView[] };
      setList({ status: 'ready', addresses: data.addresses });
      toast.success('Default address updated', `Orders will ship to ${address.label || address.city}.`);
    } catch {
      toast.error('Network error', 'Check your connection and try again.');
    } finally {
      setPending(null);
    }
  };

  const confirmDelete = async () => {
    const target = deleting;
    if (!target || pending) return;
    setPending({ id: target.id, action: 'delete' });
    try {
      const res = await fetch(`/api/user/addresses/${target.id}`, { method: 'DELETE' });
      if (isSignedOutResponse(res)) {
        setSignedOut(true);
        return;
      }
      if (!res.ok) {
        toast.error('Could not remove the address', await readApiError(res, 'Please try again.'));
        return;
      }
      const data = (await res.json()) as { addresses: UserAddressView[] };
      setList({ status: 'ready', addresses: data.addresses });
      setDeleting(null);
      toast.success('Address removed');
    } catch {
      toast.error('Network error', 'Check your connection and try again.');
    } finally {
      setPending(null);
    }
  };

  if (userLoading) {
    return (
      <ProfileShell>
        <LoadingState message="Loading your profile..." />
      </ProfileShell>
    );
  }

  if (!user || signedOut) {
    return (
      <ProfileShell>
        <SignedOutState />
      </ProfileShell>
    );
  }

  const addresses = list.status === 'ready' ? list.addresses : [];
  const atCap = addresses.length >= MAX_ADDRESSES_PER_USER;
  const canAdd = list.status === 'ready' && !atCap && !pending;
  const openCreate = () => {
    if (canAdd) setDialog({ mode: 'create' });
  };

  const deleteMessage = deleting
    ? `${formatAddressSummary(deleting)}\n\n${
        deleting.isDefault && addresses.length > 1
          ? 'This is your default address — another saved address will become the default.'
          : 'This can’t be undone.'
      }`
    : '';

  return (
    <ProfileShell>
      <AccountCard user={user} onRefresh={refresh} />

      <section className="mt-6" aria-labelledby="addresses-heading">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 id="addresses-heading" className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
              Delivery addresses
              <span className="text-[10px] font-semibold text-slate-400 bg-white/[0.06] border border-white/[0.08] rounded-full px-2 py-0.5 tabular-nums">
                {list.status === 'ready' ? addresses.length : '–'} of {MAX_ADDRESSES_PER_USER}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 leading-snug">
              Used when you order gear from the{' '}
              <Link href={SHOP_PATH} className="text-accent font-medium hover:underline">
                PlayOrbit Shop
              </Link>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            disabled={!canAdd}
            className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent-light text-primary font-bold rounded-xl px-3.5 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add address
          </button>
        </div>

        {atCap && (
          <p className="text-[11px] text-slate-500 mb-3 -mt-1">
            You’ve saved the maximum of {MAX_ADDRESSES_PER_USER} addresses — remove one to add another.
          </p>
        )}

        {list.status === 'loading' ? (
          <LoadingState message="Loading addresses..." size="sm" />
        ) : list.status === 'error' ? (
          <ErrorState message={list.message} onRetry={retry} className="py-10" />
        ) : addresses.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No addresses yet"
            description="Add one so ordering from the shop is one tap"
            action={{ label: 'Add address', onClick: openCreate }}
            className="bg-white/[0.02] rounded-2xl border border-white/[0.05] py-12"
          />
        ) : (
          <div className="space-y-3">
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                pending={pending?.id === address.id ? pending.action : null}
                locked={!!pending}
                onSetDefault={setDefault}
                onEdit={(a) => setDialog({ mode: 'edit', address: a })}
                onDelete={setDeleting}
              />
            ))}
          </div>
        )}
      </section>

      {dialog && (
        <AddressFormDialog
          address={dialog.mode === 'edit' ? dialog.address : null}
          prefill={{ name: user.name, mobile: user.mobileNumber }}
          isFirst={addresses.length === 0}
          onClose={() => setDialog(null)}
          onSignedOut={() => {
            setDialog(null);
            setSignedOut(true);
          }}
          onSaved={({ address, addresses: next }) => {
            setList({ status: 'ready', addresses: next });
            setDialog(null);
            toast.success(
              dialog.mode === 'edit' ? 'Address updated' : 'Address saved',
              formatAddressSummary(address),
            );
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Remove this address?"
        message={deleteMessage}
        confirmLabel="Remove"
        variant="danger"
        loading={pending?.action === 'delete'}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!pending) setDeleting(null);
        }}
      />
    </ProfileShell>
  );
}
