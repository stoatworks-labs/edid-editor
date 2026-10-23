import { describe, expect, it } from 'vitest'
import { DEVICES, DEVICE_LIST } from '../capability/devices.ts'
import { evaluateDevice } from '../capability/evaluate.ts'
import { DEFAULT_SIGNAL, dpRequirement, hdmiRequirement, dviRequirement } from '../link.ts'
import { ctaByVic } from '../timing/cta.ts'
import { cvtRb, cvtRb2 } from '../timing/cvt.ts'
import type { SignalOptions } from '../link.ts'
import { mosaicTiming, toTiming } from '../mosaic.ts'

const sig = (o: Partial<SignalOptions> = {}): SignalOptions => ({ ...DEFAULT_SIGNAL, ...o })
const dev = (id: string) => DEVICE_LIST.find((d) => d.id === id)!

const p1080p60 = ctaByVic(16)!
const p2160p60 = ctaByVic(97)!
const p2160p120 = ctaByVic(118)!

describe('data integrity', () => {
  it('every device documented as such carries at least one citation', () => {
    for (const d of DEVICES) {
      if (d.confidence === 'documented') {
        expect(d.citations.length, `${d.id} claims 'documented' with no citation`).toBeGreaterThan(0)
      }
    }
  })

  it('every citation states what was read and when', () => {
    for (const d of DEVICES) {
      for (const c of d.citations) {
        expect(c.claim.length, `${d.id}: empty claim`).toBeGreaterThan(20)
        expect(c.source.length, `${d.id}: empty source`).toBeGreaterThan(5)
        expect(c.read).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  it('device ids are unique', () => {
    const ids = DEVICES.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('platform-sharing models inherit only from an explicit pointer', () => {
    // NeXtage IS a LiveCore, and says so.
    const nextage = dev('aw-livecore-nextage')
    expect(nextage.inheritsFrom).toBe('aw-livecore-ascender')
    expect(nextage.capacityModes.map((m) => m.id)).toContain('dual')

    // An EX chassis takes either generation of card, so it must NOT be handed
    // one generation's answer as if it were fact.
    const ex = dev('barco-ex')
    expect(ex.inheritsFrom).toBeUndefined()
    expect(ex.capacityModes).toEqual([])
  })

  it('an EX chassis reports unknown rather than a card generation it may not have', () => {
    const v = evaluateDevice(dev('barco-ex'), p2160p60, sig())
    expect(v.status).toBe('unknown')
  })
})

describe('link requirements', () => {
  it('1080p60 8-bit fits HDMI 1.0–1.2, and DP RBR on four lanes', () => {
    const h = hdmiRequirement(p1080p60, sig())
    expect(h.version!.name).toBe('HDMI 1.0–1.2')
    expect(h.viaTmds).toBe(true)
    // 3.56 Gbps against RBR's 5.18 Gbps across four lanes — 1080p60 does not
    // need HBR, which is easy to assume because a single lane cannot carry it.
    const d = dpRequirement(p1080p60, sig())
    expect(d.rate!.name).toBe('RBR (1.62G)')
    expect(dpRequirement(p1080p60, sig(), 1).rate!.name).toBe('HBR2 (5.4G)')
  })

  it('2160p60 8-bit 4:4:4 needs HDMI 2.0 and DP HBR2', () => {
    expect(hdmiRequirement(p2160p60, sig()).version!.name).toBe('HDMI 2.0')
    expect(dpRequirement(p2160p60, sig()).rate!.name).toBe('HBR2 (5.4G)')
  })

  it('4:2:0 halves the TMDS rate, dropping 2160p60 onto an HDMI 1.4 link', () => {
    const h = hdmiRequirement(p2160p60, sig({ format: 'ycbcr420' }))
    expect(h.version!.name).toBe('HDMI 1.3/1.4')
    expect(h.viaTmds).toBe(true)
  })

  it('10-bit raises 2160p60 above 600 MHz, forcing FRL', () => {
    const h = hdmiRequirement(p2160p60, sig({ bpc: 10 }))
    expect(h.viaTmds).toBe(false)
    expect(h.version!.name).toMatch(/FRL/)
  })

  it('4:2:2 costs the same as 8-bit 4:4:4 whatever depth is asked for', () => {
    const a = hdmiRequirement(p2160p60, sig({ format: 'ycbcr422', bpc: 8 }))
    const b = hdmiRequirement(p2160p60, sig({ format: 'ycbcr422', bpc: 12 }))
    expect(a.tmdsCharacterRateHz).toBe(b.tmdsCharacterRateHz)
    expect(a.version!.name).toBe('HDMI 2.0')
  })

  it('2160p120 10-bit 4:4:4 needs 48G FRL', () => {
    const h = hdmiRequirement(p2160p120, sig({ bpc: 10 }))
    expect(h.version!.name).toContain('48G')
  })

  it('DSC forces FRL even where TMDS would otherwise have carried the mode', () => {
    const plain = hdmiRequirement(p1080p60, sig())
    const dsc = hdmiRequirement(p1080p60, sig({ dsc: true }))
    expect(plain.viaTmds).toBe(true)
    expect(dsc.viaTmds).toBe(false)
    expect(dsc.note).toMatch(/DSC only travels over FRL/)
  })

  it('DSC at 12 bpp brings 2160p120 within a 24G link', () => {
    const without = hdmiRequirement(p2160p120, sig({ bpc: 10 }))
    const withDsc = hdmiRequirement(p2160p120, sig({ bpc: 10, dsc: true, dscTargetBpp: 12 }))
    expect(without.payloadBps).toBeGreaterThan(withDsc.payloadBps)
    // 1188 MHz x 12 bpp = 14.3 Gbps, which 18G FRL carries. Uncompressed
    // 10-bit needed 48G — DSC moves it three rungs down the ladder.
    expect(without.version!.name).toContain('48G')
    expect(withDsc.version!.name).toContain('18G')
  })

  it('DVI is single-link to 165 MHz and dual-link to 330', () => {
    expect(dviRequirement(p1080p60, sig()).link).toBe('single')
    expect(dviRequirement(cvtRb(2560, 1600, { refreshHz: 60 }), sig()).link).toBe('dual')
    expect(dviRequirement(p2160p60, sig()).link).toBeNull()
  })
})

describe('device verdicts', () => {
  it('LiveCore takes 1080p60 on a single link', () => {
    const v = evaluateDevice(dev('aw-livecore-ascender'), p1080p60, sig())
    expect(v.status).toBe('supported')
    expect(v.requiredMode!.id).toBe('single')
  })

  it('LiveCore needs the dual-link mode for 2560x1600 RB, and says what it costs', () => {
    const v = evaluateDevice(dev('aw-livecore-ascender'), cvtRb(2560, 1600, { refreshHz: 60 }), sig())
    expect(v.status).toBe('conditional')
    expect(v.requiredMode!.id).toBe('dual')
    expect(v.warnings.join(' ')).toMatch(/DISABLES the neighbouring input/)
  })

  it('LiveCore cannot take 2160p60 in any mode', () => {
    expect(evaluateDevice(dev('aw-livecore-ascender'), p2160p60, sig()).status).toBe('unsupported')
  })

  it('the previous-generation Midra cannot take 2160p60 either', () => {
    expect(evaluateDevice(dev('aw-midra-legacy'), p2160p60, sig()).status).toBe('unsupported')
  })

  it('E2 Gen 1 needs its dual-cable mode for 2160p60 and warns that one cable will not do', () => {
    const v = evaluateDevice(dev('barco-e2-gen1'), p2160p60, sig())
    expect(v.status).toBe('conditional')
    expect(v.requiredMode!.id).toBe('one-4k60-dual-cable')
    expect(v.warnings.join(' ')).toMatch(/two cables/)
  })

  it('E2 Gen 2 takes 2160p60 on one cable, in its dual-capacity mode', () => {
    const v = evaluateDevice(dev('barco-e2-gen2'), p2160p60, sig())
    expect(v.requiredMode!.id).toBe('two-uhd60')
    expect(v.requiredConnector!.label).toBe('HDMI 2.0')
  })

  it('the Aquilon DP card names the ports DP 1.4 takes away', () => {
    // 2160p120 RB is exactly the case the DP 1.4 mode exists for.
    // RBv2 specifically. At RBv1's 160-pixel blanking, 2160p120 costs
    // 26.3 Gbps and does NOT fit four lanes of HBR3 (25.92 Gbps) — the
    // vendor's "3840x2160RB 120Hz" claim only holds on the v2 blanking.
    const t = cvtRb2(3840, 2160, { refreshHz: 120 })
    const v = evaluateDevice(dev('aw-livepremier-aquilon-dp'), t, sig())
    expect(v.requiredMode!.id).toBe('dp14x2')
    expect(v.warnings.join(' ')).toMatch(/PORTS 2 AND 4 ARE PREEMPTED/)

    const v1 = evaluateDevice(dev('aw-livepremier-aquilon-dp'), cvtRb(3840, 2160, { refreshHz: 120 }), sig())
    expect(v1.status).toBe('unsupported')
  })

  it('an Aquilon card says when a mode is not one Analog Way names', () => {
    // A 16384 x 2160 mosaic's tile: 549 MHz at 30 Hz fits an HDMI 2.0 port,
    // but Analog Way's custom formats go "such as 8192x1080", not 2160 tall.
    const tile = toTiming(mosaicTiming(8192, 2160, 30))
    for (const id of ['aw-livepremier-aquilon', 'aw-livepremier-aquilon-dp']) {
      const v = evaluateDevice(dev(id), tile, sig())
      expect(v.status, id).toBe('conditional')
      expect(v.warnings.join(' '), id).toMatch(/8192 × 2160 is not a format Analog Way names .* may not be accepted/)
    }
    // The formats it does name stay clean.
    const named = [p2160p60, cvtRb2(8192, 1080, { refreshHz: 60 }), cvtRb2(4096, 2160, { refreshHz: 60 })]
    for (const t of named) {
      const v = evaluateDevice(dev('aw-livepremier-aquilon'), t, sig({ bpc: 8 }))
      expect(v.warnings.join(' '), `${t.hActive} x ${t.vActive}`).not.toMatch(/not a format/)
    }
    const fiveK = evaluateDevice(dev('aw-livepremier-aquilon-dp'), cvtRb2(5120, 2880, { refreshHz: 60 }), sig({ bpc: 8 }))
    expect(fiveK.warnings.join(' ')).not.toMatch(/not a format/)
  })

  it('Brompton SX40 accepts a high frame rate that everything else refuses', () => {
    // RBv2 again: RBv1 puts 1080p240 at 606.5 MHz, just over the SX40's
    // 600 MHz ceiling. Six megahertz decides it.
    const t = cvtRb2(1920, 1080, { refreshHz: 240 })
    const sx = evaluateDevice(dev('brompton-sx40'), t, sig())
    expect(sx.status).not.toBe('unsupported')
    expect(sx.warnings.join(' ')).not.toMatch(/exceeds the documented/)

    const aq = evaluateDevice(dev('aw-livepremier-aquilon'), t, sig())
    expect(aq.warnings.join(' ')).toMatch(/exceeds the documented 144 Hz/)
  })

  it('an MX2000 Pro names the input card a mode needs', () => {
    // 4K60 is the 4K HDMI card's; the first mode that works wins.
    expect(evaluateDevice(dev('novastar-mx2000pro'), p2160p60, sig()).requiredMode!.id).toBe('hdmi20x4')

    // NovaStar's forced 8192 x 4320 @30 12-bit 4:4:4 is 39.8 Gbps: past TMDS
    // and past HBR3, inside 48G FRL. Only the HDMI 2.1 card takes it.
    const eightK30 = cvtRb2(8192, 4320, { refreshHz: 30 })
    const v = evaluateDevice(dev('novastar-mx2000pro'), eightK30, sig({ bpc: 12 }))
    expect(v.status).toBe('supported')
    expect(v.requiredMode!.id).toBe('hdmi21x2')

    // 8K60 does not fit HBR3 uncompressed; with DSC only the 8K@60 card decodes it.
    const eightK60 = cvtRb2(7680, 4320, { refreshHz: 60 })
    expect(evaluateDevice(dev('novastar-mx2000pro'), eightK60, sig()).status).toBe('unsupported')
    expect(evaluateDevice(dev('novastar-mx2000pro'), eightK60, sig({ dsc: true })).requiredMode!.id).toBe('dp14-8k60')
  })

  it('an MX6000 Pro is the MX2000 Pro’s cards, by explicit pointer', () => {
    const mx6000 = dev('novastar-mx6000pro')
    expect(mx6000.inheritsFrom).toBe('novastar-mx2000pro')
    expect(mx6000.capacityModes).toEqual(dev('novastar-mx2000pro').capacityModes)
  })

  it('reports unknown rather than guessing where no capability is recorded', () => {
    const v = evaluateDevice({ ...dev('barco-ex'), capacityModes: [] }, p1080p60, sig())
    expect(v.status).toBe('unknown')
  })

  it('every device produces a verdict for a plain 1080p60', () => {
    for (const d of DEVICE_LIST) {
      const v = evaluateDevice(d, p1080p60, sig())
      expect(['supported', 'conditional', 'unsupported', 'unknown']).toContain(v.status)
    }
  })
})
