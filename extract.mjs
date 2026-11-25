import fs from 'node:fs'

function readVarint(buf, pos) {
  let result = 0, shift = 0
  while (true) {
    const b = buf[pos++]
    result += (b & 0x7f) * 2 ** shift
    if (!(b & 0x80)) break
    shift += 7
  }
  return [result, pos]
}

function getField(buf, wanted) {
  let pos = 0
  while (pos < buf.length) {
    let tag
    ;[tag, pos] = readVarint(buf, pos)
    const field = Math.floor(tag / 8), wt = tag & 7
    if (wt === 0) [, pos] = readVarint(buf, pos)
    else if (wt === 1) pos += 8
    else if (wt === 5) pos += 4
    else if (wt === 2) {
      let len
      ;[len, pos] = readVarint(buf, pos)
      if (field === wanted) return buf.subarray(pos, pos + len)
      pos += len
    } else throw new Error('wire type ' + wt)
  }
  return null
}

const src = fs.readFileSync(process.argv[2])
const sent = getField(src, 31)
const inner = sent && getField(sent, 2)
if (!inner) throw new Error('Field 31.2 was not found')

fs.writeFileSync('bin/inner.bin', inner)
console.log('Saved bin/inner.bin:', inner.length, 'bytes')
console.log('Contains field 134:', !!getField(inner, 134))
