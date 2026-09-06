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
  /** Store-wide counts — they ignore the list's filters. */
  totals: { active: number; inactive: number };
}

/** `GET /api/admin/shop/settings` */
export interface ShopSettingsResponse {
  config: MarketplaceConfig;
  /** The configured number as WhatsApp digits, or null when none is set. */
  enquiryPhone: string | null;
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
