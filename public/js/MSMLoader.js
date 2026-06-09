/**
 * ==========================================
 * MSMLoader — Binary .msm file decoder
 * ==========================================
 * Parses Just Dance move-classifier files.
 *
 * File structure (Big-Endian):
 *   Offset   0 –   3 : int32 — version (1)
 *   Offset   4 –   7 : int32 — type ID
 *   Offset   8 –  71 : char[64] — move name (zero-padded)
 *   Offset  72 – 135 : char[64] — map/song name (zero-padded)
 *   Offset 136 – 199 : char[64] — channel name (e.g. "Acc_Dev_Dir_NP")
 *   Offset 200 – 223 : float32[6] — calibration/meta floats
 *   Offset 224 – 231 : padding (zeros)
 *   Offset 232 – 235 : int32 — number of samples (N)
 *   Offset 236 – 239 : int32 — components per sample (C)
 *   Offset 240 – 243 : int32 — reserved (0)
 *   Offset 244 …      : float32[N+1][C] — sample data
 *
 * Returns an object { name, mapName, channel, numSamples, components, samples }
 * where samples is an array of arrays: [[c0, c1], [c0, c1], …]
 */
export default class MSMLoader {
  /**
   * Fetches and parses an .msm file from a URL.
   * @param {string} url - Path to the .msm file.
   * @returns {Promise<MSMData>}
   */
  static async load(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`MSM fetch failed: ${resp.status} ${url}`);
    const arrayBuf = await resp.arrayBuffer();
    return MSMLoader.parse(arrayBuf);
  }

  /**
   * Parses a raw ArrayBuffer as an MSM file.
   * @param {ArrayBuffer} buf
   * @returns {MSMData}
   */
  static parse(buf) {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    const version    = view.getInt32(0, false);  // BE
    const typeId     = view.getInt32(4, false);

    const name       = MSMLoader._readString(bytes, 8, 64);
    const mapName    = MSMLoader._readString(bytes, 72, 64);
    const channel    = MSMLoader._readString(bytes, 136, 64);

    // Meta floats (200–223)
    const metaFloats = [];
    for (let i = 0; i < 6; i++) {
      metaFloats.push(view.getFloat32(200 + i * 4, false));
    }

    const numSamples  = view.getInt32(232, false);
    const components  = view.getInt32(236, false);

    // Data starts at offset 244
    const dataOffset = 244;
    const totalFloats = (numSamples + 1) * components;
    const samples = [];

    for (let s = 0; s <= numSamples; s++) {
      const row = [];
      for (let c = 0; c < components; c++) {
        const off = dataOffset + (s * components + c) * 4;
        if (off + 4 <= buf.byteLength) {
          row.push(view.getFloat32(off, false));  // Big-Endian
        } else {
          row.push(0);
        }
      }
      samples.push(row);
    }

    return {
      version,
      typeId,
      name,
      mapName,
      channel,
      metaFloats,
      numSamples: numSamples + 1,  // actual count (0..N inclusive)
      components,
      samples,
    };
  }

  /**
   * Read a zero-terminated ASCII string from a byte array.
   * @param {Uint8Array} bytes
   * @param {number} offset
   * @param {number} maxLen
   * @returns {string}
   */
  static _readString(bytes, offset, maxLen) {
    let str = '';
    for (let i = 0; i < maxLen; i++) {
      const ch = bytes[offset + i];
      if (ch === 0) break;
      str += String.fromCharCode(ch);
    }
    return str;
  }
}
