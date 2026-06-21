/**
 * Minimal QR Code generator (Version 1–6, Error Correction Level M).
 * Pure implementation — no external dependencies.
 * Encodes alphanumeric/byte data up to ~84 chars (enough for Ethereum addresses).
 */

const EC_LEVEL_M = 0;
const ALIGNMENT_PATTERNS: Record<number, number[]> = {
  2: [6], 3: [6, 28], 4: [6, 22], 5: [6, 26], 6: [6, 30],
};
const VERSION_INFO: Record<number, { totalCodewords: number; ecCodewordsPerBlock: number; blocks: [number, number][] }> = {
  1: { totalCodewords: 26, ecCodewordsPerBlock: 10, blocks: [[26, 10]] },
  2: { totalCodewords: 44, ecCodewordsPerBlock: 16, blocks: [[44, 16]] },
  3: { totalCodewords: 70, ecCodewordsPerBlock: 26, blocks: [[70, 26]] },
  4: { totalCodewords: 100, ecCodewordsPerBlock: 18, blocks: [[50, 18], [50, 18]] },
  5: { totalCodewords: 134, ecCodewordsPerBlock: 24, blocks: [[67, 24], [67, 24]] },
  6: { totalCodewords: 172, ecCodewordsPerBlock: 16, blocks: [[43, 16], [43, 16], [44, 17]] },
};

function getVersion(dataLen: number): number {
  for (let v = 1; v <= 6; v++) {
    const capacity = v <= 2 ? (v === 1 ? 14 : 26) : (v === 3 ? 42 : v === 4 ? 62 : v === 5 ? 84 : 106);
    if (dataLen <= capacity) return v;
  }
  throw new Error("Data too long for QR Version 1-6");
}

function generateQRMatrix(text: string): boolean[][] {
  const data = new TextEncoder().encode(text);
  const version = getVersion(data.length);
  const size = version * 4 + 17;
  const matrix: (0 | 1 | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  function set(x: number, y: number, val: 0 | 1) {
    if (x >= 0 && x < size && y >= 0 && y < size) { matrix[y][x] = val; reserved[y][x] = true; }
  }
  function isReserved(x: number, y: number) { return x >= 0 && x < size && y >= 0 && y < size && reserved[y][x]; }

  // Finder patterns
  function drawFinder(cx: number, cy: number) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const val = Math.abs(dx) === 3 || Math.abs(dy) === 3 || (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) ? 1 : 0;
      set(cx + dx, cy + dy, val as 0 | 1);
    }
    for (let i = -4; i <= 4; i++) {
      if (!isReserved(cx + i, cy - 4)) { set(cx + i, cy - 4, 0); }
      if (!isReserved(cx + i, cy + 4)) { set(cx + i, cy + 4, 0); }
      if (!isReserved(cx - 4, cy + i)) { set(cx - 4, cy + i, 0); }
      if (!isReserved(cx + 4, cy + i)) { set(cx + 4, cy + i, 0); }
    }
  }
  drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isReserved(i, 6)) set(i, 6, i % 2 === 0 ? 1 : 0);
    if (!isReserved(6, i)) set(6, i, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns
  const aligns = ALIGNMENT_PATTERNS[version] ?? [];
  for (const ay of aligns) for (const ax of aligns) {
    if (isReserved(ax, ay)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(ax + dx, ay + dy, Math.abs(dx) === 2 || Math.abs(dy) === 2 || (!dx && !dy) ? 1 : 0);
    }
  }

  // Dark module
  set(8, size - 8, 1);

  // Reserve format info areas
  for (let i = 0; i < 15; i++) {
    if (i < 6) { if (!isReserved(8, i)) { set(8, i, 0); } }
    else if (i < 8) { if (!isReserved(8, i + 1)) { set(8, i + 1, 0); } }
    else if (i < 15) { if (!isReserved(8, size - 15 + i)) { set(8, size - 15 + i, 0); } }
  }
  for (let i = 0; i < 15; i++) {
    if (i < 8) { if (!isReserved(size - 1 - i, 8)) { set(size - 1 - i, 8, 0); } }
    else if (i < 9) { if (!isReserved(15 - i, 8)) { set(15 - i, 8, 0); } }
    else { if (!isReserved(14 - i, 8)) { set(14 - i, 8, 0); } }
  }

  // Encode data
  const info = VERSION_INFO[version];
  const dataBits: number[] = [];
  // Mode: byte = 0100
  dataBits.push(0, 1, 0, 0);
  // Character count (8 bits for version 1-9)
  for (let i = 7; i >= 0; i--) dataBits.push((data.length >> i) & 1);
  // Data
  for (const byte of data) for (let i = 7; i >= 0; i--) dataBits.push((byte >> i) & 1);
  // Terminator
  const totalDataBits = info.totalCodewords * 8 - info.ecCodewordsPerBlock * info.blocks.reduce((s, b) => s + b[1], 0) * 8;
  const terminatorLen = Math.min(4, totalDataBits - dataBits.length);
  for (let i = 0; i < terminatorLen; i++) dataBits.push(0);
  // Pad to byte boundary
  while (dataBits.length % 8 !== 0) dataBits.push(0);
  // Pad bytes
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataBits.length < totalDataBits) {
    for (let i = 7; i >= 0; i--) dataBits.push((padBytes[padIdx] >> i) & 1);
    padIdx = (padIdx + 1) % 2;
  }

  // Place data bits
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = (right + 1) & 2;
        const y = upward ? size - 1 - vert : vert;
        if (!isReserved(x, y) && bitIdx < dataBits.length) {
          set(x, y, dataBits[bitIdx] as 0 | 1);
          bitIdx++;
        }
      }
    }
  }

  // Simple mask: checkerboard (mask pattern 2)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!isReserved(x, y)) {
      const cur = matrix[y][x] as 0 | 1;
      set(x, y, ((cur + (x + y) % 2) % 2) as 0 | 1);
    }
  }

  // Format info (simplified: mask 2 = 111011, EC level M = 00)
  const formatBits = [0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0];
  for (let i = 0; i < 15; i++) {
    const val = formatBits[i] as 0 | 1;
    // Horizontal
    if (i < 6) set(8, i, val);
    else if (i < 8) set(8, i + 1, val);
    else set(8, size - 15 + i, val);
    // Vertical
    if (i < 8) set(size - 1 - i, 8, val);
    else if (i < 9) set(15 - i, 8, val);
    else set(14 - i, 8, val);
  }

  return matrix.map(row => row.map(v => v === 1));
}

/** Render a QR code as an SVG string. */
export function qrToSvg(text: string, moduleSize = 4, margin = 4): string {
  const matrix = generateQRMatrix(text);
  const size = matrix.length;
  const total = size + margin * 2;
  const svgSize = total * moduleSize;

  let rects = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (matrix[y][x]) {
      rects += `<rect x="${(x + margin) * moduleSize}" y="${(y + margin) * moduleSize}" width="${moduleSize}" height="${moduleSize}" fill="#fff"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="${svgSize}" height="${svgSize}"><rect width="${svgSize}" height="${svgSize}" fill="#1a0a2e"/>${rects}</svg>`;
}
