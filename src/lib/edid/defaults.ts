import type { CtaExtension, Edid } from './types.ts'

/**
 * sRGB / Rec.709 primaries and D65 white.
 *
 * The default because a processor-facing EDID is describing a signal format,
 * not a panel — and 709 is what the signal is. Anyone describing a real display
 * should put that display's measured primaries in.
 */
export const REC709_CHROMATICITY = {
  redX: 0.64,
  redY: 0.33,
  greenX: 0.3,
  greenY: 0.6,
  blueX: 0.15,
  blueY: 0.06,
  whiteX: 0.3127,
  whiteY: 0.329,
}

export function emptyCta(): CtaExtension {
  return {
    kind: 'cta',
    revision: 3,
    underscanIt: true,
    basicAudio: false,
    ycbcr444: true,
    ycbcr422: true,
    videoDescriptors: [],
    audioDescriptors: [],
    ycbcr420OnlyVics: [],
    ycbcr420AlsoVics: [],
    detailedTimings: [],
    unknownBlocks: [],
  }
}

/**
 * A blank EDID 1.4, digital, ready to have timings put in it.
 *
 * 'SWK' is Stoatworks Labs', the same id the mosaic topology uses, and is not a
 * registered PNP ID (not in hwdata's copy of the registry, checked 2026-10-24):
 * this tool must not stamp somebody else's registered manufacturer code onto a
 * made-up EDID. The UI says so where the field is edited. Until 2026-10-24 it
 * was 'OTR', for the tool's old name, so an EDID built before then says OTR.
 */
export function blankEdid(): Edid {
  return {
    manufacturerId: 'SWK',
    productCode: 0x0001,
    serialNumber: 1,
    week: 1,
    year: new Date().getFullYear(),
    isModelYear: false,
    version: 1,
    revision: 4,
    input: { kind: 'digital', bitDepth: 8, interface: 'hdmi-a' },
    screenWidthCm: 0,
    screenHeightCm: 0,
    gamma: 2.2,
    features: {
      standby: false,
      suspend: false,
      activeOff: true,
      colorEncoding: 'rgb444-ycrcb444-ycrcb422',
      srgbDefault: false,
      preferredTimingIsNative: true,
      continuousFrequency: false,
    },
    chromaticity: { ...REC709_CHROMATICITY },
    established: {},
    standardTimings: [null, null, null, null, null, null, null, null],
    descriptors: [{ kind: 'dummy' }, { kind: 'dummy' }, { kind: 'dummy' }, { kind: 'dummy' }],
    extensions: [],
  }
}
