-- Removes every order created by Macro load tests (requirement 14.8).
-- The `order_create` body always uses the customer name `Macro Load Test` (src/plan/catalog.ts).
-- Exact match only: no other customer is touched.
--
-- Run (from /opt/yue on the VM):
--   docker compose exec -T db psql -U yue -d yue_db < cleanup-orders.sql

DELETE FROM "orders" WHERE "customer" = 'Macro Load Test';
