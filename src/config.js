// Fill this variable below with your own phone number,
export const MY_NUMBER = '6282350313476'
export const DEBUG_DUMP = process.env.DEBUG_DUMP === '1'
export const DEBUG_MEDIA = process.env.DEBUG_MEDIA === '1'

export const ALLOWED = new Set([MY_NUMBER])

export const bare = (jid) => String(jid).split('@')[0].split(':')[0]

export const isAllowedJids = (list) => list.some((jid) => jid && ALLOWED.has(bare(jid)))

export const chatJids = (key) => [
  key.remoteJid,
  key.remoteJidAlt,
  key.participant,
  key.participantAlt,
]

export function learnLid(key) {
  const alternateJids = [key.remoteJidAlt, key.participantAlt].filter(Boolean)
  const primaryJids = [key.remoteJid, key.participant].filter(Boolean)
  if (!alternateJids.some((jid) => ALLOWED.has(bare(jid)))) return

  for (const jid of primaryJids) {
    if (String(jid).endsWith('@lid') && !ALLOWED.has(bare(jid))) {
      ALLOWED.add(bare(jid))
      console.log('[ALLOWED] Learned LID:', bare(jid))
    }
  }
}
