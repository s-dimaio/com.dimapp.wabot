# WhatsApp Bot for Homey

This Homey application allows you to receive and send WhatsApp text or voice messages directly from your Homey by acting as a webhook for your own Meta WhatsApp Business App.

Since this method uses the official WhatsApp Cloud APIs and you only exchange simple text or voice messages, the messaging is entirely free according to Meta's pricing model (as of their recent policy updates for free tier usage).

## Prerequisites

Before configuring this app in Homey, you must create an App in the Meta for Developers portal and retrieve the necessary credentials. Follow the step-by-step guide below.

---

## WhatsApp Bot Configuration

### Part 1: Create a Meta App and get the Phone Number ID

1. Go to [Meta for Developers](https://developers.facebook.com/) and log in with your Facebook account. If required, complete your developer account with the missing information.
2. Click on **My Apps** (top right) and then click **Create App**.
3. Follow the guided wizard. In the **Use Case** section, select **"Connect with customers via WhatsApp"**.
4. To use WhatsApp you must link the app to a **Business Portfolio**. If you don't have one, you can create it during the wizard (it's free).
5. Once the wizard is complete, you will be redirected to the App Dashboard.
6. In the left menu, click **Use Cases** and then click the **Customize** button for the WhatsApp connection.
7. Open the **API Setup** menu on the left and note down your **Phone Number ID**.

---

### Part 2: Generate a Permanent Access Token

The temporary token from the API Setup page expires every 24 hours. For the Homey bot to work continuously, you must generate a Permanent Token:

1. Go to [Meta Business Settings](https://business.facebook.com/settings) and log in if necessary.
2. In the left menu under **Users**, click **System Users**.
3. Click **Add** to create a new System User (e.g. name it "HomeyBot", set role to **Admin**) and click **Create System User**.
4. Click the **three-dot menu (⋯)** on the right of your new system user and select **Assign Resources**. Select your WhatsApp App, give it **Full Control**, and click **Assign Resources** to save.
5. Click **Generate Token** and follow the guided wizard. When asked to assign permissions, select **`whatsapp_business_messaging`** and **`whatsapp_business_management`**.
6. Copy the generated token immediately — **it will only be shown once**.

---

### Part 3: Configure Homey and the Webhook

1. Go to **Settings** → **WhatsApp Bot** in the Homey app and fill in the **Permanent Access Token** and the **Phone Number ID**.
2. From the same Configuration page, copy the **Webhook URL** and choose a **Verify Token** of your choice (a string without spaces, e.g. `my_homey_token`). You will need this token both to verify the webhook on Meta and later to register with the bot. Click **Save Settings**.
3. Go back to your Meta App → **Use Cases** → **Customize** → **Configuration** and scroll to the **Webhook** section.
4. Paste the **Webhook URL** as the **Callback URL** and enter your **Verify Token**. Click **Verify and Save**. Meta will contact your Homey to verify the endpoint.
5. Once verification is complete, go back to the **Configuration** menu and enable the subscription for the **"messages"** webhook field.

---

### Part 4: First Bot Activation

1. In your Meta App → **Use Cases** → **Customize** → **API Setup**.
2. Generate a **temporary access token** by clicking the button in the top-right corner and following the wizard. *(This token expires in 24 hours and is only needed for this step.)*
3. In the **"To"** dropdown (Step 1), select your personal phone number. If not present, add it and verify it with the SMS code.
4. Click **Send Message** (Step 2).
5. You will receive a **"Hello World"** message on WhatsApp. The bot is now active, but you must register before using it.
6. Reply to the welcome message by sending `/register [secret_code]` to the bot, where `secret_code` is the **Verify Token** you chose in Part 3.
7. The bot will reply with a confirmation message and will finally be ready to use!

Congratulations! Your Bot is now fully operational!

---

## Voice Messages Configuration

To enable the bot to transcribe incoming voice messages using the powerful Groq Whisper model, you need to configure a Groq API Key.

### Part 1: Groq API Key
1. Go to [console.groq.com](https://console.groq.com) and log in or create a free account.
2. In the top-right corner, select **API Keys**.
3. Click **Create API Key**, give it a name (e.g. HomeyBot), and copy it (it will be shown only once).
4. Go back to the Homey app settings, open the **Voice Messages** section, paste the key, and save.

---

## Usage in Flows

You can now use this app in your Homey Flows.

### Triggers (When)
* **Message Received**: Triggers when a text or voice message is received. Provides tokens for:
  * `Message Text`: The content of the text message, or the text transcription of the voice message.
  * `Sender Number`: The WhatsApp phone number of the person who sent it.
  
  *Note: When a message is received by the bot, it is automatically marked as read (double blue ticks) on the sender's device.*

### Actions (Then)
* **Send Message**: Send a text message to a specific WhatsApp number. You need to provide the recipient's phone number including the country code (e.g., `393331234567` without the `+` sign).
