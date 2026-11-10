import { describe, expect, test } from 'bun:test';
import template from '../deploy/domainconnect/macro.my.id.verify.json';

describe('Domain Connect Template', () => {
  test('conforms to Domain Connect v2 template specification', () => {
    expect(template.providerId).toBe('macro.my.id');
    expect(template.providerName).toBe('Macro');
    expect(template.serviceId).toBe('verify');
    expect(template.serviceName).toBe('Macro Site Verification');
    expect(template.version).toBe(1);
    expect(template.syncPubKeyDomain).toBe('macro.my.id');
    expect(template.syncRedirectDomain).toBe('macro.my.id');
    expect(Array.isArray(template.records)).toBe(true);
    expect(template.records.length).toBeGreaterThanOrEqual(1);

    const txtRecord = template.records.find((r: { type: string }) => r.type === 'TXT');
    expect(txtRecord).toBeDefined();
    expect(txtRecord?.name).toBe('_macro-verify');
    expect(txtRecord?.data).toBe('%token%');
  });
});
