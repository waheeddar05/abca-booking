/**
 * Legacy operator dashboard route. The unified staff dashboard at
 * /staff handles operator + coach + sidearm specialist in one place,
 * so this page just redirects there. Old PWA installs and bookmarks
 * keep working.
 */

import { redirect } from 'next/navigation';

export default function LegacyOperatorRedirect() {
  redirect('/staff');
}
