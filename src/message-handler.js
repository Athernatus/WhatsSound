import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { chatJids, isAllowedJids, learnLid } from './config.js'
import { videoToParts, videoToSticker } from './media.js'

export function installMessageHandler(sock, { logger, msgStore, sendRaw, buildSoundSticker }) {
  const sentIds = new Set()
  const pendingVisuals = new Map()

  const send = async (jid, content) => {
    const result = await sock.sendMessage(jid, content)
    if (result?.key?.id) {
      sentIds.add(result.key.id)
      if (result.message) msgStore.set(result.key.id, result.message)
    }
    return result
  }

  const download = (message) => downloadMediaMessage(message, 'buffer', {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage,
  })

  async function sendSoundSticker(jid, visualBuffer, visualExt, audioBuffer = null) {
    const { webp, ogg, seconds } = await videoToParts(visualBuffer, audioBuffer, visualExt)
    console.log('[SOUND] WebP:', (webp.length / 1024).toFixed(0), 'KB | OGG:',
      (ogg.length / 1024).toFixed(0), 'KB | duration metadata:', seconds, 's')
    const raw = await buildSoundSticker(webp, ogg, seconds)
    const id = await sendRaw(jid, raw)
    sentIds.add(id)
    console.log('[SOUND] Sent | id:', id)
  }

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (sentIds.has(msg.key.id)) continue

      learnLid(msg.key)
      if (!isAllowedJids(chatJids(msg.key))) {
        console.log('[IGNORED] chat:', msg.key.remoteJid, '| alt:', msg.key.remoteJidAlt)
        continue
      }
      if (!msg.message) continue

      const jid = msg.key.remoteJid
      const message = msg.message
      const text = message.conversation || message.extendedTextMessage?.text || ''
      const sender = msg.key.participant || msg.key.participantAlt || ''
      const pairKey = `${jid}|${sender}`

      if (text.trim().toLowerCase() === '!audio') {
        if (pendingVisuals.has(pairKey)) {
          await send(jid, { text: 'I’m waiting for your audio. Send a voice note or audio file next; no caption is needed.' })
        } else {
          await send(jid, { text: 'I don’t have a visual waiting. Send a GIF or video with the caption !ASticker first.' })
        }
        continue
      }

      if (text.trim() === '!ping') {
        await send(jid, { text: 'pong' })
        continue
      }

      const video = message.videoMessage
      const document = message.documentMessage
      const image = message.imageMessage
      const documentName = document?.fileName || ''
      const isAudioDocument = Boolean(document && (
        document.mimetype?.toLowerCase().startsWith('audio/') ||
        /\.(aac|amr|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/i.test(documentName)
      ))
      const audio = message.audioMessage || (isAudioDocument ? document : null)
      const visualDocument = document && (
        document.mimetype?.toLowerCase() === 'image/gif' ||
        document.mimetype?.toLowerCase().startsWith('video/')
      ) ? document : null
      const visualGifImage = image?.mimetype?.toLowerCase() === 'image/gif' ? image : null
      const caption = video?.caption || visualDocument?.caption || visualGifImage?.caption || ''
      const callout = caption.trim().toLowerCase()
      const wantsEmbeddedSound = callout.startsWith('!sound')
      const wantsSeparateAudio = callout.startsWith('!asticker')

      if (audio) {
        const pending = pendingVisuals.get(pairKey)
        if (!pending) continue
        pendingVisuals.delete(pairKey)
        if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
          await send(jid, { text: 'That visual expired. Send it again with the caption !ASticker, then send your audio.' })
          continue
        }

        try {
          await send(jid, { text: 'Got the audio. Making your sound sticker...' })
          const audioBuffer = await download(msg)
          await sendSoundSticker(jid, pending.visualBuffer, pending.visualExt, audioBuffer)
        } catch (error) {
          console.error('[SOUND] Failed:', error)
          const response = error?.message === 'BAD_AUDIO_DURATION'
            ? 'I couldn’t read that audio file. Try another one.'
            : error?.message === 'BAD_VISUAL_DURATION'
              ? 'I couldn’t read the GIF/video duration. Try another visual.'
              : error?.message === 'MEDIA_TOO_SHORT'
                ? 'That GIF/video or audio is too short to make a sticker.'
                : 'Couldn’t make the sound sticker. Try another GIF/video or audio file.'
          await send(jid, { text: response })
        }
        continue
      }

      const isGifDocument = visualDocument?.mimetype?.toLowerCase() === 'image/gif'
      const isVisual = Boolean(video || ((wantsEmbeddedSound || wantsSeparateAudio) && (visualDocument || visualGifImage)))
      if (!isVisual) continue

      try {
        if (video && (video.seconds || 0) > 20) {
          await send(jid, { text: 'That video is a bit long. Keep it under 20 seconds, please.' })
          continue
        }

        if (wantsSeparateAudio) {
          const visualBuffer = await download(msg)
          const visualExt = isGifDocument || visualGifImage ? '.gif' : '.mp4'
          pendingVisuals.set(pairKey, { visualBuffer, visualExt, createdAt: Date.now() })
          await send(jid, { text: 'Visual ready. Send a voice note or audio file next—no caption needed. I’ll pair it for 5 minutes.' })
          continue
        }

        if (wantsEmbeddedSound) {
          if (!video) {
            await send(jid, { text: 'The !sound option needs a video with audio. Use !ASticker to pair a separate audio file.' })
            continue
          }
          await send(jid, { text: 'Extracting visual and audio...' })
          await sendSoundSticker(jid, await download(msg))
          continue
        }

        if (!video) continue
        await send(jid, { text: 'Making your sticker...' })
        const webp = await videoToSticker(await download(msg))
        console.log('[STICKER] Size:', (webp.length / 1024).toFixed(0), 'KB')
        await send(jid, { sticker: webp })
      } catch (error) {
        console.error('[MEDIA] Failed:', error)
        const response = error?.message === 'NO_AUDIO'
          ? 'This video has no audio track. Use !ASticker if you want to pair separate audio.'
          : error?.message === 'BAD_VISUAL_DURATION'
            ? 'I couldn’t read the video duration. Try another video.'
            : error?.message === 'MEDIA_TOO_SHORT'
              ? 'That video is too short to make a sticker.'
              : 'Couldn’t make the sticker. Try another video.'
        await send(jid, { text: response })
      }
    }
  })
}
