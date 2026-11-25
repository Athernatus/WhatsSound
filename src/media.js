import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'
import { DEBUG_MEDIA } from './config.js'

const run = promisify(execFile)

async function probeMedia(file) {
  const result = await run('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-count_frames', '-of', 'json', file,
  ])
  return JSON.parse(result.stdout)
}

function mediaSummary(probe) {
  return {
    format: probe.format && {
      name: probe.format.format_name,
      start: probe.format.start_time,
      duration: probe.format.duration,
    },
    streams: (probe.streams || []).map((stream) => ({
      type: stream.codec_type,
      codec: stream.codec_name,
      start: stream.start_time,
      duration: stream.duration,
      frames: stream.nb_read_frames ?? stream.nb_frames,
      fps: stream.avg_frame_rate,
      sampleRate: stream.sample_rate,
      channels: stream.channels,
    })),
  }
}

async function webpFrameSummary(file) {
  const result = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time',
    '-of', 'json', file,
  ])
  const frames = JSON.parse(result.stdout).frames || []
  return {
    count: frames.length,
    firstPts: frames[0]?.best_effort_timestamp_time,
    lastPts: frames.at(-1)?.best_effort_timestamp_time,
    lastFrameDuration: frames.at(-1)?.pkt_duration_time,
  }
}

async function makeWebp(inputFile, outputFile, fps, quality, duration = 10) {
  await run('ffmpeg', [
    '-y', '-i', inputFile, '-t', String(duration),
    '-vf', `fps=${fps},scale=512:512:force_original_aspect_ratio=increase,crop=512:512`,
    '-c:v', 'libwebp', '-loop', '0', '-q:v', String(quality), '-an',
    outputFile,
  ])
  return fs.readFile(outputFile)
}

async function videoToSticker(videoBuffer) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const inputFile = path.join(os.tmpdir(), `in-${id}.mp4`)
  const outputFile = path.join(os.tmpdir(), `out-${id}.webp`)
  await fs.writeFile(inputFile, videoBuffer)
  try {
    return await makeWebp(inputFile, outputFile, 15, 50)
  } finally {
    await fs.rm(inputFile, { force: true })
    await fs.rm(outputFile, { force: true })
  }
}

function durationOf(probe, type) {
  const stream = (probe.streams || []).find((item) => item.codec_type === type)
  for (const value of [stream?.duration, probe.format?.duration]) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds > 0) return seconds
  }
  return null
}

async function videoToParts(videoBuffer, audioBuffer = null, visualExt = '.mp4') {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const visualFile = path.join(os.tmpdir(), `visual-${id}${visualExt}`)
  const separateAudioFile = path.join(os.tmpdir(), `audio-${id}.bin`)
  const webpFile = path.join(os.tmpdir(), `sticker-${id}.webp`)
  const oggFile = path.join(os.tmpdir(), `sticker-${id}.ogg`)
  await fs.writeFile(visualFile, videoBuffer)
  if (audioBuffer) await fs.writeFile(separateAudioFile, audioBuffer)

  try {
    const visualInfo = await probeMedia(visualFile)
    const audioSourceFile = audioBuffer ? separateAudioFile : visualFile
    const audioInfo = audioBuffer ? await probeMedia(audioSourceFile) : visualInfo
    const visualDuration = durationOf(visualInfo, 'video')
    const audioDuration = durationOf(audioInfo, 'audio')
    if (!visualDuration) throw new Error('BAD_VISUAL_DURATION')
    if (!audioDuration) throw new Error(audioBuffer ? 'BAD_AUDIO_DURATION' : 'NO_AUDIO')

    let fps = 15
    const shortest = Math.min(visualDuration, audioDuration, 10)
    let frameCount = Math.floor(shortest * fps + 1e-6)
    if (frameCount < 1) throw new Error('MEDIA_TOO_SHORT')
    let duration = frameCount / fps

    if (DEBUG_MEDIA) {
      console.log('[MEDIA DEBUG] visual input:', util.inspect(mediaSummary(visualInfo), { depth: null, colors: false }))
      console.log('[MEDIA DEBUG] audio input:', util.inspect(mediaSummary(audioInfo), { depth: null, colors: false }))
    }

    let webp = await makeWebp(visualFile, webpFile, fps, 50, duration)
    if (webp.length > 900 * 1024) {
      fps = 10
      frameCount = Math.floor(shortest * fps + 1e-6)
      if (frameCount < 1) throw new Error('MEDIA_TOO_SHORT')
      duration = frameCount / fps
      webp = await makeWebp(visualFile, webpFile, fps, 35, duration)
    }

    if (DEBUG_MEDIA) {
      console.log('[MEDIA DEBUG] common duration:', {
        visualSeconds: visualDuration,
        audioSeconds: audioDuration,
        selectedSeconds: duration,
        selectedFrames: frameCount,
        fps,
      })
    }

    await run('ffmpeg', [
      '-y', '-i', audioSourceFile, '-map', '0:a:0', '-t', String(duration), '-vn',
      '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000',
      oggFile,
    ])
    const ogg = await fs.readFile(oggFile)

    if (DEBUG_MEDIA) {
      try {
        const [webpInfo, oggInfo, frames] = await Promise.all([
          probeMedia(webpFile), probeMedia(oggFile), webpFrameSummary(webpFile),
        ])
        console.log('[MEDIA DEBUG] output WebP:', util.inspect(mediaSummary(webpInfo), { depth: null, colors: false }))
        console.log('[MEDIA DEBUG] WebP frames:', frames)
        console.log('[MEDIA DEBUG] output OGG:', util.inspect(mediaSummary(oggInfo), { depth: null, colors: false }))
      } catch (error) {
        console.warn('[MEDIA DEBUG] output probe failed:', error.message)
      }
    }

    const result = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', oggFile,
    ])
    const seconds = Math.min(10, Math.max(1, Math.ceil(parseFloat(result.stdout) || 1)))
    if (DEBUG_MEDIA) {
      console.log('[MEDIA DEBUG] audio duration:', result.stdout.trim(), 's | sticker metadata:', seconds, 's')
    }
    return { webp, ogg, seconds }
  } finally {
    await fs.rm(visualFile, { force: true })
    if (audioBuffer) await fs.rm(separateAudioFile, { force: true })
    await fs.rm(webpFile, { force: true })
    await fs.rm(oggFile, { force: true })
  }
}

export { videoToParts, videoToSticker }
