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
     * The "read" receipt (double blue tick) is sent only after the Homey trigger fires
     * successfully, so that blue ticks represent meaningful delivery confirmation.
     * For unauthorized users, the read receipt is sent immediately so the bot appears online.
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

            // Check if entry exists and has a processable message
            const hasMessage =
                body.entry &&
                body.entry[0]?.changes &&
                body.entry[0].changes[0] &&
                body.entry[0].changes[0].value?.messages &&
                body.entry[0].changes[0].value.messages[0];

            if (!hasMessage) {
                homey.log('Webhook payload has no processable message (status update or malformed entry). Skipping.');
                return 'EVENT_RECEIVED';
            }

            {
                const message = body.entry[0].changes[0].value.messages[0];
                const from = message.from;
                const msgId = message.id;
                const msgType = message.type;

                // Extract body based on message type
                let msg_body = null;
                if (msgType === 'text') {
                    msg_body = message.text?.body;
                }

                homey.log(`Received ${msgType} message from ${homey.app._maskPhoneNumber(from)} [id: ${msgId}]`);

                // Access Control Check
                if (homey.app.isUserAllowed(from)) {
                    if (msgType === 'audio') {
                        // Handle voice message: transcribe via Gemini API
                        const mediaId = message.audio?.id;
                        if (mediaId) {
                            try {
                                msg_body = await homey.app.transcribeVoiceMessage(mediaId, from);
                                if (msg_body) homey.log(`Voice message transcribed: "${msg_body}"`);
                            } catch (transcribeErr) {
                                homey.error('Voice transcription error:', transcribeErr);
                                await homey.app.sendWhatsappMessage(
                                    from,
                                    homey.__('bot.voice_transcription_error')
                                ).catch(e => homey.error('Failed to send transcription error reply', e));
                                return 'EVENT_RECEIVED';
                            }
                        }
                    }

                    // Trigger flow only if we have a message body
                    if (msg_body) {
                        try {
                            await homey.app.triggerMessageReceived(msg_body, from);
                            // Mark as read only on successful trigger (blue ticks = Homey processed the message)
                            homey.app.markMessageAsRead(msgId).catch(() => { });
                        } catch (triggerErr) {
                            homey.error('Error triggering message received flow:', triggerErr);
                            await homey.app.sendWhatsappMessage(
                                from,
                                homey.__('bot.trigger_error')
                            ).catch(e => homey.error('Failed to send trigger error reply', e));
                        }
                    } else {
                        homey.log(`Received ${msgType} message from ${homey.app._maskPhoneNumber(from)} [id: ${msgId}] but no text body could be extracted. Trigger skipped.`);
                        await homey.app.sendWhatsappMessage(
                            from,
                            homey.__('bot.unsupported_message_type')
                        ).catch(e => homey.error('Failed to send unsupported type reply', e));
                    }
                } else {
                    // Mark as read immediately for unauthorized users so the bot appears online
                    homey.app.markMessageAsRead(msgId).catch(() => { });

                    const verifyToken = homey.settings.get('verify_token');
                    if (msg_body && msg_body.trim() === `/register ${verifyToken}`) {
                        // Register the user
                        await homey.app.saveAllowedUser(from);
                        await homey.app.sendWhatsappMessage(from, homey.__('bot.registration_success'));
                        homey.log(`New user registered via webhook: ${homey.app._maskPhoneNumber(from)}`);
                    } else if (msg_body && msg_body.trim().startsWith('/register')) {
                        // Wrong token attempt
                        homey.log(`Unauthorized message attempt from ${homey.app._maskPhoneNumber(from)}. Wrong verify token in /register.`);
                        await homey.app.sendWhatsappMessage(
                            from,
                            homey.__('bot.invalid_token')
                        ).catch(e => homey.error('Failed to send wrong token reply', e));
                    } else {
                        // Reject and send instructions
                        homey.log(`Unauthorized message attempt from ${homey.app._maskPhoneNumber(from)}. Replied with /register instructions.`);
                        await homey.app.sendWhatsappMessage(
                            from,
                            homey.__('bot.registration_required')
                        ).catch(e => homey.error('Failed to send unauthorized reply', e));
                    }
                }
            }

            return 'EVENT_RECEIVED';
        } catch (e) {
            homey.error('Error parsing POST Webhook body:', e);
            return 'OK'; // Don't throw, otherwise Meta retries
        }
    },

    /**
     * DELETE /api/app/com.dimapp.wabot/user/:phone
     * Removes a phone number from the authorized users list.
     * Called by the Settings page via Homey.api().
     * @param {object} args - Arguments passed by Homey API.
     * @param {object} args.homey - Homey instance.
     * @param {object} args.params - URL parameters.
     * @param {string} args.params.phone - The phone number to remove (URL-encoded).
     * @returns {Promise<{success: boolean, error?: string}>} Result of the operation.
     * @example
     * // In settings/index.html:
     * // Homey.api('DELETE', '/user/' + encodeURIComponent(phone), null, callback);
     * @public
     */
    async deleteUser({ homey, params }) {
        const phone = params.phone;

        if (!phone) {
            return { success: false, error: 'Phone number is required' };
        }

        const users = homey.settings.get('allowed_users') || [];
        const filtered = users.filter(u => u.id !== phone);

        if (filtered.length === users.length) {
            return { success: false, error: `User ${phone} not found` };
        }

        homey.settings.set('allowed_users', filtered);
        homey.log(`User ${homey.app._maskPhoneNumber(phone)} removed from allowed users via Settings page.`);
        return { success: true };
    },

};
