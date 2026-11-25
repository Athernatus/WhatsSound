import fs from 'node:fs'
import util from 'node:util'
import { DEBUG_DUMP, isAllowedJids } from './config.js'

function readVarint(buffer, position) {
  let result = 0n
  let shift = 0n
  while (true) {
    if (position >= buffer.length) throw new Error('Unexpected end of buffer')
    const byte = buffer[position++]
    result |= BigInt(byte & 0x7f) << shift
    if (!(byte & 0x80)) break
    shift += 7n
  }
  return [result, position]
}

function looksLikeText(buffer) {
  if (!buffer.length) return false
  let printable = 0
  for (const byte of buffer) {
    if ((byte >= 32 && byte < 127) || byte >= 192) printable++
  }
  return printable / buffer.length > 0.9
}

function parseWire(buffer, depth = 0) {
  const fields = []
  let position = 0
  try {
    while (position < buffer.length) {
      let tag
      ;[tag, position] = readVarint(buffer, position)
      const field = Number(tag >> 3n)
      const wireType = Number(tag & 7n)
      if (!field) return null

      if (wireType === 0) {
        let value
        ;[value, position] = readVarint(buffer, position)
        fields.push({ field, varint: value.toString() })
      } else if (wireType === 1) {
        if (position + 8 > buffer.length) return null
        fields.push({ field, fixed64: true })
        position += 8
      } else if (wireType === 5) {
        if (position + 4 > buffer.length) return null
        fields.push({ field, fixed32: true })
        position += 4
      } else if (wireType === 2) {
        let length
        ;[length, position] = readVarint(buffer, position)
        length = Number(length)
        if (position + length > buffer.length) return null
        const value = buffer.subarray(position, position + length)
        position += length
        const entry = { field, len: length }
        if (looksLikeText(value)) {
          entry.text = Buffer.from(value).toString('utf8').slice(0, 60)
        } else {
          const nested = depth < 6 && length > 0 ? parseWire(value, depth + 1) : null
          if (nested) entry.nested = nested
          else entry.hex = Buffer.from(value.subarray(0, 8)).toString('hex') + (length > 8 ? '...' : '')
        }
        fields.push(entry)
      } else {
        return null
      }
    }
  } catch {
    return null
  }
  return fields
}

export function installRawDebug() {
  fs.mkdirSync('bin', { recursive: true })
  globalThis.__rawDump = (author, attrs, plain) => {
    if (!DEBUG_DUMP) return
    const jids = [author, ...Object.values(attrs || {}).filter((value) => typeof value === 'string' && value.includes('@'))]
    if (!isAllowedJids(jids)) return
    const buffer = Buffer.from(plain)
    const file = `bin/plain-${attrs?.id || Date.now()}-${buffer.length}b.bin`
    fs.writeFileSync(file, buffer)
    console.log('[PLAINTEXT] id:', attrs?.id, '| bytes:', buffer.length, '| file:', file)
    console.log(util.inspect(parseWire(buffer), { depth: null, breakLength: 100 }))
  }
}
