import fs from 'node:fs'

const file = 'node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.js'
let src = fs.readFileSync(file, 'utf8')

const target =
  "let msg = proto.Message.decode(e2eType !== 'plaintext' ? unpadRandomMax16(msgBuffer) : msgBuffer);"

if (src.includes('__rawDump')) {
  console.log('Already patched; no changes made.')
} else if (!src.includes(target)) {
  console.log('Target line not found. Check the installed Baileys version.')
} else {
  fs.copyFileSync(file, file + '.bak')
  src = src.replace(
    target,
    "const __plain = e2eType !== 'plaintext' ? unpadRandomMax16(msgBuffer) : msgBuffer; " +
      "try { globalThis.__rawDump?.(author, stanza.attrs, __plain) } catch {} " +
      'let msg = proto.Message.decode(__plain);'
  )
  fs.writeFileSync(file, src)
  console.log('Patch applied. Backup: decode-wa-message.js.bak')
}
