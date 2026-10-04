export function leadingZeroBits(bytes: number[]): number {
  let n = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) { n += 8; continue }
    return n + Math.clz32(bytes[i]) - 24
  }
  return n
}
