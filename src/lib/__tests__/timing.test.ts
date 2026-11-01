import { describe, expect, it } from 'vitest'
import { cvt, cvtRb, cvtRb2 } from '../timing/cvt.ts'
import { gtf } from '../timing/gtf.ts'
import { DMT_TIMINGS, dmtByCode } from '../timing/dmt.ts'
import { CTA_TIMINGS, ctaByVic, fractionalVariant } from '../timing/cta.ts'
import { frameHeight, frameLines, frameRate, hTotal, timingLabel, vFreq, vTotal } from '../timing/types.ts'

/**
 * The CVT tests check our generator against PUBLISHED DMT entries, which were
 * transcribed independently in dmt.ts. If both were derived from this code the
 * test would prove nothing.
 */
describe('CVT standard blanking', () => {
  it('reproduces DMT 0x45 — 1920x1200 @60', () => {
    const t = cvt(1920, 1200, { refreshHz: 60 })
    const ref = dmtByCode(0x45)!
    expect(t.pixelClockHz).toBe(ref.pixelClockHz)
    expect(hTotal(t)).toBe(hTotal(ref))
    expect(vTotal(t)).toBe(vTotal(ref))
  })

  it('reproduces DMT 0x3A — 1680x1050 @60', () => {
    const t = cvt(1680, 1050, { refreshHz: 60 })
    const ref = dmtByCode(0x3a)!
    expect(t.pixelClockHz).toBe(ref.pixelClockHz)
    expect(hTotal(t)).toBe(2240)
    expect(vTotal(t)).toBe(1089)
  })

  it('reproduces DMT 0x2F — 1440x900 @60', () => {
    const t = cvt(1440, 900, { refreshHz: 60 })
    expect(t.pixelClockHz).toBe(106_500_000)
    expect(hTotal(t)).toBe(1904)
    expect(vTotal(t)).toBe(934)
  })

  it('uses negative hsync and positive vsync', () => {
    const t = cvt(1920, 1200, { refreshHz: 60 })
    expect(t.hSyncPositive).toBe(false)
    expect(t.vSyncPositive).toBe(true)
  })
})

describe('CVT reduced blanking v1', () => {
  it('reproduces DMT 0x44 — 1920x1200 @60 RB', () => {
    const t = cvtRb(1920, 1200, { refreshHz: 60 })
    expect(t.pixelClockHz).toBe(154_000_000)
    expect(hTotal(t)).toBe(2080)
    expect(vTotal(t)).toBe(1235)
  })

  it('reproduces DMT 0x49 — 2560x1600 @60 RB', () => {
    const t = cvtRb(2560, 1600, { refreshHz: 60 })
    expect(t.pixelClockHz).toBe(268_500_000)
    expect(hTotal(t)).toBe(2720)
    expect(vTotal(t)).toBe(1646)
  })

  it('always spends exactly 160 pixels on horizontal blanking', () => {
    for (const w of [1280, 1920, 2560, 3840]) {
      const t = cvtRb(w, 1080, { refreshHz: 60 })
      expect(t.hFront + t.hSync + t.hBack).toBe(160)
    }
  })

  it('inverts both polarities relative to standard CVT — this is how a sink tells them apart', () => {
    const t = cvtRb(1920, 1200, { refreshHz: 60 })
    expect(t.hSyncPositive).toBe(true)
    expect(t.vSyncPositive).toBe(false)
  })
})

describe('CVT reduced blanking v2', () => {
  it('spends 80 pixels on horizontal blanking and 8 lines on vsync', () => {
    const t = cvtRb2(3840, 2160, { refreshHz: 60 })
    expect(t.hFront + t.hSync + t.hBack).toBe(80)
    expect(t.vSync).toBe(8)
  })

  it('lands on the requested rate to better than 0.01 Hz', () => {
    // The point of RBv2's 1 kHz clock step: RBv1 cannot do this.
    for (const rate of [60, 50, 23.976, 29.97, 119.88]) {
      const t = cvtRb2(3840, 2160, { refreshHz: rate })
      expect(Math.abs(vFreq(t) - rate)).toBeLessThan(0.01)
    }
  })

  it('is cheaper than RBv1, which is cheaper than standard CVT', () => {
    const std = cvt(2560, 1440, { refreshHz: 60 }).pixelClockHz
    const rb1 = cvtRb(2560, 1440, { refreshHz: 60 }).pixelClockHz
    const rb2 = cvtRb2(2560, 1440, { refreshHz: 60 }).pixelClockHz
    expect(rb2).toBeLessThan(rb1)
    expect(rb1).toBeLessThan(std)
  })
})

describe('GTF', () => {
  it('produces the classic 1024x768 @60 GTF timing', () => {
    const t = gtf(1024, 768, { refreshHz: 60 })
    expect(hTotal(t)).toBe(1344)
    expect(vTotal(t)).toBe(795)
    expect(t.pixelClockHz / 1e6).toBeCloseTo(64.11, 1)
  })

  it('rounds horizontal blanking to a double cell so the back porch stays cell-aligned', () => {
    const t = gtf(1280, 1024, { refreshHz: 60 })
    const blank = t.hFront + t.hSync + t.hBack
    expect(blank % 16).toBe(0)
    expect(t.hBack % 8).toBe(0)
  })
})

