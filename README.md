# WhatsApp Sound Sticker Bot

A small Baileys bot that turns videos or GIFs into animated WhatsApp stickers. It can use a video's own audio or pair a visual with a separate audio file.

## Requirements

- Node.js 20 or newer
- FFmpeg and `ffprobe` available on `PATH`
- A WhatsApp account to link as a companion device

## Setup

1. Install the dependencies:

   ```sh
   npm install
   ```

2. Open `src/config.js` and set `MY_NUMBER` to your WhatsApp number with country code and digits only. For example, use `1...` for a US number or `62...` for an Indonesian number.

3. Apply the Baileys patches required for raw sound-sticker messages:

   ```sh
   node patch.mjs
   node patch2.mjs
   ```

   Run these again after reinstalling dependencies, since they patch files under `node_modules`.

4. Start the bot:

   ```sh
   node index.js
   ```

5. Scan the QR code from WhatsApp under **Linked Devices**.

The first run creates an `auth` folder for the linked-device session. Keep it private; deleting it logs the bot out.

## Make stickers

Send media to the linked bot from the configured number.

| Input | Result |
| --- | --- |
| Video with caption `!sound` | Animated sticker with audio extracted from the video |
| GIF or video with caption `!ASticker`, then an audio file or voice note | Animated sticker paired with the next audio message |
| Video without a callout | Animated sticker without sound |
| Text `!ping` | Replies `pong` |

For `!ASticker`, send the audio within five minutes. No audio caption is needed. The bot pairs it with the waiting visual from the same chat and sender. If several visuals are sent, the latest one replaces the previous pending visual.

The output uses the shorter of the visual and audio durations, capped at 10 seconds. The visual is scaled to fill a square sticker, so the center crop may trim the edges. Bars already baked into the source video are not removed automatically.

## Debug logging

In PowerShell, enable media timing and raw message dumps before starting the bot:

```powershell
$env:DEBUG_MEDIA='1'
$env:DEBUG_DUMP='1'
node index.js
```

Set either variable to `0` or remove it to disable that debug output. Raw dumps are written under `bin/` and may contain message metadata; keep them private.
