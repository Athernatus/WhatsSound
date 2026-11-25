import fs from 'node:fs'
import { generateMessageIDV2, prepareWAMessageMedia } from '@whiskeysockets/baileys'

const MARK = '__RAW__'

const varint = (n) => {
  const o = []
  while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128) }
  o.push(n)
  return Buffer.from(o)
}
const ld = (field, buf) => Buffer.concat([varint(field * 8 + 2), varint(buf.length), buf])
const vi = (field, n) => Buffer.concat([varint(field * 8), varint(n)])
const str = (s) => Buffer.from(String(s), 'utf8')
const num = (x) => (x == null ? 0 : typeof x === 'object' && 'toNumber' in x ? x.toNumber() : Number(x))

const normalize = (s) => {
  const raw = String(s || '').replace(/\D/g, '')
  return raw.startsWith('0') ? '62' + raw.slice(1) : raw
}

const ctxKey = (mediaKey) => ld(74, Buffer.concat([vi(1, 1), ld(2, Buffer.from(mediaKey))]))

export function installSound(sock, { logger, isAllowedJids, msgStore, defaultNumber }) {
  const rawMap = new Map()

  globalThis.__rawOverride = (m) => {
    const dp = m?.stickerMessage?.directPath
    if (typeof dp === 'string' && dp.startsWith(MARK)) {
      const r = rawMap.get(dp)
      if (r) return r
    }
    const d = m?.deviceSentMessage
    const dp2 = d?.message?.stickerMessage?.directPath
    if (typeof dp2 === 'string' && dp2.startsWith(MARK)) {
      const r = rawMap.get(dp2)
      if (r) return ld(31, Buffer.concat([ld(1, str(d.destinationJid || '')), ld(2, r)]))
    }
    return null
  }

  async function sendRaw(target, raw) {
    const id = generateMessageIDV2(sock.user?.id)
    const marker = MARK + id
    rawMap.set(marker, raw)
    if (rawMap.size > 100) rawMap.delete(rawMap.keys().next().value)

    const message = { stickerMessage: { mimetype: 'image/webp', directPath: marker } }
    msgStore.set(id, message)
    await sock.relayMessage(target, message, { messageId: id })
    return id
  }

  async function buildSoundSticker(webp, ogg, seconds) {
    const up = { upload: sock.waUploadToServer, logger }

    const st = (await prepareWAMessageMedia({ sticker: webp }, up)).stickerMessage
    const au = (
      await prepareWAMessageMedia(
        { audio: ogg, mimetype: 'audio/ogg; codecs=opus', seconds },
        up
      )
    ).audioMessage

    if (process.env.DEBUG_MEDIA === '1') {
      console.log('[SOUND DEBUG] payload inputs:', {
        webpBytes: webp.length,
        oggBytes: ogg.length,
        audioDurationMetadataSeconds: seconds,
        uploadedStickerBytes: num(st.fileLength),
        uploadedAudioBytes: num(au.fileLength),
        stickerTimestamp: num(st.mediaKeyTimestamp),
        audioTimestamp: num(au.mediaKeyTimestamp),
        stickerAnimatedFlag: true,
        nestedAudioField: 26,
      })
    }

    const now = Math.floor(Date.now() / 1000)

    const audioBytes = Buffer.concat([
      ld(1, str(au.url)),
      ld(2, str('audio/ogg; codecs=opus')),
      ld(3, Buffer.from(au.fileSha256)),
      vi(4, num(au.fileLength)),
      vi(5, seconds),
      ld(7, Buffer.from(au.mediaKey)),
      ld(8, Buffer.from(au.fileEncSha256)),
      ld(9, str(au.directPath)),
      vi(10, num(au.mediaKeyTimestamp) || now),
      ld(17, ctxKey(au.mediaKey)),
    ])

    const stickerBytes = Buffer.concat([
      ld(1, str(st.url)),
      ld(2, Buffer.from(st.fileSha256)),
      ld(3, Buffer.from(st.fileEncSha256)),
      ld(4, Buffer.from(st.mediaKey)),
      ld(5, str('image/webp')),
      vi(6, 512),
      vi(7, 512),
      ld(8, str(st.directPath)),
      vi(9, num(st.fileLength)),
      vi(10, num(st.mediaKeyTimestamp) || now),
      vi(13, 1),
      ld(17, ctxKey(st.mediaKey)),
      vi(18, Date.now()),
      vi(19, 0),
      vi(20, 0),
      vi(21, 0),
      vi(24, 0),
      ld(26, audioBytes),
    ])

    return ld(134, ld(1, ld(26, stickerBytes)))
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
        const n = normalize(arg) || defaultNumber
        const [info] = (await sock.onWhatsApp(n)) || []
        if (!info?.exists) {
          console.log('[CMD] Number is not registered on WhatsApp:', n)
          continue
        }
        if (cmd === '!tes') {
          const res = await sock.sendMessage(info.jid, { text: 'A quick test from the bot.' })
          if (res?.key?.id && res.message) msgStore.set(res.key.id, res.message)
          console.log('[TEST] Sent to', info.jid)
        } else {
          const id = await sendRaw(info.jid, fs.readFileSync('bin/inner.bin'))
          console.log('[REPLAY] Sent | id:', id)
        }
      } catch (e) {
        console.error('[CMD] Failed:', e)
      }
    }
  })

  return { sendRaw, buildSoundSticker }
}
