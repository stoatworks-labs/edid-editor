import type { Connector, Device } from './types.ts'

/**
 * Per-model input capability for the processors this fleet meets.
 *
 * RULES FOR EDITING, and they are not negotiable:
 *
 *  1. Every `documented` device carries at least one citation, and the citation
 *     says what was actually read — not "vendor website".
 *  2. A number the vendor does not state is `inferred` at best. Inferring
 *     "HDMI 2.0 therefore 600 MHz" is fair; inventing a custom-format ceiling
 *     is not.
 *  3. When a vendor quotes a format ("4K60 8-bit 4:4:4") rather than a clock,
 *     the clock recorded here is the CTA-861 clock for that format, and the
 *     note says so. Do not silently upgrade it to a round number.
 *  4. Nothing here has been checked against the hardware. Every entry is
 *     paperwork. The UI says this; do not remove that.
 *
 * Common connector shapes, so a per-device typo can't diverge from the standard.
 */

const HDMI_14 = (count: number): Connector => ({
  kind: 'hdmi',
  label: 'HDMI 1.4',
  count,
  maxPixelClockHz: 340e6,
  maxBpc: 12,
  formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
  hdcp: ['1.4'],
  dsc: false,
  vrr: false,
})

const HDMI_20 = (count: number, maxHz = 600e6, maxBpc: 8 | 10 | 12 = 12): Connector => ({
  kind: 'hdmi',
  label: 'HDMI 2.0',
  count,
  maxPixelClockHz: maxHz,
  maxBpc,
  formats: ['rgb444', 'ycbcr444', 'ycbcr422', 'ycbcr420'],
  hdcp: ['1.4', '2.2'],
  dsc: false,
  vrr: false,
})

const DP_12 = (count: number, maxHz = 600e6, maxBpc: 8 | 10 | 12 = 10): Connector => ({
  kind: 'displayport',
  label: 'DisplayPort 1.2',
  count,
  maxPixelClockHz: maxHz,
  dpLaneBps: 5.4e9,
  dpLanes: 4,
  maxBpc,
  formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
  hdcp: ['1.3'],
  dsc: false,
  vrr: false,
})

const DP_14 = (count: number, maxHz = 1200e6): Connector => ({
  kind: 'displayport',
  label: 'DisplayPort 1.4',
  count,
  maxPixelClockHz: maxHz,
  dpLaneBps: 8.1e9,
  dpLanes: 4,
  maxBpc: 10,
  formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
  hdcp: ['1.3', '2.2'],
  dsc: false,
  vrr: false,
})

const AW = 'Analog Way'
const BARCO = 'Barco'

