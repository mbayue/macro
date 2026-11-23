import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchCdp } from './lib/cdp.ts';

const cdp = await launchCdp(9355, 'macro-og-profile');

await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1200,
  height: 630,
  deviceScaleFactor: 1,
  mobile: false,
});

const template = 'scripts/og-template-light.html';
const fileUrl = pathToFileURL(resolve(template)).href;
await cdp.send('Page.navigate', { url: fileUrl });
await Bun.sleep(1200);

const shot = await cdp.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
});
await cdp.close();

const out1 = resolve('web/landing/public/og-image.png');
const out2 = resolve('web/dist/og-image.png');
writeFileSync(out1, Buffer.from(shot.data, 'base64'));
writeFileSync(out2, Buffer.from(shot.data, 'base64'));
console.log('Generated OG image at:', out1);
