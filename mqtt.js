import { createConnection } from 'node:net'
import rpio from 'rpio'

const pin = 31
rpio.open(pin, rpio.OUTPUT, rpio.LOW)

const variableByteInt = (length) => {
  const magic = 128
  let x = length
  let bytes = []
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

const rawString = (string, includeHeader = true) => {
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

const packitup = (blob, header) => {
  const vbi = variableByteInt(blob.size)
  const dv = new DataView(new ArrayBuffer(1 + vbi.length))
  dv.setUint8(0, header)
  vbi.forEach((number, i) => {
    dv.setUint8(1 + i, number)
  })
  return new Blob([dv.buffer, blob])
}

const connection = () => {
  const protocol = rawString("MQTT")
  let flags = 0
  const dv = new DataView(new ArrayBuffer(5))
  dv.setUint8(0, 5)
  flags |= 0b10000000 // user flag
  flags |= 0b1000000 // password flag
  flags |= 0b10 // clean start
  // flag uint8
  dv.setUint8(1, flags)
  dv.setUint16(2, 60), // keep alive
  // properties - hard code to nothing
  dv.setUint8(4, 0)
  // client id name
  const clientId = rawString(process.env.CLIENTID)
  const user = rawString(process.env.USERNAME)
  const pass = rawString(process.env.PASSWORD)
  return packitup(
    new Blob([protocol, dv.buffer, clientId, user, pass]),
    0x10
  )
}

const id = process.env.DEVICEID

if (!id) {
  console.log('must have unique id')
  process.exit(1)
}

const discovery = () => {
  const config = rawString(`homeassistant/button/${id}/config`)
  const dv = new DataView(new ArrayBuffer(1))
  dv.setUint8(0, 0)
  const json = {
    "name": "Garage Door 1",
    // "device_class": "button",
    "unique_id": id,
    "platform": "button",
    // "payload_press": "press",
    "command_topic": `homeassistant/button/${id}/set`,
  }
  const button = rawString(JSON.stringify(json), false)
  return packitup(
    new Blob([config, dv.buffer, button]),
    0b110000
  )
}
const subscribe = () => {
  const header = new DataView(new ArrayBuffer(3))
  header.setUint16(0, 1470)
  header.setUint8(2, 0)
  const topic = rawString(`homeassistant/button/${id}/set`)
  const dv = new DataView(new ArrayBuffer(1))
  dv.setUint8(0, 2)
  return packitup(
    new Blob([header.buffer, topic, dv.buffer]),
    0x82
  )
}

const connectionPacket = await connection().bytes()
const discoveryPacket = await discovery().bytes()
const subscribePacket = await subscribe().bytes()

const discoveryAndSubscribe = async () => {

  const openSocket = () => {
    return new Promise((resolve, reject) => {
      const port = Number(process.env.HAPORT) 
      const socket = createConnection(port, process.env.HAHOST, () => {
        console.log('connected to server!')
        socket.setKeepAlive(true) 
        resolve(socket)
      })
    })
  }
  const socket = await openSocket()
  socket.on('error', (data) => {
    console.error(data)
    socket.destroy()
  })

  socket.on('close', () => {
    console.debug('closing')
    clearInterval(heartbeat)
    // restart
    setTimeout(discoveryAndSubscribe, 1000)
  })

  socket.on('end', () => {
    console.debug('ended')
    socket.destroy()
  })

  socket.on('data', (data) => {
    if (data[0] === 0x30) {
      console.log('trigger relay!')
      rpio.write(pin, rpio.HIGH)
      setTimeout(() => {
        rpio.write(pin, rpio.LOW)
      }, 500)
    }
  })
  socket.write(connectionPacket)

  setTimeout(() => {
    console.debug('writing discovery')
    socket.write(discoveryPacket)
  }, 300)

  setTimeout(() => {
    console.debug('writing subscribe')
    socket.write(subscribePacket)
  }, 600)

  const ping = new Uint8Array([0xC0, 0])
  const heartbeat = setInterval(() => {
    socket.write(ping)
  }, 15000)
}

discoveryAndSubscribe()