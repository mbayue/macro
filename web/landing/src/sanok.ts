/**
 * The four photographs of the Sanok bridge load test (Marsilar, CC BY-SA 4.0, via Wikimedia Commons),
 * shown as the analogy for staged load tests, never as Macro's product or customers. Each one is served
 * at 800, 1280 and 1920 px wide from public/landing/img/sanok/ (resized, otherwise unaltered).
 */
export type SanokName = 'trucks' | 'span' | 'static' | 'workers';

export interface SanokPhoto {
  name: SanokName;
  /** Title on Wikimedia Commons. */
  title: string;
  /** Short name for the credit link in the footer. */
  label: string;
  alt: string;
  /** The photo's Wikimedia Commons source page. */
  source: string;
}

export const SANOK_PHOTOS: readonly SanokPhoto[] = [
  {
    name: 'trucks',
    title: 'Trucks during load testing of the new bridge in Sanok',
    label: 'trucks on the deck',
    alt: 'Loaded test trucks parked nose to tail on the deck of the new cable-stayed bridge in Sanok, above the San river.',
    source: 'https://commons.wikimedia.org/w/index.php?curid=192922595',
  },
  {
    name: 'span',
    title: 'Load testing of the new bridge over San river in Sanok',
    label: 'engineers under the pylon',
    alt: 'Engineers in hard hats on the deck of the Sanok bridge during its load test, below the white pylon, test trucks beside them.',
    source: 'https://commons.wikimedia.org/w/index.php?curid=192922490',
  },
  {
    name: 'static',
    title: 'Static load test of the bridge over San river in Sanok',
    label: 'the static test',
    alt: 'Engineers reading their instruments on the deck of the Sanok bridge during the static load test, a test truck beside them.',
    source: 'https://commons.wikimedia.org/w/index.php?curid=192924850',
  },
  {
    name: 'workers',
    title: 'Workers during the load test of the new bridge in Sanok',
    label: 'workers by the river',
    alt: 'Workers by the riverside railing during the Sanok bridge load test, the deck and its test trucks behind the trees.',
    source: 'https://commons.wikimedia.org/w/index.php?curid=192922542',
  },
];

export const SANOK_AUTHOR = 'Marsilar';
export const SANOK_LICENCE = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } as const;

const WIDTHS = [800, 1280, 1920] as const;

/** Native size of every photo (they are all 3:2). */
export const SANOK_SIZE = { width: 1920, height: 1280 } as const;

export const sanokSrc = (name: SanokName, width: (typeof WIDTHS)[number] = 1280): string =>
  `/landing/img/sanok/${name}-${width}.jpg`;

export const sanokSrcSet = (name: SanokName): string => WIDTHS.map((w) => `${sanokSrc(name, w)} ${w}w`).join(', ');

/** Lossless 8x8 Bayer-dithered WebP plates for the landing page. */
export const sanokDitherSrc = (name: SanokName): string => `/landing/img/dither/sanok-${name}.webp`;

export const DARK_HORIZON_SRC = '/landing/img/dither/dark-horizon.webp';
