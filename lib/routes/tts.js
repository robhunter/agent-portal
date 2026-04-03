// tts.js — Text-to-speech route for output files
// Registered when GOOGLE_TTS_API_KEY env var is set

const fs = require('fs');
const path = require('path');
const https = require('https');
const { sendJSON } = require('../helpers');

/**
 * Strip markdown formatting to produce plain text suitable for TTS narration.
 */
function stripMarkdown(md) {
  return md
    // Remove frontmatter
    .replace(/^---[\s\S]*?---\n*/m, '')
    // Remove code blocks (fenced)
    .replace(/```[\s\S]*?```/g, '(code block omitted)')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove images
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Convert links to just text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove task list markers
    .replace(/^- \[[ x]\] /gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove blockquote markers
    .replace(/^>\s*/gm, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Call Google Cloud TTS API and return MP3 buffer.
 */
function synthesizeSpeech(text, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      input: { text },
      voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
      audioConfig: { audioEncoding: 'MP3' },
    });

    const options = {
      hostname: 'texttospeech.googleapis.com',
      path: `/v1/text:synthesize?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`TTS API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          if (!json.audioContent) {
            reject(new Error('No audio content in TTS response'));
            return;
          }
          resolve(Buffer.from(json.audioContent, 'base64'));
        } catch (e) {
          reject(new Error('Failed to parse TTS response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function register(routes, config) {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return; // Feature disabled if key absent

  const agentDir = config.agentDir || '.';
  const outputDir = path.join(agentDir, 'output');

  // GET /api/tts/status — check if TTS is available
  routes['GET /api/tts/status'] = (req, res) => {
    sendJSON(res, 200, { available: true });
  };

  // GET /api/tts/:filename — get or generate MP3 for output file
  routes['GET /api/tts/:filename'] = async (req, res) => {
    const filename = req.params.filename;
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }

    const mdPath = path.join(outputDir, filename);
    if (!fs.existsSync(mdPath)) {
      return sendJSON(res, 404, { error: 'Output file not found' });
    }

    // Check for cached MP3 alongside the output file
    const mp3Filename = filename.replace(/\.md$/, '.mp3');
    const mp3Path = path.join(outputDir, mp3Filename);

    if (fs.existsSync(mp3Path)) {
      // Serve from disk cache
      const mp3 = fs.readFileSync(mp3Path);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3.length,
        'X-TTS-Cache': 'hit',
      });
      res.end(mp3);
      return;
    }

    // Generate: read markdown, strip formatting, call TTS API
    try {
      const markdown = fs.readFileSync(mdPath, 'utf-8');
      const plainText = stripMarkdown(markdown);

      if (!plainText) {
        return sendJSON(res, 400, { error: 'Output file has no text content' });
      }

      // Google TTS has a 5000 byte limit per request — chunk if needed
      const chunks = [];
      const maxChunkSize = 4500; // Leave margin below 5000
      let remaining = plainText;
      while (remaining.length > 0) {
        if (remaining.length <= maxChunkSize) {
          chunks.push(remaining);
          break;
        }
        // Find a sentence boundary to split on
        let splitAt = remaining.lastIndexOf('. ', maxChunkSize);
        if (splitAt < maxChunkSize / 2) splitAt = remaining.lastIndexOf('\n', maxChunkSize);
        if (splitAt < maxChunkSize / 2) splitAt = maxChunkSize;
        chunks.push(remaining.substring(0, splitAt + 1));
        remaining = remaining.substring(splitAt + 1).trimStart();
      }

      // Synthesize each chunk
      const audioBuffers = [];
      for (const chunk of chunks) {
        const audio = await synthesizeSpeech(chunk, apiKey);
        audioBuffers.push(audio);
      }

      // Concatenate MP3 buffers (MP3 frames are independently decodable)
      const mp3Buffer = Buffer.concat(audioBuffers);

      // Cache to disk
      try {
        fs.writeFileSync(mp3Path, mp3Buffer);
      } catch (e) {
        console.error('Failed to cache TTS MP3:', e.message);
        // Non-fatal — still serve the audio
      }

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3Buffer.length,
        'X-TTS-Cache': 'miss',
      });
      res.end(mp3Buffer);
    } catch (e) {
      console.error('TTS generation failed:', e.message);
      sendJSON(res, 500, { error: 'TTS generation failed: ' + e.message });
    }
  };
}

module.exports = { register, stripMarkdown };
