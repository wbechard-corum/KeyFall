export const IDENTITY_REQUEST = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];

export function parseIdentityReply(data) {
  if (!data || data.length < 12) return null;
  if (data[0] !== 0xF0 || data[1] !== 0x7E || data[3] !== 0x06 || data[4] !== 0x02) return null;

  return {
    manufacturerId: data[5],
    manufacturerName: data[5] === 0x41 ? 'Roland'
      : data[5] === 0x43 ? 'Yamaha'
      : data[5] === 0x42 ? 'Korg'
      : `0x${data[5].toString(16).padStart(2, '0')}`,
    familyCode: [data[6], data[7]],
    modelNumber: [data[8], data[9]],
    version: Array.from(data.slice(10, 14)),
    raw: Array.from(data),
  };
}

export function formatHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

export function rolandChecksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0x7F;
  return (128 - sum) & 0x7F;
}

export function buildRolandDT1(deviceId, modelId, address, data) {
  const addressAndData = [...address, ...data];
  const checksum = rolandChecksum(addressAndData);
  return [
    0xF0, 0x41, deviceId & 0x7F,
    ...modelId,
    0x12,
    ...addressAndData,
    checksum,
    0xF7,
  ];
}

// Roland splits multi-byte parameter values into 4-bit nibbles, most
// significant first, because every SysEx data byte must stay under 0x80. A
// `size: 4` parameter therefore carries 16 bits of range in four bytes:
//
//   value 0x1234, size 4  ->  [0x01, 0x02, 0x03, 0x04]
//
// Single-byte parameters are sent as a plain 7-bit value instead.
export function encodingForSize(size, explicit) {
  if (explicit === 'byte' || explicit === 'nibble') return explicit;
  return size > 1 ? 'nibble' : 'byte';
}

export function maxValueFor(size, encoding) {
  const n = Math.max(1, Math.min(8, size | 0));
  return encodingForSize(n, encoding) === 'nibble' ? Math.pow(16, n) - 1 : 127;
}

export function encodeRolandValue(value, size, encoding) {
  const n = Math.max(1, Math.min(8, size | 0));
  const kind = encodingForSize(n, encoding);
  const max = maxValueFor(n, kind);
  const v = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  if (kind === 'byte') return [v & 0x7F];
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = (v >> ((n - 1 - i) * 4)) & 0x0F;
  }
  return out;
}

export function buildSysEx(format, { deviceId, modelId, address, data }) {
  switch (format) {
    case 'roland-dt1':
      return buildRolandDT1(deviceId ?? 0x10, modelId ?? [], address ?? [], data ?? []);
    default:
      throw new Error(`Unknown SysEx format: ${format}`);
  }
}

export function identityMatches(reply, expected) {
  if (!reply || !expected) return false;

  const toBytes = (v) => {
    if (Array.isArray(v)) return v.map(Number);
    if (typeof v === 'number') {
      const hi = (v >> 8) & 0xFF;
      const lo = v & 0xFF;
      return [hi, lo];
    }
    if (typeof v === 'string') {
      const clean = v.replace(/^0x/i, '');
      const n = parseInt(clean, 16);
      return [(n >> 8) & 0xFF, n & 0xFF];
    }
    return [];
  };

  const expectedMfr = typeof expected.manufacturerId === 'string'
    ? parseInt(expected.manufacturerId.replace(/^0x/i, ''), 16)
    : expected.manufacturerId;

  if (expectedMfr !== undefined && reply.manufacturerId !== expectedMfr) return false;

  const fam = toBytes(expected.familyCode);
  if (fam.length === 2 && (reply.familyCode[0] !== fam[0] || reply.familyCode[1] !== fam[1])) return false;

  const mdl = toBytes(expected.modelNumber);
  if (mdl.length === 2 && (reply.modelNumber[0] !== mdl[0] || reply.modelNumber[1] !== mdl[1])) return false;

  return true;
}
