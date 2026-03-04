'use strict';

const fetch = require('cross-fetch');

/** @constant {string} The Whisper model used for audio transcription. */
const GROQ_MODEL = 'whisper-large-v3';

/** @constant {string} Groq API base URL. */
const GROQ_BASE = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * @class VoiceTranscriber
 * @classdesc Handles downloading WhatsApp voice messages from the Meta Graph API
 * and transcribing them to text using the Groq Whisper API.
 * 
 * Audio is fetched in-memory as a Buffer and sent directly to Groq 
 * as multipart/form-data. This natively handles WhatsApp's OGG/Opus format.
 *
 * @example
 * const transcriber = new VoiceTranscriber();
 * const text = await transcriber.transcribeAudio('media-id-123', 'meta-access-token', 'groq-api-key');
 * console.log(text); // "Spegni la luce dello studio"
 */
class VoiceTranscriber {

  /**
   * Downloads a WhatsApp media file from the Meta Graph API.
   *
   * @private
   * @param {string} mediaId - The WhatsApp media asset ID.
   * @param {string} accessToken - A valid Meta Cloud API token.
   * @returns {Promise<{buffer: Buffer, mimeType: string}>} The raw audio buffer and MIME type.
   */
  async _downloadMedia(mediaId, accessToken) {
    // Step 1: resolve the temporary download URL
    const metaUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
    const metaRes = await fetch(metaUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!metaRes.ok) {
      throw new Error(`Failed to resolve media URL for id ${mediaId}: ${metaRes.status}`);
    }

    const metaData = await metaRes.json();
    const downloadUrl = metaData.url;
    const rawMime = metaData.mime_type || 'audio/ogg';
    const mimeType = rawMime.split(';')[0].trim(); // Normalize to 'audio/ogg'

    if (!downloadUrl) {
      throw new Error(`No download URL returned for media id ${mediaId}`);
    }

    // Step 2: download the binary content
    const audioRes = await fetch(downloadUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!audioRes.ok) {
      throw new Error(`Failed to download audio file: ${audioRes.status}`);
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    this._log && this._log(`[VoiceTranscriber] Audio buffer downloaded: ${buffer.length} bytes, MIME: ${mimeType}`);

    return { buffer, mimeType };
  }

  /**
   * Transcribes a WhatsApp voice message to text using the Groq Whisper API.
   *
   * @public
   * @param {string} mediaId - The WhatsApp media asset ID.
   * @param {string} accessToken - A valid Meta Cloud API token.
   * @param {string} groqApiKey - A valid Groq API key.
   * @returns {Promise<string>} The transcribed text.
   */
  async transcribeAudio(mediaId, accessToken, groqApiKey) {
    const { buffer, mimeType } = await this._downloadMedia(mediaId, accessToken);

    // Build multipart/form-data payload manually
    const boundary = `----GroqBoundary${Date.now()}`;
    const filename = `audio_message.ogg`;

    const parts = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${GROQ_MODEL}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`)
    ];

    const body = Buffer.concat(parts);

    const groqRes = await fetch(GROQ_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });

    if (!groqRes.ok) {
      const errData = await groqRes.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Groq API error: ${groqRes.status}`);
    }

    const groqData = await groqRes.json();

    if (!groqData.text) {
      throw new Error('Groq returned an empty transcription');
    }

    return groqData.text.trim();
  }
}

module.exports = VoiceTranscriber;
