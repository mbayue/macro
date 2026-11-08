-- Demo_Target catalog seed for YUE on the `yue-demo` VM (requirements 14.6, 14.8).
--
-- Idempotent: every row is `ON CONFLICT ("id") DO NOTHING`, so re-running changes nothing.
-- Product ids are catalog slugs (`uma-1`, `fgo-1`), never UUIDs. Names and prices are fictional.
-- The `products` table has no stock column, so there is no stock to seed (requirement 14.7: N/A).
--
-- NOTE: YUE's own migration 0002_catalog_seed.sql already inserts uma-1..uma-25 and fgo-1..fgo-10
-- with the same slugs. On a database that ran the migrations this file is a no-op and the existing
-- rows keep their names and prices. It exists so a database without that migration still gets the
-- five slugs that `src/plan/catalog.ts` depends on.
--
-- Run (from /opt/yue on the VM):
--   docker compose exec -T db psql -U yue -d yue_db < seed-products.sql

INSERT INTO "products"
  ("id", "game", "name", "tags", "price_idr", "price_jpy", "stamp", "description", "is_active")
VALUES
  ('uma-1', 'uma', 'Demo Starter Pass',        ARRAY['Pass'],            60000,  500, '札', 'Fictional demo product for load testing.', true),
  ('uma-2', 'uma', 'Demo Premium Pass',        ARRAY['Popular','Pass'], 100000,  800, '月', 'Fictional demo product for load testing.', true),
  ('fgo-1', 'fgo', 'Demo Lucky Bag',           ARRAY['Popular'],        255000, 2100, '福', 'Fictional demo product for load testing.', true),
  ('fgo-2', 'fgo', 'Demo Summon Bundle',       ARRAY['Limited'],        450000, 3700, '召', 'Fictional demo product for load testing.', true),
  ('fgo-3', 'fgo', 'Demo Summon Bundle Plus',  ARRAY['Limited'],        660000, 5400, '極', 'Fictional demo product for load testing.', true)
ON CONFLICT ("id") DO NOTHING;
