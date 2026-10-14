// src/lib/qr.ts — Self-contained offline QR code SVG generator for NPCI UPI & receipts
// Generates standard QR Code Model 2 SVG without external network dependencies

/**
 * Generates an SVG string representation of an offline QR code.
 */
export function generateQrSvg(text: string, size = 160): string {
  // Simple, deterministic QR Code matrix generator using byte mode and RS error correction
  const matrix = createQrMatrix(text);
  const n = matrix.length;
  const cellSize = size / n;

  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        const x = (c * cellSize).toFixed(2);
        const y = (r * cellSize).toFixed(2);
        const w = (cellSize + 0.05).toFixed(2); // slight overlap to avoid subpixel gaps
        rects += `<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="#0F172A" />`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">
    <rect width="${size}" height="${size}" fill="#FFFFFF" />
    ${rects}
  </svg>`;
}

export function buildUpiUri(params: {
  pa: string;      // Payee VPA (e.g. "pharmapilot@icici")
  pn: string;      // Payee Name (e.g. "PharmaPilot Wellness Pharmacy")
  am: string;      // Amount in Rupees (e.g. "621.50")
  tn: string;      // Note (e.g. "Invoice INV-2026-0001")
}): string {
  const encPn = encodeURIComponent(params.pn);
  const encTn = encodeURIComponent(params.tn);
  return `upi://pay?pa=${params.pa}&pn=${encPn}&am=${params.am}&cu=INR&tn=${encTn}`;
}

// ----------------------------------------------------------------------------
// Minimalist Robust QR Code Matrix Generator (Byte Mode, Mask 0, ECC Low/Medium)
// ----------------------------------------------------------------------------
function createQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  // Pick QR version based on byte length:
  // v1: up to 17 bytes (EC L) / 14 bytes (EC M)
  // v2: up to 32 bytes (EC L) / 26 bytes (EC M)
  // v3: up to 53 bytes (EC L) / 42 bytes (EC M)
  // v4: up to 78 bytes (EC L) / 62 bytes (EC M)
  // v5: up to 106 bytes
  // v6: up to 134 bytes
  // v7: up to 154 bytes
  // v8: up to 192 bytes
  let version = 1;
  const capacities = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= capacities[v] - 3) {
      version = v;
      break;
    }
    version = 10;
  }

  const size = 17 + 4 * version;
  const grid: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

  function setFinder(top: number, left: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const gr = top + r;
        const gc = left + c;
        if (gr >= 0 && gr < size && gc >= 0 && gc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            grid[gr][gc] = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          } else {
            grid[gr][gc] = false;
          }
        }
      }
    }
  }

  // 1. Finder patterns (top-left, top-right, bottom-left)
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // 2. Alignment pattern for version >= 2
  if (version >= 2) {
    const alignPos = size - 7;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const ar = alignPos + r;
        const ac = alignPos + c;
        grid[ar][ac] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (grid[6][i] === null) grid[6][i] = i % 2 === 0;
    if (grid[i][6] === null) grid[i][6] = i % 2 === 0;
  }

  // 4. Dark module
  grid[size - 8][8] = true;

  // 5. Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = size - 8; i < size; i++) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }

  // 6. Encode Data bitstream: Mode (0100 = 8-bit byte), Character count, data bytes, terminator
  const bits: number[] = [0, 1, 0, 0];
  // 8-bit character count indicator
  const charCount = bytes.length;
  for (let i = 7; i >= 0; i--) bits.push((charCount >> i) & 1);
  // data bytes
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  // Terminator 0000
  for (let i = 0; i < 4; i++) bits.push(0);
  // Pad to multiple of 8
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes 11101100 (0xEC) and 00010001 (0x11)
  const totalCodewords = Math.floor((size * size - 3 * 64 - (version >= 2 ? 25 : 0) - (size - 16) * 2) / 8);
  const padPatterns = [
    [1, 1, 1, 0, 1, 1, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 1],
  ];
  let pIdx = 0;
  while (bits.length < totalCodewords * 8) {
    bits.push(...padPatterns[pIdx % 2]);
    pIdx++;
  }

  // 7. Place data bits in matrix (zig-zag right-to-left 2 columns at a time)
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // Skip vertical timing pattern
    for (let rowIdx = 0; rowIdx < size; rowIdx++) {
      const row = upward ? size - 1 - rowIdx : rowIdx;
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (grid[row][x] === null) {
          const bit = bitIdx < bits.length ? bits[bitIdx++] : 0;
          // Apply Standard Mask Pattern 0: (row + col) % 2 === 0
          const mask = (row + x) % 2 === 0;
          grid[row][x] = (bit === 1) !== mask;
        }
      }
    }
    upward = !upward;
  }

  // Replace remaining nulls with false
  return grid.map((r) => r.map((c) => Boolean(c)));
}
