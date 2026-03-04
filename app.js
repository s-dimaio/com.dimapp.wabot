'use strict';

const Homey = require('homey');
const fetch = require('cross-fetch');
const VoiceTranscriber = require('./lib/VoiceTranscriber');

module.exports = class WhatsAppBotApp extends Homey.App {

  /**
   * Initializes the WhatsApp Bot application.
   * Sets up Flow cards.
   */
  async onInit() {
    this.log('WhatsApp Bot App has been initialized');

    // Register Flow Trigger Card
    this._messageReceivedTrigger = this.homey.flow.getTriggerCard('whatsapp_message_received');

    // Register Flow Action Card
    const sendMessageAction = this.homey.flow.getActionCard('send_whatsapp_message');

    // Provide authorized users to the autocomplete dropdown for the contact field
    sendMessageAction.registerArgumentAutocompleteListener('recipient_contact', async (query, args) => {
      const users = this.getAllowedUsers();
      const results = users.map(user => ({
        name: user.name || user.id,
        description: user.id,
        id: user.id
      }));

      // Filter based on user search query
      const lowerQuery = query.toLowerCase();
      return results.filter(res =>
        res.name.toLowerCase().includes(lowerQuery) ||
        res.id.includes(lowerQuery)
      );
    });

    sendMessageAction.registerRunListener(async (args, state) => {
      this.log('Action card triggered: send_whatsapp_message');

      const byContact = args.recipient_contact;
      const byNumber = args.recipient_number;

      const hasContact = typeof byContact === 'object' && byContact !== null && byContact.id;
      const hasNumber = typeof byNumber === 'string' && byNumber.trim() !== '';

      if (hasContact && hasNumber) {
        throw new Error(this.homey.__('settings.action_error_both_recipients'));
      }
      if (!hasContact && !hasNumber) {
        throw new Error(this.homey.__('settings.action_error_no_recipient'));
      }

      const recipient = hasContact ? byContact.id : byNumber.trim();

      await this.sendWhatsappMessage(recipient, args.message_text);
      return true;
    });
  }

  /**
   * Marks an incoming WhatsApp message as read, producing the double blue tick on the sender's side.
   * Reads credentials from Homey settings. Fails silently to avoid disrupting the main message flow.
   *
   * @param {string} messageId - The WhatsApp message ID (wamid) to mark as read.
   * @returns {Promise<void>}
   * @example
   * // Called automatically from api.js after receiving a webhook message:
   * await this.markMessageAsRead('wamid.HBgN...');
   * @public
   */
  async markMessageAsRead(messageId) {
    const accessToken = this.homey.settings.get('access_token');
    const phoneId = this.homey.settings.get('phone_id');

    if (!accessToken || !phoneId) return;

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        })
      });
      this.log(`Message ${messageId} marked as read.`);
    } catch (error) {
      this.error('Failed to mark message as read:', error);
    }
  }

  /**
   * Triggers the "whatsapp_message_received" flow card.
   * @param {string} messageText - The text content of the received message.
   * @param {string} senderNumber - The phone number of the sender.
   * @public
   */
  async triggerMessageReceived(messageText, senderNumber) {
    try {
      this.log(`Triggering flow for message from ${senderNumber}`);
      await this._messageReceivedTrigger.trigger({
        message_text: messageText,
        sender_number: senderNumber
      });
    } catch (err) {
      this.error('Error triggering message received flow:', err);
    }
  }

  /**
   * Sends a WhatsApp text message using the Meta Cloud API.
   * reads credentials from Homey settings.
   * @param {string} recipient - The phone number to send the message to (e.g. "393331234567").
   * @param {string} text - The content of the message.
   * @public
   */
  async sendWhatsappMessage(recipient, text) {
    const accessToken = this.homey.settings.get('access_token');
    const phoneId = this.homey.settings.get('phone_id');

    if (!accessToken || !phoneId) {
      this.error('Cannot send message: Access Token or Phone Number ID is missing in settings.');
      throw new Error('Missing credentials in app settings.');
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: {
        preview_url: false,
        body: text
      }
    };

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

    this.log(`Sending message to ${recipient}...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        this.error('Failed to send WhatsApp message:', JSON.stringify(data));
        throw new Error(data.error?.message || 'Unknown API error');
      }

      this.log('Message sent successfully:', data.messages[0].id);
      return data;
    } catch (error) {
      this.error('Network or API Error sending WhatsApp message:', error);
      throw error;
    }
  }

  /**
   * Retrieves the list of allowed users from Homey settings.
   * @returns {Array<{id: string, name: string}>}
   * @public
   */
  getAllowedUsers() {
    return this.homey.settings.get('allowed_users') || [];
  }

  /**
   * Checks if a phone number is authorized to use the bot.
   * @param {string} phone - The phone number to check.
   * @returns {boolean} True if allowed, false otherwise.
   * @public
   */
  isUserAllowed(phone) {
    const users = this.getAllowedUsers();
    return users.some(u => u.id === phone);
  }

  /**
   * Adds a new phone number to the allowed users list.
   * @param {string} phone - The phone number to add.
   * @param {string} [name] - Optional name for the user.
   * @public
   */
  async saveAllowedUser(phone, name = null) {
    const users = this.getAllowedUsers();
    if (!users.some(u => u.id === phone)) {
      users.push({
        id: phone,
        name: name || phone
      });
      this.homey.settings.set('allowed_users', users);
      this.log(`User ${phone} added to allowed users.`);
    }
  }

  /**
   * Transcribes a WhatsApp voice message to text using the Google Gemini API.
   * Reads credentials from Homey settings and delegates to {@link VoiceTranscriber}.
   *
   * @public
   * @param {string} mediaId - The WhatsApp media asset ID from the webhook payload (`message.audio.id`).
   * @param {string} from - The sender's phone number, used to send an error reply if transcription fails.
   * @returns {Promise<string|null>} The transcribed text, or null if transcription failed (error already sent).
   * @example
   * // Called from api.js when a voice message is received:
   * const text = await homey.app.transcribeVoiceMessage('wamid-media-id', '39333xxxxxxx');
   */
  async transcribeVoiceMessage(mediaId, from) {
    const accessToken = this.homey.settings.get('access_token');
    const groqApiKey = this.homey.settings.get('groq_api_key');

    if (!accessToken || !groqApiKey) {
      this.error('Cannot transcribe voice message: access_token or groq_api_key not configured.');
      await this.sendWhatsappMessage(from, this.homey.__('bot.voice_transcription_error')).catch(() => { });
      return null;
    }

    const transcriber = new VoiceTranscriber();
    return transcriber.transcribeAudio(mediaId, accessToken, groqApiKey);
  }

};
