/**
 * Legacy /operator layout. The page-level redirect to /staff fires
 * before this layout's children render, so the chrome here is mostly
 * dead weight — kept as a passthrough so old bookmarks still resolve
 * cleanly during the brief redirect cycle.
 */

export default function LegacyOperatorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
