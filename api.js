'use strict';

module.exports = {

    /**
     * Handles the GET webhook request from Meta.
     * This is used by Meta for the initial Webhook verification step.
     * @param {object} args - Arguments passed by Homey API.
     * @param {object} args.homey - Homey instance.
     * @param {object} args.query - URL query parameters.
     * @returns {number|string} The hub.challenge echoed back to Meta (as a number when possible).
     * @public
     */
    async getWebhook({ homey, query }) {
        homey.log('[GET] /webhook verification requested');

        const verifyToken = homey.settings.get('verify_token');

        // Check if the setting is configured
        if (!verifyToken) {
            homey.error('Webhook Verification Failed: No Verify Token configured in Settings');
            throw new Error('Verification Token not configured');
        }

        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];

        if (mode === 'subscribe' && token === verifyToken) {
            homey.log('[GET] Webhook VERIFIED successfully.');

            // Meta expects the hub.challenge echoed back.
            // Homey serialises JS strings as JSON strings (e.g. "\"123\"") but numbers
            // as bare JSON numbers (e.g. 123). Meta accepts a bare number just fine,
            // so cast to Number to avoid the extra quotes.
            const numericChallenge = Number(challenge);
            const reply = isNaN(numericChallenge) ? challenge : numericChallenge;
            homey.log(`[GET] Returning challenge: ${reply}`);
            return reply;
        } else {
            homey.error('[GET] Webhook Verification Failed: Tokens do not match.');
            throw new Error('Forbidden: Verification failed');
        }
    },

    /**
     * Returns the full public Webhook Callback URL for use in the Meta Developer Portal.
     * Called by the Settings page via Homey.api().
     * @param {object} args - Arguments passed by Homey API.
     * @param {object} args.homey - Homey instance.
     * @returns {Promise<string>} The full Webhook Callback URL.
     * @example
     * // In settings/index.html:
     * // Homey.api('GET', '/webhookUrl', null, (err, url) => { ... });
     * @public
     */
    async getWebhookUrl({ homey }) {
        const homeyId = await homey.cloud.getHomeyId();
        return `https://${homeyId}.connect.athom.com/api/app/com.dimapp.wabot/webhook`;
    },

    /**
     * Handles incoming POST webhook messages from WhatsApp (Meta Cloud API).
     * Parses the JSON body and triggers the Flow card if a text message is found.
     * @param {object} args - Arguments passed by Homey API.
     * @param {object} args.homey - Homey instance.
     * @param {object} args.body - Webhook JSON Payload.
     * @returns {string} Success status.
     * @public
     */
    async postWebhook({ homey, body }) {
        homey.log('[POST] /webhook message received');

        try {
            if (!body.object || body.object !== 'whatsapp_business_account') {
                homey.log('Ignored non-whatsapp webhook payload');
                return 'Ignored'; // 200 OK so meta retries stop
            }

            // Check if entry exists and has changes
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0] &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const message = body.entry[0].changes[0].value.messages[0];
                const from = message.from;
                const msgId = message.id;
                const msg_body = message.text?.body;

                homey.log(`Received message from ${from} [id: ${msgId}]: ${msg_body}`);

                // Mark message as read (double blue tick) immediately
                homey.app.markMessageAsRead(msgId).catch(() => { });

                // Pass data to app instance
                await homey.app.triggerMessageReceived(msg_body, from);
            }

            return 'EVENT_RECEIVED';
        } catch (e) {
            homey.error('Error parsing POST Webhook body:', e);
            return 'OK'; // Don't throw, otherwise Meta retries
        }
    },

};
