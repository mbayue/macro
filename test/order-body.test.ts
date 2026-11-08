import { describe, expect, test } from 'bun:test';
import { ORDER_PRODUCT_ID, orderBody, PRODUCT_IDS } from '../src/plan/catalog.ts';

const RUN_IDS = [
  '00000000-0000-4000-8000-000000000000',
  '3f0c8a52-7d1e-4c36-9b0a-5e2f0d1c7a99',
  'run-1',
  crypto.randomUUID(),
];

describe('order_create body (YUE createOrderSchema)', () => {
  test('has exactly the YUE field set', () => {
    for (const runId of RUN_IDS) {
      expect(Object.keys(orderBody(runId)).sort()).toEqual(
        ['chatChannel', 'contactId', 'customer', 'gameUid', 'notes', 'productId', 'qty'],
      );
    }
  });

  test('customer is "Macro Load Test" and notes contain the run id', () => {
    for (const runId of RUN_IDS) {
      const body = orderBody(runId);
      expect(body.customer).toBe('Macro Load Test');
      expect(body.notes).toContain(runId);
    }
  });

  test('field values satisfy the YUE limits', () => {
    for (const runId of RUN_IDS) {
      const body = orderBody(runId);
      expect(['WhatsApp', 'Messenger', 'Discord']).toContain(body.chatChannel);
      expect(Number.isInteger(body.qty)).toBe(true);
      expect(body.qty).toBeGreaterThanOrEqual(1);
      expect(body.qty).toBeLessThanOrEqual(10);
      expect(body.customer.length).toBeGreaterThan(0);
      expect(body.customer.length).toBeLessThanOrEqual(100);
      expect(body.gameUid.length).toBeGreaterThan(0);
      expect(body.gameUid.length).toBeLessThanOrEqual(500);
      expect(body.contactId.length).toBeGreaterThan(0);
      expect(body.contactId.length).toBeLessThanOrEqual(200);
      expect(body.notes.length).toBeLessThanOrEqual(1000);
    }
  });

  test('the product is the configured order product and is a known catalog slug', () => {
    expect(PRODUCT_IDS).toContain(ORDER_PRODUCT_ID);
    for (const runId of RUN_IDS) expect(orderBody(runId).productId).toBe(ORDER_PRODUCT_ID);
  });

  test('every value is a string except qty, and the body serialises to JSON unchanged', () => {
    const body = orderBody(RUN_IDS[1] as string);
    for (const [key, value] of Object.entries(body)) {
      if (key === 'qty') expect(typeof value).toBe('number');
      else expect(typeof value).toBe('string');
    }
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  test('matches the pinned literal body', () => {
    expect(orderBody('3f0c8a52-7d1e-4c36-9b0a-5e2f0d1c7a99')).toEqual({
      productId: 'fgo-1',
      qty: 1,
      customer: 'Macro Load Test',
      gameUid: 'macro-loadtest-0001',
      contactId: 'macro-loadtest',
      chatChannel: 'Discord',
      notes: 'macro run 3f0c8a52-7d1e-4c36-9b0a-5e2f0d1c7a99',
    });
  });

  test('each call returns a fresh object', () => {
    const a = orderBody(RUN_IDS[0] as string);
    const b = orderBody(RUN_IDS[0] as string);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
