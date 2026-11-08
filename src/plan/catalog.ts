/**
 * Route_Catalog: the fixed, built-in list of routes a Test_Plan may use
 * (requirements 14.6, 14.8; design "Route_Catalog").
 */

import type { RouteId } from '../types.ts';

export interface RouteEntry {
  id: RouteId;
  /** Which Target_Allowlist origin the route is requested from. */
  role: 'web' | 'api';
  method: 'GET' | 'POST';
  /** May contain the `{productId}` placeholder (product_detail only). */
  path: string;
  /** Present only for POST routes with a fixed request body template. */
  body?: 'order';
}

/** Order is the tie-break order used wherever routes need a stable ordering. */
export const ROUTE_CATALOG: readonly RouteEntry[] = [
  { id: 'store_home', role: 'web', method: 'GET', path: '/' },
  { id: 'catalog_list', role: 'api', method: 'GET', path: '/api/v1/products' },
  { id: 'product_detail', role: 'api', method: 'GET', path: '/api/v1/products/{productId}' },
  { id: 'ledger', role: 'api', method: 'GET', path: '/api/v1/orders/public?page=1' },
  { id: 'order_create', role: 'api', method: 'POST', path: '/api/v1/orders', body: 'order' },
  { id: 'health', role: 'api', method: 'GET', path: '/api/v1/health' },
];

const ROUTE_IDS: ReadonlySet<string> = new Set(ROUTE_CATALOG.map((r) => r.id));

export function isRouteId(value: unknown): value is RouteId {
  return typeof value === 'string' && ROUTE_IDS.has(value);
}

// TODO(task 3.4): PLACEHOLDER. Replace with the slugs seeded into yue-demo.
// YUE product ids are catalog slugs (like `fgo-1`), never UUIDs.
export const PRODUCT_IDS: readonly string[] = ['uma-1', 'uma-2', 'fgo-1', 'fgo-2', 'fgo-3'];

// TODO(task 3.4): PLACEHOLDER. Must be one of PRODUCT_IDS.
export const ORDER_PRODUCT_ID: string = 'fgo-1';

/** Request body for `order_create`; satisfies YUE's `createOrderSchema`. */
export interface OrderBody {
  productId: string;
  qty: number;
  customer: string;
  gameUid: string;
  contactId: string;
  chatChannel: 'WhatsApp' | 'Messenger' | 'Discord';
  notes: string;
}

/**
 * Fixed `order_create` body. Limits in createOrderSchema: customer <= 100,
 * gameUid <= 500, contactId <= 200, notes <= 1000, qty 1..10,
 * chatChannel in WhatsApp | Messenger | Discord.
 */
export function orderBody(runId: string): OrderBody {
  return {
    productId: ORDER_PRODUCT_ID,
    qty: 1,
    customer: 'Macro Load Test',
    gameUid: 'macro-loadtest-0001',
    contactId: 'macro-loadtest',
    chatChannel: 'Discord',
    notes: `macro run ${runId}`,
  };
}
