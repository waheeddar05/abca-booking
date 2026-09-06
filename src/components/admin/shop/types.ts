import type {
  MarketplaceConfig,
  MarketplaceInterestView,
  MarketplaceProductAdminView,
} from '@/lib/marketplace';

/** `GET /api/admin/shop/products` */
export interface AdminProductsResponse {
  products: MarketplaceProductAdminView[];
  config: MarketplaceConfig;
  /** WhatsApp digits the shop's buttons resolve to, or null. */
  enquiryPhone: string | null;
  center: { id: string; name: string; slug: string };
  /** Center-wide counts — they ignore the list's filters. */
  totals: { active: number; inactive: number };
}

/** `GET /api/admin/shop/settings` */
export interface ShopSettingsResponse {
  config: MarketplaceConfig;
  /** Resolved WhatsApp digits (typed number → center contact), or null. */
  enquiryPhone: string | null;
  /** The center-contact digits the shop falls back to when the typed number is blank. */
  fallbackEnquiryPhone: string | null;
  centerContactPhone: string | null;
}

/** `PUT /api/admin/shop/settings` */
export interface ShopSettingsSaveResponse {
  config: MarketplaceConfig;
  enquiryPhone: string | null;
}

/** `GET /api/admin/shop/products/[id]` */
export interface ProductDetailResponse {
  product: MarketplaceProductAdminView;
  interests: MarketplaceInterestView[];
}

/** The list's status filter — `active` is "published", `inactive` is "hidden". */
export type ProductStatusFilter = 'all' | 'active' | 'inactive';
