import { createConnection } from "node:net"
import rpio from "rpio"
import { controlCodes, decodePacket, packitup, rawString } from "./mqtt.js"

const buttonId = process.env.BUTTONID
const buttons = []
if (buttonId) {
  for (let i = 0; i < 4; i++) {
    buttons[i] = buttonId.replace(/(\d+)$/, (a) => Number(a) + i)
  }
} else {
  console.log("must have button id")
  process.exit(1)
}
const pin = 31
rpio.open(pin, rpio.OUTPUT, rpio.LOW)

const pingInterval = 15_000
const connectionDelay = 15_000

const clientId = process.env.CLIENTID

if (!clientId) {
  console.log("must have unique client id")
  process.exit(1)
}
const connection = () => {
  const protocol = rawString("MQTT")
  const dv = new DataView(new ArrayBuffer(5))
  dv.setUint8(0, 5)
  const flags =
    0b10000000 | // user flag
    0b01000000 | // password flag
    0b00000010 // clean start
  // flag uint8
  dv.setUint8(1, flags)
  dv.setUint16(2, 60) // keep alive
  // properties - hard code to nothing
  dv.setUint8(4, 0)
  // client id name
  const client = rawString(clientId)
  const user = rawString(process.env.USERNAME)
  const pass = rawString(process.env.PASSWORD)
  return packitup(new Blob([protocol, dv.buffer, client, user, pass]), 0x10)
}

const discovery = (buttonIndex) => {
  const config = rawString(`homeassistant/button/${buttons[buttonIndex]}/config`)
  const dv = new DataView(new ArrayBuffer(1))
  dv.setUint8(0, 0)
  const json = {
    name: "Door 31",
    unique_id: buttons[buttonIndex],
    platform: "button",
    command_topic: `homeassistant/button/${buttons[buttonIndex]}/set`,
  }
  const button = rawString(JSON.stringify(json), false)
  return packitup(new Blob([config, dv.buffer, button]), 0b110000)
}

const subscribe = () => {
  const header = new DataView(new ArrayBuffer(3))
  header.setUint16(0, 1470)
  header.setUint8(2, 0)
  const topic = rawString(`homeassistant/button/${buttons[0]}/set`)
  const dv = new DataView(new ArrayBuffer(1))
  dv.setUint8(0, 2)
  return packitup(new Blob([header.buffer, topic, dv.buffer]), 0x82)
}

const connectionPacket = await connection().bytes()
const discoveryPacket = await discovery(0).bytes()
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
  let socket
  try {
    socket = await openSocket()
  } catch (err) {
    console.log(err)
    setTimeout(discoveryAndSubscribe, connectionDelay)
    return
  }

  socket.on("error", (data) => {
    console.error(data)
    socket.destroy()
  })

  socket.on("close", () => {
    console.debug("closing")
    clearInterval(heartbeat)
    // restart
    setTimeout(discoveryAndSubscribe, connectionDelay)
  })

  socket.on("end", () => {
    console.debug("ended")
    socket.destroy()
  })

  socket.on("data", (data) => {
    const { controlCode, topicName, payload } = decodePacket(data)
    socket.emit("mqtt.response", controlCode)
    if (controlCode === controlCodes[3]) {
      console.log({ controlCode, topicName, payload })
      rpio.write(pin, rpio.HIGH)
      setTimeout(() => {
        rpio.write(pin, rpio.LOW)
      }, 500)
    }
  })

  await new Promise((resolve, reject) => {
    socket.once("mqtt.response", (evt) => {
      if (evt === controlCodes[2]) {
        resolve()
      }
    })
    socket.write(connectionPacket)
  })

  console.debug("writing discovery")
  socket.write(discoveryPacket)

  console.debug("writing subscribe")
  await new Promise((resolve, reject) => {
    socket.once("mqtt.response", (evt) => {
      if (evt === controlCodes[9]) {
        resolve()
      }
    })
    socket.write(subscribePacket)
  })

  const ping = new Uint8Array([0xc0, 0])
  const heartbeat = setInterval(() => {
    socket.write(ping)
  }, pingInterval)
}

discoveryAndSubscribe()
