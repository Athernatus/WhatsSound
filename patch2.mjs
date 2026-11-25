import fs from 'node:fs'

const file = 'node_modules/@whiskeysockets/baileys/lib/Utils/generics.js'
let src = fs.readFileSync(file, 'utf8')

const target =
  'export const encodeWAMessage = (message) => writeRandomPadMax16(proto.Message.encode(message).finish());'

if (src.includes('__rawOverride')) {
  console.log('Already patched.')
} else if (!src.includes(target)) {
  console.log('Target line not found. Check the installed Baileys version.')
} else {
  fs.copyFileSync(file, file + '.bak')
  src = src.replace(
    target,
    'export const encodeWAMessage = (message) => { ' +
      'const __raw = globalThis.__rawOverride?.(message); ' +
      'return writeRandomPadMax16(__raw ? __raw : proto.Message.encode(message).finish()); };'
  )
  fs.writeFileSync(file, src)
  console.log('Patch applied. Backup: generics.js.bak')
}
