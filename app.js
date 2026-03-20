'use strict';

const Homey = require('homey');
const fetch = require('cross-fetch');
const VoiceTranscriber = require('./lib/VoiceTranscriber');

module.exports = class WhatsAppBotApp extends Homey.App {

  /**
   * Masks a phone number for privacy in logs (e.g. 39345***89).
   * 
   * @param {string} phone - The phone number to mask.
   * @returns {string} The masked phone number.
   * @example
   * // returns '3934***34'
   * this._maskPhoneNumber('3934567834');
   * @private
   */
  _maskPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return String(phone);
    if (phone.length <= 5) return '***';
    return phone.substring(0, 4) + '...' + phone.substring(phone.length - 2);
  }

  /**
   * Initializes the WhatsApp Bot application.
   * Sets up Flow cards.
   */
  async onInit() {
    this.log('WhatsApp Bot App has been initialized');

    // Register Flow Trigger Cards
    this._messageReceivedTrigger = this.homey.flow.getTriggerCard('whatsapp_message_received');
    this._messageFailedTrigger = this.homey.flow.getTriggerCard('whatsapp_message_failed');

    // Mappa per salvare temporaneamente il testo dei messaggi inviati
    // Serve per fare fallback se il webhook restituisce errore asincrono (wamid -> text)
    this._recentMessages = new Map();

    // Register Flow Action Card
    const sendMessageAction = this.homey.flow.getActionCard('send_whatsapp_message');

    // Provide authorized users to the autocomplete dropdown for the contact field.
    // The first entry is a special "All Contacts" option that sends to every registered user.
    sendMessageAction.registerArgumentAutocompleteListener('recipient_contact', async (query, args) => {
      const users = this.getAllowedUsers();

      const allOption = {
        name: this.homey.__('flow.all_contacts_label'),
        description: this.homey.__('flow.all_contacts_description'),
        id: '__ALL__'
      };

      const results = users.map(user => ({
        name: user.name || user.id,
        description: user.id,
        id: user.id
      }));

      // Filter individual contacts based on user search query
      const lowerQuery = query.toLowerCase();
      const filtered = results.filter(res =>
        res.name.toLowerCase().includes(lowerQuery) ||
        res.id.includes(lowerQuery)
      );

      // Always show the "All" option first, filtered only when the query does not match it
      const allMatches = allOption.name.toLowerCase().includes(lowerQuery) ||
        allOption.description.toLowerCase().includes(lowerQuery);

      return allMatches ? [allOption, ...filtered] : filtered;
    });

    sendMessageAction.registerRunListener(async (args, state) => {
      this.log('Action card triggered: send_whatsapp_message');

      const byContact = args.recipient_contact;
      const byNumber = args.recipient_number;

      const hasContact = typeof byContact === 'object' && byContact !== null && byContact.id;
      const hasNumber = typeof byNumber === 'string' && byNumber.trim() !== '';

      if (hasContact && hasNumber) {
        throw new Error(this.homey.__('flow.action_error_both_recipients'));
      }
      if (!hasContact && !hasNumber) {
        throw new Error(this.homey.__('flow.action_error_no_recipient'));
      }

      /** @type {string[]} */
      let recipients = [];

      if (hasContact) {
        if (byContact.id === '__ALL__') {
          // Send to all registered users
          recipients = this.getAllowedUsers().map(u => u.id);
          if (recipients.length === 0) {
            throw new Error(this.homey.__('flow.action_error_no_users_registered'));
          }
        } else {
          recipients = [byContact.id];
        }
      } else {
        // Support multiple numbers separated by ";"
        recipients = byNumber.split(';').map(n => n.trim()).filter(n => n.length > 0);
        if (recipients.length === 0) {
          throw new Error(this.homey.__('flow.action_error_no_recipient'));
        }
      }

      // WhatsApp Cloud API does not support batch sending: one API call per recipient
      for (const recipient of recipients) {
        this.log(`Sending to recipient ${this._maskPhoneNumber(recipient)}...`);
        await this.sendWhatsappMessage(recipient, args.message_text);
      }

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
   * Throws if the trigger fails, so the caller can handle the error and notify the user.
   * @param {string} messageText - The text content of the received message.
   * @param {string} senderNumber - The phone number of the sender.
   * @throws {Error} If the trigger card fails to fire.
   * @public
   */
  async triggerMessageReceived(messageText, senderNumber) {
    this.log(`Triggering flow for message from ${this._maskPhoneNumber(senderNumber)}`);
    await this._messageReceivedTrigger.trigger({
      message_text: messageText,
      sender_number: senderNumber
    });
  }

  /**
   * Triggers the "whatsapp_message_failed" flow card.
   * Throws if the trigger fails, so the caller can handle it.
   * @param {string} errorMessage - The localized error message.
   * @param {string} recipientNumber - The phone number of the recipient.
   * @param {string} [messageText] - The original message text.
   * @public
   */
  async triggerMessageFailed(errorMessage, recipientNumber, messageText = '') {
    this.log(`Triggering flow for failed message to ${this._maskPhoneNumber(recipientNumber)}...`);
    await this._messageFailedTrigger.trigger({
      error_message: errorMessage,
      recipient_number: recipientNumber,
      message_text: messageText || ''
    }).catch(err => this.error('Failed to trigger whatsapp_message_failed card:', err));
  }

  /**
   * Retrieves the original text of a recently sent message by its wamid.
   * Used for async webhook fallbacks.
   * @param {string} wamid - The message ID.
   * @returns {string|null} The original text, if still in memory.
   * @public
   */
  getRecentMessageText(wamid) {
    return this._recentMessages.get(wamid) || null;
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

    this.log(`Sending message to ${this._maskPhoneNumber(recipient)}...`);

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
        // Fallback per errore "Re-engagement window expired"
        if (data.error && data.error.code === 131047) {
          this.log(`Error 131047: 24h window expired for ${this._maskPhoneNumber(recipient)}. Falling back to template message.`);
          return await this.sendWhatsappTemplateMessage(recipient, text);
        }

        const apiErrorMessage = data.error?.message || 'Unknown API error';
        this.error('Failed to send WhatsApp message. Full API Response:', JSON.stringify(data, null, 2));

        // Rilancia l'errore di WhatsApp in modo che l'Action Card su Homey fallisca e lo mostri
        throw new Error(`WhatsApp API Error (${data.error?.code || 'Unknown'}): ${apiErrorMessage}`);
      }

      this.log('Message sent successfully:', data.messages[0].id);
      
      // Salva in memoria per 2 minuti per eventuale fallback asincrono del webhook
      const msgId = data.messages[0].id;
      this._recentMessages.set(msgId, text);
      setTimeout(() => {
        this._recentMessages.delete(msgId);
      }, 120000);

      return data;
    } catch (error) {
      // Se l'errore è un throw esplicito del fallback (es: template non configurato),
      // o un errore già parserizzato (come quelli di sendWhatsappTemplateMessage), 
      // lo rilanciamo direttamente così Homey Flow mostra il messaggio corretto.
      if (error.message && (error.message.includes('template') || error.message.includes('24h'))) {
        throw error;
      }
      this.error('Network or API Error sending WhatsApp message:', error);
      
      // Inoltra il vero messaggio d'errore o un fallback testuale
      // così da rendere esplicito l'errore nella Flow Action Card
      throw new Error(error.message || this.homey.__('bot.trigger_error'));
    }
  }

  /**
   * Sends a WhatsApp template message using the Meta Cloud API.
   * This is used as a fallback when the 24h window has expired.
   * @param {string} recipient - The phone number to send the message to.
   * @param {string} text - The content of the message to inject in the template variable.
   * @public
   */
  async sendWhatsappTemplateMessage(recipient, text) {
    const accessToken = this.homey.settings.get('access_token');
    const phoneId = this.homey.settings.get('phone_id');
    const templateName = this.homey.settings.get('template_name');
    const templateLanguage = this.homey.settings.get('template_language');
    const templateParameterName = this.homey.settings.get('template_parameter_name');

    if (!templateName || !templateLanguage) {
      throw new Error(this.homey.__('bot.template_fallback_error'));
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: templateLanguage
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                // Optional. Required for templates with named variables (e.g., {{message}}) created with type "Name".
                // If provided in settings, we use it; otherwise we omit it (for numeric variables like {{1}}).
                ...(templateParameterName ? { parameter_name: templateParameterName } : {}),
                text: text
              }
            ]
          }
        ]
      }
    };

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

    this.log(`Sending template message '${templateName}' to ${this._maskPhoneNumber(recipient)}...`);
    this.log('Template payload:', JSON.stringify(payload, null, 2));

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
      this.error('Failed to send WhatsApp template message. Full API Response:', JSON.stringify(data, null, 2));
      throw new Error(data.error?.message || 'Unknown API error');
    }

    this.log('Template message sent successfully:', data.messages[0].id);
    return data;
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
      this.log(`User ${this._maskPhoneNumber(phone)} added to allowed users.`);
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
