const variableByteInt = (length) => {
  const magic = 128
  let x = length
  const bytes = []
  while (x > 0) {
    let byte = x % magic
    x = Math.floor(x / magic)
    if (x > 0) {
      byte = byte | magic
    }
    bytes.push(byte)
  }
  return bytes
}

export const rawString = (string, includeHeader = true) => {
  const utf8encoder = new TextEncoder()
  const bytes = utf8encoder.encode(string)
  if (includeHeader) {
    const dv = new DataView(new ArrayBuffer(2))
    dv.setInt16(0, bytes.length)
    return new Blob([dv.buffer, bytes.buffer])
  } else {
    return new Blob([bytes.buffer])
  }
}

export const packitup = (blob, header) => {
  const vbi = variableByteInt(blob.size)
  const dv = new DataView(new ArrayBuffer(1 + vbi.length))
  dv.setUint8(0, header)
  vbi.forEach((number, i) => {
    dv.setUint8(1 + i, number)
  })
  return new Blob([dv.buffer, blob])
}
