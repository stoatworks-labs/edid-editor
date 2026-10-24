/**
 * A CTA extension's data blocks as Linux finds them, not as the editor's own decoder
 * does. From `drivers/gpu/drm/drm_edid.c` at torvalds/linux 4da9ded, read
 * 2026-10-24: only revision 3 and later has a collection
 * (`__cea_db_iter_edid_next`); it runs from byte 4 up to byte 2, `d`, and is
 * empty when d < 4 (`cea_db_collection_size`); and reading stops at a block that
 * would run past d (`__cea_db_iter_current_block`).
 *
 * The editor's decoder reads blocks behind d = 0 all the way to the padding, which is
 * why its round trips passed while every VIC-only build was unreadable here.
 */
export function linuxDataBlocks(cta: ArrayLike<number>): number[][] {
  const b = Array.from(cta)
  const d = b[2]
  if (b[0] !== 0x02 || b[1] < 3 || d < 4 || d > 127) return []
  const out: number[][] = []
  for (let i = 4; i + 1 <= d; ) {
    const end = i + 1 + (b[i] & 0x1f)
    if (end > d) break
    out.push(b.slice(i, end))
    i = end
  }
  return out
}

/**
 * The HDMI VSDB Linux acts on (`cea_db_is_hdmi_vsdb`: tag 3, OUI 00-0C-03, a
 * payload of 5 or more). Finding one is what makes it treat the sink as HDMI
 * rather than DVI. Max_TMDS_Clock is payload byte 7, read only when the payload
 * has one (`drm_parse_hdmi_vsdb_video`).
 */
export function linuxHdmiVsdb(cta: ArrayLike<number>): { maxTmdsClockMHz?: number } | undefined {
  const db = linuxDataBlocks(cta).find(
    (b) => b[0] >> 5 === 3 && (b[0] & 0x1f) >= 5 && b[1] === 0x03 && b[2] === 0x0c && b[3] === 0x00,
  )
  if (!db) return undefined
  return (db[0] & 0x1f) >= 7 ? { maxTmdsClockMHz: db[7] * 5 } : {}
}
