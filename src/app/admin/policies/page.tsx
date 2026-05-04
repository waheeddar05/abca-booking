import { redirect } from 'next/navigation';

/**
 * /admin/policies has been folded into /admin/configuration. The raw
 * key/value editor it provided was confusing and overlapped with the
 * structured forms now living on Settings. Per-center overrides for
 * advanced keys still live under Admin → Centers → [center] → Policies.
 *
 * This is a server-side redirect so existing deep links don't 404.
 */
export default function PoliciesRedirectPage() {
  redirect('/admin/configuration');
}
