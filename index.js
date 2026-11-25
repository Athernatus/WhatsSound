import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { installSound } from './sound.js'
import { ALLOWED, MY_NUMBER, bare, isAllowedJids } from './src/config.js'
import { installMessageHandler } from './src/message-handler.js'
import { installRawDebug } from './src/raw-debug.js'

const logger = pino({ level: 'silent' })
const originalInfo = console.info.bind(console)
console.info = (...args) => {
  if (typeof args[0] === 'string' && /^(Closing|Opening) session/.test(args[0])) return
  originalInfo(...args)
}

installRawDebug()

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const { version } = await fetchLatestBaileysVersion()
  const msgStore = new Map()
  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    getMessage: async (key) => msgStore.get(key.id),
  })

  const sound = installSound(sock, {
    logger,
    isAllowedJids,
    msgStore,
    defaultNumber: MY_NUMBER,
  })
  installMessageHandler(sock, { logger, msgStore, ...sound })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('Scan this QR code in WhatsApp > Linked Devices:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      console.log('Connected as', sock.user.id)
      try {
        const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(`${MY_NUMBER}@s.whatsapp.net`)
        if (lid) {
          ALLOWED.add(bare(lid))
          console.log('[ALLOWED] Your LID:', bare(lid))
        }
      } catch {}
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        console.log('Connection closed. Reconnecting...')
        start()
      } else {
        console.log('Logged out. Remove the auth folder and scan a new QR code.')
      }
    }
  })
}

start()
