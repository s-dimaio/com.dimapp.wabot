'use strict';

const Homey = require('homey');
const fetch = require('cross-fetch');

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
    sendMessageAction.registerRunListener(async (args, state) => {
      this.log('Action card triggered: send_whatsapp_message');
      await this.sendWhatsappMessage(args.recipient_number, args.message_text);
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

};