export const DEVICES: Device[] = [
  // ------------------------------------------------------------- Analog Way

  {
    id: 'aw-livecore-ascender',
    vendor: AW,
    family: 'LiveCore',
    model: 'Ascender 16 / 32 / 48',
    role: 'sink',
    standards: ['gtf', 'cvt', 'dmt', 'manual'],
    capacityModes: [
      {
        id: 'single',
        label: 'Single-link',
        connectors: [
          {
            kind: 'dvi',
            label: 'Single-link DVI-I',
            count: 1,
            maxPixelClockHz: 165e6,
            maxBpc: 8,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
            hdcp: ['1.4'],
            dsc: false,
            vrr: false,
          },
          {
            kind: 'hdmi',
            label: 'HDMI (single-link)',
            count: 1,
            // NOT the 340 MHz HDMI 1.4 allows: the LiveCore platform caps every
            // single-link plug at 165 MHz, HDMI included. Using the spec limit
            // here makes the tool claim a NeXtage takes 2560x1600, which it
            // does not.
            maxPixelClockHz: 165e6,
            maxBpc: 8,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
            hdcp: ['1.4'],
            dsc: false,
            vrr: false,
          },
          {
            kind: 'displayport',
            label: 'DisplayPort 1.1a (4-lane)',
            count: 1,
            maxPixelClockHz: 165e6,
            dpLaneBps: 2.7e9,
            dpLanes: 4,
            maxBpc: 8,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
            hdcp: ['1.3'],
            dsc: false,
            vrr: false,
          },
        ],
      },
      {
        id: 'dual',
        label: 'Dual-link',
        tradeoff:
          'Available only on inputs #2, #4, #6, #8, #10 and #12, and it DISABLES the neighbouring input (#1 with #2, #5 with #6, #9 with #10) — the unit needs both to carry the link.',
        connectors: [
          {
            kind: 'dvi',
            label: 'Dual-link DVI-D',
            count: 1,
            maxPixelClockHz: 330e6,
            maxBpc: 8,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
            hdcp: ['1.4'],
            dsc: false,
            vrr: false,
          },
        ],
      },
    ],
    notes: [
      'The 165 MHz single-link ceiling is exactly 1600x1200 @60 — the manual names that mode as the limit case.',
      'Inputs accept GTF 1.1, CVT 1.1 and DMT 1.0 rev 12; anything else has to go in as a custom format.',
      '4:2:0 is an OUTPUT-only format on this platform. A 4:2:0 EDID will not buy you a 4K60 input here.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          '"The maximum pixel clock frequency is 165 MHz. This corresponds to 1600x1200 @ 60 Hz, for single link. For dual and 4K resolutions, the maximum pixel clock frequency is 330 MHz."',
        source: 'LiveCore Unit User Manual (UK), §4.5.3 Computer formats',
        read: '2026-08-20',
      },
      {
        claim:
          'Plug types: 4-lane DisplayPort 1.1a, HDMI, single DVI-I / dual-link DVI-D, 3G/HD/SD-SDI, universal analog. Dual-link selectable on inputs #2/#4/#6/#8/#10/#12 and disables the paired input.',
        source: 'LiveCore Unit User Manual (UK), §4.6 Input specifications and the Dual-Link section',
        read: '2026-08-20',
      },
      {
        claim: 'Inputs support GTF v1.1, CVT v1.1 and DMT v1.0 rev 12.',
        source: 'LiveCore Unit User Manual (UK), §4.5.4 Input Computer formats',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'aw-livecore-nextage',
    vendor: AW,
    family: 'LiveCore',
    model: 'NeXtage 8 / 16',
    role: 'sink',
    standards: ['gtf', 'cvt', 'dmt', 'manual'],
    capacityModes: [],
    inheritsFrom: 'aw-livecore-ascender',
    notes: ['Same input architecture and the same 165/330 MHz ceilings as the Ascender — one shared LiveCore platform.'],
    confidence: 'documented',
    citations: [
      {
        claim: 'The LiveCore manual covers Ascender 16/32/48, NeXtage 8/16 and SmartMatriX Ultra as one platform.',
        source: 'LiveCore Unit User Manual (UK), title page and §4.6',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'aw-livecore-smartmatrix',
    vendor: AW,
    family: 'LiveCore',
    model: 'SmartMatriX Ultra',
    role: 'sink',
    standards: ['gtf', 'cvt', 'dmt', 'manual'],
    capacityModes: [],
    inheritsFrom: 'aw-livecore-ascender',
    notes: ['Same LiveCore input platform: 165 MHz single-link, 330 MHz dual-link.'],
    confidence: 'documented',
    citations: [
      {
        claim: 'Covered by the same LiveCore unit manual and the same input specification section.',
        source: 'LiveCore Unit User Manual (UK), §4.6',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'aw-livepremier-aquilon',
    vendor: AW,
    family: 'LivePremier',
    model: 'Aquilon RS / C (HDMI 2.0 input card)',
    role: 'sink',
    maxRefreshHz: 144,
    // "4K" read as up to DCI 4096 × 2160, which is inferred; the page says 4K.
    namedFormats: [
      { width: 4096, height: 2160, label: '4K60' },
      { width: 8192, height: 1080, label: 'custom formats such as 8192 × 1080 @ 60' },
    ],
    capacityModes: [
      {
        id: 'hdmi20',
        label: '4x HDMI 2.0',
        connectors: [HDMI_20(4, 600e6, 12)],
      },
    ],
    notes: [
      'Each port takes 4K60 8-bit 4:4:4, or 4K60 12-bit 4:2:2, or 4K30 12-bit 4:4:4 — three different ways to spend the same 18 Gbps.',
      'High frame rate to 144 Hz, and custom extra-wide formats such as 8192x1080 @60 are explicitly supported.',
      'HDR10 and HLG; HDCP 1.4 and 2.2; up to 8 channels of embedded PCM per input.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'Each port supports "formats up to 4K60 8 bits 4:4:4 or 4K60 12 bits 4:2:2 or 4K30 12 bits 4:4:4"; HFR to 144 Hz; custom formats such as 8192x1080@60; HDCP 1.4 and 2.2.',
        source: 'Analog Way — Four HDMI 2.0 input card for Aquilon series (ACC-AQL-IN-HDMI) product page',
        url: 'https://www.analogway.com/products/four-hdmi-2-0-input-card-for-livepremier-tm-series',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'aw-livepremier-aquilon-dp',
    vendor: AW,
    family: 'LivePremier',
    model: 'Aquilon RS / C (DisplayPort input card)',
    role: 'sink',
    maxRefreshHz: 144,
    // As above, "4K" read as up to 4096 × 2160 (inferred). 5K is the DP 1.4 mode's.
    namedFormats: [
      { width: 4096, height: 2160, label: '4K60' },
      { width: 5120, height: 2880, label: '5K60 in DP 1.4 mode' },
      { width: 8192, height: 1080, label: 'custom formats to 8192 × 1080 @ 60' },
    ],
    capacityModes: [
      {
        id: 'dp12x4',
        label: '4x DisplayPort 1.2',
        connectors: [DP_12(4, 600e6, 10)],
      },
      {
        id: 'dp14x2',
        label: '2x DisplayPort 1.4',
        tradeoff:
          'PORTS 2 AND 4 ARE PREEMPTED. Selecting DP 1.4 leaves you ports 1 and 3 only — ' +
          'the card borrows its neighbour\'s lanes to build each 1.4 link. Patch accordingly: ' +
          'a cable already in port 2 or 4 goes dark the moment the mode is applied.',
        connectors: [DP_14(2, 1200e6)],
      },
    ],
    notes: [
      'This is the clearest capacity trade in the fleet: the same card is four DP 1.2 ports or two DP 1.4 ports.',
      'DP 1.2 mode reaches 4K60 10-bit 4:4:4. DP 1.4 mode reaches 5K60 8-bit 4:4:4, or 3840x2160 RB at 120 Hz.',
      'The 120 Hz figure is quoted for REDUCED BLANKING specifically — a standard-blanking 2160p120 needs more clock than the card is rated for.',
      'Switching to DP 1.4 preempts ports 2 and 4; only ports 1 and 3 remain live. Analog Way documents the 4-to-2 port drop but not WHICH two survive.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'Four DP 1.2 input ports, of which two are configurable as DP 1.4. DP 1.4 mode: up to 5K60p 8-bit 4:4:4, or up to 3840x2160RB 120 Hz 8-bit 4:4:4, up to 34.2 Gbps. DP 1.2 mode: up to 4K60 10-bit 4:4:4, custom formats to 8192x1080@60. HDCP 1.4 and 2.2.',
        source: 'Analog Way — DisplayPort 1.2 / 1.4 input card for Aquilon series product page',
        url: 'https://www.analogway.com/products/four-displayport-1-2-input-card-for-livepremier-tm-series',
        read: '2026-08-20',
      },
      {
        claim:
          'Enabling DP 1.4 preempts ports 2 and 4, leaving ports 1 and 3 usable. Operator report, not vendor documentation — the vendor states the port count drops from four to two but not which two.',
        source: 'Allan Sargeant, field knowledge',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'aw-midra4k',
    vendor: AW,
    family: 'Midra 4K',
    model: 'Eikos 4K / QuickMatriX 4K / QuickVu 4K / Pulse 4K',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [HDMI_20(4, 600e6, 10), DP_12(2, 600e6, 10)],
      },
    ],
    notes: [
      'Ten inputs: eight 4K60 (four HDMI 2.0, two 12G-SDI, two DP 1.2) plus two 1080p inputs on selectable HDMI/SDI.',
      '4K60 10-bit 4:4:4 processing throughout, HDR, HDCP 2.2.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'Ten inputs including eight 4K60 inputs (four HDMI 2.0, two 12G-SDI and two DisplayPort 1.2) and two 1080p inputs with user-selectable HDMI and SDI connectors; 4K60 10-bit 4:4:4 processing; HDCP 2.2.',
        source: 'Analog Way — Midra 4K series announcement and product pages',
        url: 'https://www.analogway.com/midra-4k-presentation-switchers',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'aw-midra-legacy',
    vendor: AW,
    family: 'Midra (previous generation)',
    model: 'Pulse2 / Eikos2 / Saphyr / SmartMatriX2 / QuickMatriX / QuickVu',
    role: 'sink',
    standards: ['gtf', 'cvt', 'dmt', 'manual'],
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [
          {
            kind: 'hdmi',
            label: 'HDMI (single-link, DVI-D compatible)',
            count: 2,
            maxPixelClockHz: 165e6,
            maxBpc: 8,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
            hdcp: ['1.4'],
            dsc: false,
            vrr: false,
          },
        ],
      },
    ],
    notes: [
      'Single-link only: 165 MHz, which the manual states as 1920x1200 @60.',
      '8-bit 4:4:4 or 4:2:2 — this generation has no deep colour path and no 4K input at all.',
      'HDMI extras (Ethernet channel, ARC, 3D, 4K, deep colour) are explicitly NOT processed.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim: '"The maximum pixel clock frequency is 165 MHz. Supported formats include 1920x1200 @ 60hz"',
        source: 'Pulse2 User Manual, computer formats section',
        read: '2026-08-20',
      },
      {
        claim:
          'HDMI inputs accept RGB or YUV, 8 bits, 4:4:4 or 4:2:2. Inputs support GTF v1.1, CVT v1.1 and DMT v1.0 rev 12. HDMI Ethernet Channel, ARC, 3D, 4K, Content Type and Deep Color are not processed.',
        source: 'Pulse2 User Manual, input specifications and the HDMI warning note',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'aw-alta4k',
    vendor: AW,
    family: 'Alta 4K',
    model: 'Zenith 100 / Zenith 200 (Alta 4K series)',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [HDMI_20(8, 600e6, 12), DP_12(4, 600e6, 12)],
      },
    ],
    notes: [
      'Sixteen inputs: fourteen at 4K60 (eight HDMI 2.0, four DP 1.2, two 12G-SDI) plus two 1080p on selectable HDMI/SDI.',
      'HDMI ports take 4K60 8-bit 4:4:4 or 4K60 12-bit 4:2:2; DP ports take 4K60 10-bit 4:4:4 or 4K60 12-bit 4:2:2.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'Up to sixteen inputs including fourteen 4K60 inputs (eight HDMI 2.0, four DisplayPort 1.2, two 12G-SDI) and two 1080p inputs. HDMI: up to 4K60 8-bit 4:4:4 or 4K60 12-bit 4:2:2. DisplayPort: up to 4K60 10-bit 4:4:4 or 4K60 12-bit 4:2:2. HDCP 2.2.',
        source: 'Analog Way — Alta 4K presentation switchers product pages',
        url: 'https://www.analogway.com/alta-4k-presentation-switchers',
        read: '2026-08-20',
      },
    ],
  },

  // ------------------------------------------------------------------ Barco

  {
    id: 'barco-e2-gen1',
    vendor: BARCO,
    family: 'Event Master',
    model: 'E2 / S3 (Gen 1 DP-HDMI input card)',
    role: 'sink',
    capacityModes: [
      {
        id: 'four-1200p',
        label: '4x 1200p60',
        connectors: [
          HDMI_14(2),
          {
            kind: 'displayport',
            label: 'DisplayPort 1.1',
            count: 2,
            maxPixelClockHz: 300e6,
            dpLaneBps: 2.7e9,
            dpLanes: 4,
            maxBpc: 12,
            formats: ['rgb444', 'ycbcr444'],
            hdcp: ['1.3'],
            dsc: false,
            vrr: false,
          },
        ],
      },
      {
        id: 'two-4k30',
        label: '2x 4K/UHD @30',
        tradeoff: 'Two inputs instead of four.',
        connectors: [
          {
            kind: 'displayport',
            label: 'DisplayPort 1.1',
            count: 2,
            maxPixelClockHz: 300e6,
            dpLaneBps: 2.7e9,
            dpLanes: 4,
            maxBpc: 12,
            formats: ['rgb444', 'ycbcr444'],
            hdcp: ['1.3'],
            dsc: false,
            vrr: false,
          },
        ],
      },
      {
        id: 'one-4k60-dual-cable',
        label: '1x 4K60 — DUAL CABLE',
        tradeoff:
          'Consumes the whole card, and the source must split the image across two cables. A single-cable 4K60 EDID will not work here at all.',
        connectors: [
          {
            kind: 'displayport',
            label: 'DisplayPort 1.1 x2 (dual cable)',
            count: 1,
            maxPixelClockHz: 600e6,
            dpLaneBps: 2.7e9,
            dpLanes: 8,
            maxBpc: 12,
            formats: ['rgb444', 'ycbcr444'],
            hdcp: ['1.3'],
            dsc: false,
            vrr: false,
          },
        ],
      },
    ],
    notes: [
      'Gen 1 predates HDMI 2.0 entirely: 4K60 exists here only as two cables carrying half the picture each.',
      'The HDMI ports are 1.4 at 297 Mpix/s; the DisplayPort ports are 1.1 at 300 Mpix/s. Dual-link DVI on the tri-combo card reaches 330 Mpix/s.',
      'RGB or YCbCr 4:4:4, 12-bit.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'DP/HDMI input card (Gen 1): DisplayPort 1.1 up to 300 Mpix/s, HDMI 1.4 up to 297 Mpix/s; "up to 4x 1200p@60, or 1x 4K@60p/UHD per card (dual cable)"; RGB or YCbCr 4:4:4 12-bit; HDCP 1.3 (DP) and 1.4 (HDMI).',
        source: 'Barco Event Master E2 Series User Manual, specifications of the DP/HDMI input card (Gen 1)',
        url: 'https://www.manualslib.com/manual/1822386/Barco-Event-Master-E2-Series.html?page=546',
        read: '2026-08-20',
      },
      {
        claim: 'Dual-link DVI supports 330 Mpix/sec on the tri-combo input card.',
        source: 'Barco E2 Tri-combo spec sheet',
        url: 'https://assets.barco.com/m/3d46b7fb2bf0dda9/original/E2-Tri-combo-en-Spec-sheet.pdf',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'barco-e2-gen2',
    vendor: BARCO,
    family: 'Event Master',
    model: 'E2 Gen 2 (HDMI 2.0 quad input card)',
    role: 'sink',
    capacityModes: [
      {
        id: 'four-wqxga',
        label: '4x WQXGA @60 (HDMI 1.4a)',
        connectors: [HDMI_14(4)],
      },
      {
        id: 'two-uhd60',
        label: '2x UHD @60 (HDMI 2.0) — dual capacity slot',
        tradeoff: 'The card occupies a dual-capacity input slot; two inputs instead of four.',
        connectors: [HDMI_20(2, 600e6, 10)],
      },
    ],
    notes: [
      'Single-cable 4K60 at last: 600 Mpix/s, UHD60 8-bit 4:4:4 or UHD60 10-bit 4:2:2.',
      'The chassis carries 12x HDMI 2.0 and 12x DisplayPort 1.2, both rated 600 MHz max, for up to 16 4K inputs.',
      'HDCP 2.2 end to end when the whole chain is 2.2, backwards compatible with 1.x.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'HDMI 2.0 quad input card (Gen 2): up to 600 Mpix/s; "2x UHD@60p (HDMI 2.0) or 4x WQXGA@60p (HDMI 1.4a) inputs per card"; UHD@60p 8-bit 4:4:4 or UHD@60p 10-bit 4:2:2; dual capacity input slot; HDCP 2.2 backwards compatible with 1.x.',
        source: 'Barco Event Master E2 Series User Manual, specifications of the HDMI 2.0 quad input card (Gen 2)',
        url: 'https://www.manualslib.com/manual/1822386/Barco-Event-Master-E2-Series.html?page=546',
        read: '2026-08-20',
      },
      {
        claim:
          'E2 Gen 2: up to 16x 4K inputs, each input card supports up to 2x 4K@60p; 12x HDMI 2.0 (600 MHz max); 12x DisplayPort 1.2 (600 MHz max).',
        source: 'Barco E2 Gen 2 spec sheet',
        url: 'https://assets.barco.com/m/1da1a218bfbbede6/original/E2-Gen-2-en-Spec-sheet.pdf',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'barco-s3-4k',
    vendor: BARCO,
    family: 'Event Master',
    model: 'S3-4K',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard (Gen 2 cards)',
        connectors: [HDMI_20(4, 600e6, 10), DP_12(4, 660e6, 10)],
      },
    ],
    notes: ['HDMI 2.0 rated 600 MHz max; DisplayPort 1.2 rated 660 MHz max — the DP ports are the higher-clocked pair.'],
    confidence: 'documented',
    citations: [
      {
        claim: 'S3-4K: HDMI 2.0 (4 to 96, 600 MHz max) and DisplayPort 1.2 (4 to 96, 660 MHz max) inputs.',
        source: 'Barco S3-4K spec sheet',
        url: 'https://assets.barco.com/m/663dfa0f62601d99/original/S3-4K-en-Spec-sheet.pdf',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'barco-ex',
    vendor: BARCO,
    family: 'Event Master',
    model: 'EX expansion chassis',
    role: 'sink',
    capacityModes: [],
    notes: [
      'An expansion chassis: it takes the same Event Master input cards, so its capability is whichever card is fitted — check the E2 Gen 1 or Gen 2 row instead.',
      'E2 Gen 2 links to up to 8 EX chassis, or 2 S3-4K, or 1 S3-4K plus 4 EX.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim: 'Expansion via simple linking to: 2 S3-4K or 8 EX chassis, or 1 S3-4K plus 4 EX. HDCP compliance determined by installed cards.',
        source: 'Barco E2 Gen 2 spec sheet',
        url: 'https://assets.barco.com/m/1da1a218bfbbede6/original/E2-Gen-2-en-Spec-sheet.pdf',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'barco-encore3',
    vendor: BARCO,
    family: 'Encore3',
    model: 'Encore3 (E3)',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard (Event Master Gen 2 cards)',
        connectors: [HDMI_20(9, 600e6, 12), DP_12(5, 600e6, 12)],
      },
    ],
    notes: [
      'Named "E3" in the field, but it is Encore3 — NOT an Event Master E-series box, and it is not the same platform as E2.',
      'Up to 7 input card slots, each up to 4x 4K@60p, for 16x 4K60 inputs; up to 9x HDMI 2.0 and 5x DP 1.2, both to 4096x2160 @60.',
      '12-bit 4:4:4 processing with 8x 4K60 program outputs.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'Up to 7 input capable card slots to occupy with Event Master Gen2 cards, each input card supports up to 4x 4K @60p inputs; 16x 4K@60p inputs; up to 9x HDMI 2.0 (up to 4096x2160 @60Hz); up to 5x DisplayPort 1.2 (up to 4096x2160 @60Hz). HDCP compliance determined by installed cards.',
        source: 'Barco ENCORE3 spec sheet',
        url: 'https://assets.barco.com/m/3dde766e9029e7f4/original/ENCORE3-en-Spec-sheet.pdf',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'barco-pds-4k',
    vendor: BARCO,
    family: 'PDS',
    model: 'PDS-4K',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [HDMI_20(6, 600e6, 10)],
      },
      {
        id: 'with-dp-card',
        label: 'With audio + DisplayPort option card',
        tradeoff: 'Requires the optional expansion card in the option slot.',
        connectors: [HDMI_20(6, 600e6, 10), DP_12(2, 600e6, 10)],
      },
    ],
    notes: [
      'Six HDMI 2.0 inputs as standard; the option card adds two DisplayPort 1.2 inputs plus embedded audio pass-through.',
      'Outputs are 2x 4K60 or 4x 4K30 — worth knowing, because a PDS-4K cannot pass a 4K60 EDID straight through to four screens.',
      'HDCP 1.x and 2.2.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'Video inputs: 6x HDMI 2.0 connectors. Video outputs: 4x HDMI 2.0 connectors. 2x outputs up to 4K60 or 4x outputs up to 4K30. HDCP 1.x and 2.2. Option Card slot supports additional video input connectors, embedded audio processing and Dante audio.',
        source: 'Barco PDS-4K spec sheet',
        url: 'https://assets.barco.com/m/28436bd46ae91eed/original/PDS-4K-en-Spec-sheet.pdf',
        read: '2026-08-20',
      },
      {
        claim: 'The optional audio and DisplayPort 1.2 input card adds two DisplayPort 1.2 inputs.',
        source: 'Barco — PDS-4K Audio and DisplayPort 1.2 input card product page',
        url: 'https://www.barco.com/en/product/pds4k-audio-dp12-input-card',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'barco-pds-902',
    vendor: BARCO,
    family: 'PDS',
    model: 'PDS-902 3G',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [
          {
            kind: 'dvi',
            label: 'Single-link DVI-I',
            count: 4,
            maxPixelClockHz: 165e6,
            maxBpc: 8,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422'],
            hdcp: ['1.4'],
            dsc: false,
            vrr: false,
          },
        ],
      },
    ],
    notes: [
      'An HD-era switcher: single-link only, no 4K path of any kind.',
      'NOT VERIFIED against a Barco document in this pass — the 165 MHz single-link figure is the DVI standard limit, not a quoted PDS-902 number. Treat this row as a placeholder and check the manual before relying on it.',
    ],
    confidence: 'unverified',
    citations: [],
  },

  // -------------------------------------------------------------- PixelHue

  {
    id: 'pixelhue-p20',
    vendor: 'PixelHue',
    family: 'P Series',
    model: 'P20',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [HDMI_20(8, 600e6, 10), DP_12(8, 600e6, 10)],
      },
    ],
    notes: [
      'Eight combo connectors that are each DP 1.2 OR HDMI 2.0 — the count above is the total per type, not 16 ports.',
      'Plus 4x 12G-SDI in. 4:4:4 10-bit processing, HDR10/HLG/SDR conversion.',
      'Switcher mode gives 2x 4K60 out; PGM-only mode reaches 8Kx4K@60.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim: 'P20: 8 x DP 1.2 / HDMI 2.0 + 4 x 12G-SDI inputs, 8 x HDMI 2.0 outputs. True 4:4:4 10-bit processing, HDR10/HLG/SDR. Switcher mode up to two 4Kx2K@60Hz outputs; PGM-only mode up to 8Kx4K@60Hz.',
        source: 'PixelHue P20 product listings and PixelHue P Series product page',
        url: 'https://www.pixelhue.com/index.php/content/products_detail/catid/64/id/20.html',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'pixelhue-p10',
    vendor: 'PixelHue',
    family: 'P Series',
    model: 'P10',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [HDMI_20(4, 600e6, 10), DP_12(4, 600e6, 10)],
      },
    ],
    notes: [
      'The P20’s smaller sibling: one 4Kx2K@60 output in switcher mode, 8Kx2K@60 in PGM-only.',
      'Port count here is INFERRED as half the P20’s, not read from a PixelHue document. Check before relying on it.',
    ],
    confidence: 'inferred',
    citations: [
      {
        claim: 'P10 and P20 are one series supporting HDMI 2.0, DP 1.2 and 12G-SDI; P10 gives one 4Kx2K@60 output in switcher mode and 8Kx2K@60 in PGM-only mode.',
        source: 'PixelHue P Series product page',
        url: 'https://www.pixelhue.com/index.php/content/products_detail/catid/64/id/20.html',
        read: '2026-08-20',
      },
    ],
  },

  // ------------------------------------------------- LED processors / servers

  {
    id: 'brompton-sx40',
    vendor: 'Brompton',
    family: 'Tessera',
    model: 'SX40',
    role: 'sink',
    minRefreshHz: 23.976,
    maxRefreshHz: 250,
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [
          {
            kind: 'hdmi',
            label: 'HDMI 2.0',
            count: 1,
            maxPixelClockHz: 600e6,
            maxBpc: 12,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422', 'ycbcr420'],
            hdcp: ['1.4', '2.2'],
            dsc: false,
            vrr: false,
          },
        ],
      },
    ],
    notes: [
      'The widest frame-rate window of anything here: 23.976 Hz to 250 Hz on HDMI, which is the point of it for LED volumes.',
      'Custom resolutions up to 4K DCI, 18 Gbps, 600 MHz maximum pixel clock.',
      '8, 10 or 12-bit; RGB, YCbCr 4:2:0, 4:2:2 and 4:4:4.',
      'DVI-D and DisplayPort sources need a passive/active adaptor — there is no native DP connector.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          'HDMI 2.0 "up to 4k DCI with customised resolutions at frame rates from 23.976Hz to 250Hz" with "18Gbps bandwidth to a maximum pixel clock of 600MHz"; 8, 10 or 12-bit in RGB, YCbCr 4:2:0, 4:2:2 and 4:4:4; DVI-D and DisplayPort accepted via adaptor.',
        source: 'Brompton Technology — Tessera User Manual, "4K Sources (for SX40 and S8)"',
        url: 'https://www.bromptontech.com/online-help/Content/Tessera%20User%20Manual/03.%20Feature%20Topics/09.3%20-%204K%20Sources.htm',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'novastar-mx40pro',
    vendor: 'NovaStar',
    family: 'MX Series',
    model: 'MX40 Pro',
    role: 'sink',
    capacityModes: [
      {
        id: 'standard',
        label: 'Standard',
        connectors: [HDMI_20(1, 600e6, 10), DP_12(1, 600e6, 10)],
      },
    ],
    notes: [
      'HDMI 2.0, DP 1.2 and 12G-SDI in; standard resolutions to 3840x2160 @60.',
      'Connector COUNTS here are not from the NovaStar datasheet — only the connector types and the 3840x2160@60 ceiling are. Treat the counts as unverified.',
    ],
    confidence: 'inferred',
    citations: [
      {
        claim: 'MX40 Pro offers HDMI 2.0, DP 1.2 and 12G-SDI video inputs, 20x Ethernet output ports and 4x 10G optical ports; supports standard resolutions up to 3840x2160@60Hz.',
        source: 'NovaStar MX40 Pro LED Display Controller Specifications V1.4.1',
        url: 'https://oss.novastar.tech/uploads/2024/08/MX40-Pro-LED-Display-Controller-Specifications-V1.4.1.pdf',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'novastar-mx2000pro',
    vendor: 'NovaStar',
    family: 'COEX MX Pro',
    model: 'MX2000 Pro',
    role: 'sink',
    minRefreshHz: 23.98,
    maxRefreshHz: 240,
    maxHActive: 8192,
    maxVActive: 8192,
    namedFormats: [
      { width: 4096, height: 2160, label: '4096 × 2160 @ 60 on the 4K cards' },
      { width: 8192, height: 4320, label: 'forced 8192 × 4320 on the 8K cards, 8192 × 1080 @ 60 on the 4K cards' },
      { width: 4320, height: 8192, label: 'forced 4320 × 8192 portrait on the 8K cards, 1080 × 8192 on the 4K cards' },
    ],
    // One mode per input card: the "mode" is which card is in the slot.
    capacityModes: [
      {
        id: 'hdmi20x4',
        label: 'MX_4×HDMI 2.0 input card',
        connectors: [{ ...HDMI_20(4, 600e6, 12), hdcp: ['1.3', '1.4', '2.2', '2.3'] }],
      },
      {
        id: 'dp12x4',
        label: 'MX_4×DP 1.2 input card',
        // No clock ceiling here either: NovaStar list 4096 × 2160 @75 8-bit on
        // this card, about 700 MHz on any reduced blanking. HBR2 is the limit.
        connectors: [{ ...DP_12(4, Number.POSITIVE_INFINITY, 12), hdcp: ['1.3', '1.4', '2.2', '2.3'] }],
      },
      {
        id: 'hdmi21x2',
        label: 'MX_2×HDMI 2.1 input card',
        connectors: [
          {
            kind: 'hdmi',
            label: 'HDMI 2.1',
            count: 2,
            maxPixelClockHz: 600e6,
            frlBps: 48e9,
            maxBpc: 12,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422', 'ycbcr420'],
            hdcp: ['1.3', '1.4', '2.2', '2.3'],
            dsc: false,
            vrr: false,
          },
        ],
      },
      {
        id: 'dp14x2',
        label: 'MX_2×DP 1.4 input card',
        connectors: [
          {
            kind: 'displayport',
            label: 'DisplayPort 1.4',
            count: 2,
            // NovaStar quote no clock ceiling; the HBR3 link budget is the limit.
            maxPixelClockHz: Number.POSITIVE_INFINITY,
            dpLaneBps: 8.1e9,
            dpLanes: 4,
            maxBpc: 12,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422', 'ycbcr420'],
            hdcp: ['1.3', '1.4', '2.2', '2.3'],
            dsc: false,
            vrr: false,
          },
        ],
      },
      {
        id: 'dp14-8k60',
        label: 'MX_1×DP 1.4 (8K@60Hz) input card',
        connectors: [
          {
            kind: 'displayport',
            label: 'DisplayPort 1.4 (8K@60)',
            count: 1,
            maxPixelClockHz: Number.POSITIVE_INFINITY,
            dpLaneBps: 8.1e9,
            dpLanes: 4,
            maxBpc: 12,
            formats: ['rgb444', 'ycbcr444', 'ycbcr422', 'ycbcr420'],
            hdcp: ['1.3', '1.4', '2.2', '2.3'],
            dsc: true,
            vrr: false,
          },
        ],
      },
    ],
    notes: [
      'Card-based: two input slots. Each mode above is a card type, and the verdict names the card the mode needs.',
      '4K cards (4×HDMI 2.0, 4×DP 1.2): 4096×2160 @60, or forced 8192×1080 @60. 8K cards (2×HDMI 2.1, 2×DP 1.4): forced 8192×4320 @30 on HDMI 2.1, 7680×4320 @30 or 8192×4320 @25 on DP 1.4.',
      'The MX_1×DP 1.4 (8K@60Hz) card takes 7680×4320 @60, 12-bit 4:4:4 included, and nothing wider than 7680 (a per-card width this verdict does not check). That cannot fit HBR3 uncompressed, so DSC is INFERRED — NovaStar never say DSC. Their 3840×2160 @240 on it fits only at a DSC target of 11 bpp or less.',
      'HDMI 2.1 FRL rate is INFERRED as 48G: NovaStar list 8192×4320 @30 12-bit 4:4:4 on that card, and nothing slower carries it.',
      'No pixel-clock ceiling on the DP cards is INFERRED from NovaStar stating none: the link budget (HBR2 on DP 1.2, HBR3 on DP 1.4) is the only limit applied. Their own table lists 4096×2160 @75 8-bit on the DP 1.2 card, about 700 MHz.',
      'EDID presets reach only 3840×2160 @60 (7680×4320 @60 on the 8K@60 card); anything bigger is a custom EDID, which NovaStar say the cards accept.',
      'Also 4×12G-SDI and ST 2110 cards, and a 1×DP 1.4 + 1×HDMI 2.1 card with the same per-port limits as the 2-port 8K cards. HDCP 2.3 on every HDMI and DP card. No interlaced input on HDMI or DP.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          '2x input card slots. 4K cards 4×HDMI 2.0, 4×DP 1.2: max 4096×2160@60 or 8192×1080@60 (forced). 2×HDMI 2.1: max 8192×4320@30 (forced). 2×DP 1.4: max 7680×4320@30 (forced), 8192×4320@25. 1×DP 1.4 (8K@60Hz): max 7680×4320@60, max width 7680, 8/10/12-bit 4:4:4 to 60 Hz. Frame rates 23.98 to 240 Hz. HDCP 2.3, backwards compatible with 2.2/1.4/1.3. Video source table gives 12-bit, and 4:2:0 on HDMI 2.0, HDMI 2.1 and DP 1.4; its DP 1.2 rows include 4096×2160 and 3840×2160 @75 8-bit 4:4:4 (forced).',
        source: 'NovaStar — MX2000 Pro LED Display Controller Specifications V1.5.0 (2025-09-30), Input Card and Video Source Specifications',
        url: 'https://oss.novastar.tech/uploads/2025/09/MX2000-Pro-LED-Display-Controller-Specifications-V1.5.0.pdf',
        read: '2026-10-23',
      },
    ],
  },

  {
    id: 'novastar-mx6000pro',
    vendor: 'NovaStar',
    family: 'COEX MX Pro',
    model: 'MX6000 Pro',
    role: 'sink',
    minRefreshHz: 23.98,
    maxRefreshHz: 240,
    maxHActive: 8192,
    maxVActive: 8192,
    namedFormats: [
      { width: 4096, height: 2160, label: '4096 × 2160 @ 60 on the 4K cards' },
      { width: 8192, height: 4320, label: 'forced 8192 × 4320 on the 8K cards, 8192 × 1080 @ 60 on the 4K cards' },
      { width: 4320, height: 8192, label: 'forced 4320 × 8192 portrait on the 8K cards, 1080 × 8192 on the 4K cards' },
    ],
    // Same input cards as the MX2000 Pro, card for card, in a bigger chassis.
    capacityModes: [],
    inheritsFrom: 'novastar-mx2000pro',
    notes: [
      'The MX2000 Pro’s input cards in a 6U chassis with eight input slots: up to 32x 4K@60, 16x 8K@30 or 8x 8K@60 inputs.',
      'Per-port limits, and the inferred DSC, FRL and DP clock figures, are the MX2000 Pro’s. See that entry.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim:
          '8x input card slots taking the same card types as the MX2000 Pro (4×HDMI 2.0, 4×DP 1.2, 4×12G-SDI; 1×DP 1.4 (8K@60Hz), 2×HDMI 2.1, 2×DP 1.4, 1×DP 1.4 + 1×HDMI 2.1; ST 2110), with the same per-card resolution limits; up to 32x 4K@60Hz, 16x 8K@30Hz or 8x 8K@60Hz inputs.',
        source: 'NovaStar — MX6000 Pro LED Display Controller Specifications V1.5.0 (2025-09-30), Features and Input Card',
        url: 'https://oss.novastar.tech/uploads/2025/09/MX6000-Pro-LED-Display-Controller-Specifications-V1.5.0.pdf',
        read: '2026-10-23',
      },
    ],
  },

  {
    id: 'disguise-vx4',
    vendor: 'disguise',
    family: 'vx',
    model: 'vx 4 (HDMI 2.0 VFC output)',
    role: 'source',
    capacityModes: [
      {
        id: 'standard',
        label: 'HDMI 2.0 VFC card',
        connectors: [HDMI_20(4, 600e6, 8)],
      },
    ],
    notes: [
      'A SOURCE, not a sink: the question for a media server is whether it can GENERATE the mode your EDID asks for.',
      'Ships with four HDMI 2.0 VFC output cards supporting up to 4096x2160.',
      'Capture is SDI-based on this machine, so an EDID you build is unlikely to be read by its inputs.',
    ],
    confidence: 'documented',
    citations: [
      {
        claim: 'vx 4 ships standard with four HDMI 2.0 VFC output cards supporting resolutions up to 4096 x 2160; 16x 3G-SDI inputs; 1x DisplayPort 1.2 for GUI.',
        source: 'disguise — VX 4 Specifications, disguise User Guide',
        url: 'https://help.disguise.one/hardware/legacy/vx4/vx4-specs',
        read: '2026-08-20',
      },
    ],
  },

  {
    id: 'greenhippo-boreal',
    vendor: 'Green Hippo',
    family: 'Hippotizer',
    model: 'Boreal+ MK2 (DisplayPort)',
    role: 'source',
    capacityModes: [
      {
        id: 'standard',
        label: 'DisplayPort outputs',
        connectors: [DP_12(2, 600e6, 8)],
      },
    ],
    notes: [
      'A SOURCE: what matters is whether it can drive the mode your EDID advertises.',
      'Boreal+ MK2 DisplayPort: two DisplayPort outputs to a maximum of 3840x2160 @60.',
      'Output COUNT and the DP version are from a reseller listing rather than a Green Hippo datasheet — the 3840x2160@60 ceiling is the sourced part.',
    ],
    confidence: 'inferred',
    citations: [
      {
        claim: 'Boreal+ MK2 DisplayPort has two DisplayPort outputs with a maximum resolution of 3840x2160@60.',
        source: 'Green Hippo Hippotizer V4 manual, Boreal+ MK2 topic',
        url: 'https://www.manula.com/manuals/green-hippo/hippotizer-v4/4.6.4/en/topic/boreal-mk2',
        read: '2026-08-20',
      },
    ],
  },
]

/**
 * Resolve `inheritsFrom` into real modes.
 *
 * Only an explicit pointer counts. A device with no modes and no pointer keeps
 * none, and the evaluator reports 'unknown' for it — which is what an EX
 * chassis deserves, because its answer depends entirely on which generation of
 * card is fitted.
 */
export function resolveModes(d: Device): Device {
  if (d.capacityModes.length > 0 || !d.inheritsFrom) return d
  const donor = DEVICES.find((x) => x.id === d.inheritsFrom)
  return donor ? { ...d, capacityModes: donor.capacityModes } : d
}

export const DEVICE_LIST: Device[] = DEVICES.map(resolveModes)
