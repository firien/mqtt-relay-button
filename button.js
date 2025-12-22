import { createConnection } from "node:net"
import { packitup, rawString } from "./mqtt.js"
import rpio from "rpio"

const pin = 31
rpio.open(pin, rpio.OUTPUT, rpio.LOW)

const connection = () => {
  const protocol = rawString("MQTT")
  const dv = new DataView(new ArrayBuffer(5))
  dv.setUint8(0, 5)
  const flags =
    0b10000000 | // user flag
    0b01000000 | // password flag
    0b00000010   // clean start
  // flag uint8
  dv.setUint8(1, flags)
  dv.setUint16(2, 60) // keep alive
  // properties - hard code to nothing
  dv.setUint8(4, 0)
  // client id name
  const clientId = rawString(process.env.CLIENTID)
  const user = rawString(process.env.USERNAME)
  const pass = rawString(process.env.PASSWORD)
  return packitup(new Blob([protocol, dv.buffer, clientId, user, pass]), 0x10)
}

const id = process.env.DEVICEID

if (!id) {
  console.log("must have unique id")
  process.exit(1)
}

const discovery = () => {
  const config = rawString(`homeassistant/button/${id}/config`)
  const dv = new DataView(new ArrayBuffer(1))
  dv.setUint8(0, 0)
  const json = {
    name: "Garage Door 1",
    // "device_class": "button",
    unique_id: id,
    platform: "button",
    // "payload_press": "press",
    command_topic: `homeassistant/button/${id}/set`,
  }
  const button = rawString(JSON.stringify(json), false)
  return packitup(new Blob([config, dv.buffer, button]), 0b110000)
}
const subscribe = () => {
  const header = new DataView(new ArrayBuffer(3))
  header.setUint16(0, 1470)
  header.setUint8(2, 0)
  const topic = rawString(`homeassistant/button/${id}/set`)
  const dv = new DataView(new ArrayBuffer(1))
  dv.setUint8(0, 2)
  return packitup(new Blob([header.buffer, topic, dv.buffer]), 0x82)
}

const connectionPacket = await connection().bytes()
const discoveryPacket = await discovery().bytes()
const subscribePacket = await subscribe().bytes()

const discoveryAndSubscribe = async () => {
  const openSocket = () => {
    return new Promise((resolve, reject) => {
      const port = Number(process.env.HAPORT)
      const socket = createConnection(port, process.env.HAHOST, () => {
        console.log("connected to server!")
        socket.setKeepAlive(true)
        resolve(socket)
      })
    })
  }
  const socket = await openSocket()
  socket.on("error", (data) => {
    console.error(data)
    socket.destroy()
  })

  socket.on("close", () => {
    console.debug("closing")
    clearInterval(heartbeat)
    // restart
    setTimeout(discoveryAndSubscribe, 1000)
  })

  socket.on("end", () => {
    console.debug("ended")
    socket.destroy()
  })

  socket.on("data", (data) => {
    if (data[0] === 0x30) {
      console.log("trigger relay!")
      rpio.write(pin, rpio.HIGH)
      setTimeout(() => {
        rpio.write(pin, rpio.LOW)
      }, 500)
    } else {
      console.debug(data)
    }
  })
  socket.write(connectionPacket)

  setTimeout(() => {
    console.debug("writing discovery")
    socket.write(discoveryPacket)
  }, 300)

  setTimeout(() => {
    console.debug("writing subscribe")
    socket.write(subscribePacket)
  }, 600)

  const ping = new Uint8Array([0xc0, 0])
  const heartbeat = setInterval(() => {
    socket.write(ping)
  }, 15000)
}

discoveryAndSubscribe()