describe('reference tables', () => {
  it('every DMT entry states a self-consistent refresh rate', () => {
    for (const t of DMT_TIMINGS) {
      const rate = vFreq(t)
      // Each entry's name carries its nominal rate; they must agree.
      const nominal = Number(/@(\d+)/.exec(t.name)![1])
      expect(Math.abs(rate - nominal)).toBeLessThan(0.6)
    }
  })

  it('every CTA entry lands exactly on the rate its name gives, or its 1000/1001', () => {
    // A VIC's rate is exact at its own clock: whole, or for VICs 1-3, listed at 25.175
    // and 27 MHz, 60 x 1000/1001 (VIC 1 to within 0.001 Hz). Anything else is a counting
    // error, and the interlaced half line is the one this caught: 1080i60 read 60.053.
    for (const t of CTA_TIMINGS) {
      const nominal = Number(/[ip](\d+) /.exec(t.name)![1])
      const off = Math.min(Math.abs(vFreq(t) - nominal), Math.abs(vFreq(t) - (nominal * 1000) / 1001))
      expect(off, t.name).toBeLessThan(0.001)
    }
  })

  it('VIC 16 is 1080p60 at 148.5 MHz on a 2200x1125 raster', () => {
    const t = ctaByVic(16)!
    expect(t.pixelClockHz).toBe(148_500_000)
    expect(hTotal(t)).toBe(2200)
    expect(vTotal(t)).toBe(1125)
  })

  it('VIC 97 is 2160p60 at 594 MHz, and VIC 118 is 2160p120 at 1188 MHz', () => {
    expect(ctaByVic(97)!.pixelClockHz).toBe(594_000_000)
    expect(ctaByVic(118)!.pixelClockHz).toBe(1_188_000_000)
  })

  it('interlaced VICs state the FIELD rate, not the frame rate', () => {
    const t = ctaByVic(5)! // 1080i60
    expect(t.interlaced).toBe(true)
    expect(Math.round(vFreq(t))).toBe(60)
  })
})

/**
 * An interlaced Timing holds one field, as a DTD does, and every field carries half a
 * line the field cannot state. CTA-861 lists 1080i by the frame: 74.25 MHz on 2200 x 1125
 * (2640 x 1125 at 50) — 1125 lines, two fields of 562.5, stored as 562.
 */
describe('interlaced modes', () => {
  it('VIC 5 is 1080i60: exactly 60 fields and 30 frames a second, on a 2200 x 1125 frame', () => {
    const t = ctaByVic(5)!
    expect(t.vActive).toBe(540)
    expect(frameHeight(t)).toBe(1080)
    expect(hTotal(t)).toBe(2200)
    expect(frameLines(t)).toBe(1125)
    // 60.053 and 30.027 when the half line is dropped.
    expect(vFreq(t)).toBeCloseTo(60, 9)
    expect(frameRate(t)).toBeCloseTo(30, 9)
  })

  it('VIC 20 is 1080i50: exactly 50 fields a second, on a 2640 x 1125 frame', () => {
    const t = ctaByVic(20)!
    expect(hTotal(t)).toBe(2640)
    expect(frameLines(t)).toBe(1125)
    expect(vFreq(t)).toBeCloseTo(50, 9)
  })

  it('the fractional 1080i is 59.94 fields a second', () => {
    expect(vFreq(fractionalVariant(ctaByVic(5)!))).toBeCloseTo(60_000 / 1001, 9)
  })

  it('is labelled by the frame height and the field rate, as everyone says it', () => {
    expect(timingLabel(ctaByVic(5)!)).toBe('1920x1080i60')
    expect(timingLabel(ctaByVic(20)!)).toBe('1920x1080i50')
    expect(timingLabel(fractionalVariant(ctaByVic(5)!))).toBe('1920x1080i59.94')
    expect(ctaByVic(5)!.name).toBe('VIC 5 — 1920x1080i60 16:9')
  })

  // The generators take the FRAME height and the FIELD rate, as simple mode's form does,
  // and must hand back one field. The frame height with a field's porches is a 1080-line
  // field: a 30 Hz mode, labelled 1080i60 and encoded as 2160i.
  const generators = [['CVT', cvt], ['CVT-RB', cvtRb], ['CVT-RB2', cvtRb2], ['GTF', gtf]] as const
  for (const [name, generate] of generators) {
    it(`${name} makes 1080i60 as 540-line fields, about 60 a second`, () => {
      const t = generate(1920, 1080, { refreshHz: 60, interlaced: true })
      expect(t.interlaced).toBe(true)
      expect(t.vActive).toBe(540)
      expect(frameHeight(t)).toBe(1080)
      // Within the clock step: CVT's 250 kHz step lands this on 59.94, as it lands
      // 1080p60 on 59.96.
      expect(Math.abs(vFreq(t) - 60)).toBeLessThan(0.2)
      expect(frameRate(t)).toBeCloseTo(vFreq(t) / 2, 9)
    })
  }

  it('CVT-RB2 and GTF land on the field rate exactly, half line included', () => {
    // Their clocks are computed over field + 0.5 lines, so only a rate that counts
    // the half line agrees with them. Without it, both read 60.05.
    for (const generate of [cvtRb2, gtf]) {
      for (const rate of [60, 50, 59.94]) {
        expect(vFreq(generate(1920, 1080, { refreshHz: rate, interlaced: true }))).toBeCloseTo(rate, 2)
      }
    }
  })

  it('an interlaced mode has the line rate of its frame-rate progressive twin', () => {
    // 1080i60 and 1080p30 scan the same 1125 lines a thirtieth of a second each.
    expect(ctaByVic(5)!.pixelClockHz).toBe(ctaByVic(34)!.pixelClockHz)
    expect(hTotal(ctaByVic(5)!)).toBe(hTotal(ctaByVic(34)!))
    expect(frameLines(ctaByVic(5)!)).toBe(vTotal(ctaByVic(34)!))
  })
})
