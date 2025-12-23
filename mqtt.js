import { StringDecoder } from 'node:string_decoder'

const variableByteIntDecode = (bytes) => {
  let multiplier = 1
  let value = 0
  let index = 0
  const limit = 4
  while (true) {
    const encodedByte = bytes[index++]
    value += (encodedByte & 127) * multiplier
    if (index > limit) {
      throw Error("Malformed Variable Byte Integer")
    }
    multiplier *= 128
    if ((encodedByte & 128) === 0) {
      break
    }
  }
  return { value, index }
}

const readFixedHeader = (byte) => {
  switch (byte >> 4) {
    case 3:
      console.log("PUB")
      break
    default:
      console.log("UNKNOWN")
  }
  const flags = byte - ((byte >> 4) << 4)
}

export const decodePacket = (buffer) => {
  console.debug(buffer)
  readFixedHeader(buffer[0])
  const { value, index } = variableByteIntDecode(buffer.subarray(1, 6))
  console.debug(value)
  const packet = buffer.subarray(1 + index, 1 + index + value)
  const topicLength = packet.readUInt16BE(0)
  // console.log(topicLength)
  const decoder = new StringDecoder('utf8')
  const topicName = decoder.write(packet.subarray(2, 2 + topicLength))
  console.debug(topicName)
  // properties
  const propertyLength = packet[2 + topicLength]
  if (propertyLength > 0) {
    // decode
  }
  const payload = decoder.write(packet.subarray(2 + topicLength + 1))
  console.debug(payload)
}

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
