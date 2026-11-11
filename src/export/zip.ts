/**
 * A minimal ZIP writer (stored, not compressed), enough for a .docx. Written here so the package
 * keeps its dependency list short: a security team reviewing the tool has less to read.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

const u16 = (n: number) => Buffer.from([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n: number) => Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** A fixed timestamp (1980-01-01) so the same input always makes the same file. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function zip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : Buffer.from(e.data);
    const crc = crc32(data);
    const header = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    local.push(header, data);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ]),
    );
    offset += header.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBuf.length), u32(offset), u16(0)]);
  return Buffer.concat([...local, centralBuf, end]);
}
