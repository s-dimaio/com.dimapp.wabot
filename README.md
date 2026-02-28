# WhatsApp Bot for Homey

This Homey application allows you to receive and send WhatsApp text messages directly from your Homey by acting as a webhook for your own Meta WhatsApp Business App.

Since this method uses the official WhatsApp Cloud APIs and you only exchange simple text messages, the messaging is entirely free according to Meta's pricing model (as of their recent policy updates for free tier usage).

## Prerequisites

Before configuring this app in Homey, you must create an App in the Meta for Developers portal and retrieve the necessary credentials. Follow the step-by-step guide below.

---

## Part 1: Create a Meta App and get the Phone Number ID

1. Go to [Meta for Developers](https://developers.facebook.com/) and log in with your Facebook account. If required, complete your developer account with the missing information.
2. Click on **My Apps** (top right) and then click **Create App**.
3. Follow the guided wizard. In the **Use Case** section, select **"Connect with customers via WhatsApp"**.
4. To use WhatsApp you must link the app to a **Business Portfolio**. If you don't have one, you can create it during the wizard (it's free).
5. Once the wizard is complete, you will be redirected to the App Dashboard.
6. In the left menu, click **Use Cases** and then click the **Customize** button for the WhatsApp connection.
7. Open the **API Setup** menu on the left and note down your **Phone Number ID**.

---

## Part 2: Generate a Permanent Access Token

The temporary token from the API Setup page expires every 24 hours. For the Homey bot to work continuously, you must generate a Permanent Token:

1. Go to [Meta Business Settings](https://business.facebook.com/settings) and log in if necessary.
2. In the left menu under **Users**, click **System Users**.
3. Click **Add** to create a new System User (e.g. name it "HomeyBot", set role to **Admin**) and click **Create System User**.
4. Click the **three-dot menu (⋯)** on the right of your new system user and select **Assign Resources**. Select your WhatsApp App, give it **Full Control**, and click **Assign Resources** to save.
5. Click **Generate Token** and follow the guided wizard. When asked to assign permissions, select **`whatsapp_business_messaging`** and **`whatsapp_business_management`**.
6. Copy the generated token immediately — **it will only be shown once**.

---

## Part 3: Configure the Homey App

1. Install this App on your Homey.
2. Go to **Settings** → **WhatsApp Bot**.
3. Paste the **Permanent Access Token** into the **Access Token** field.
4. Paste the **Phone Number ID** into the **Phone Number ID** field.
5. Choose a custom **Verify Token** (any string without spaces, e.g. `my_homey_token`).
6. Note down the **Webhook URL** shown in the settings page.
7. Click **Save Settings**.

---

## Part 4: Configure the Webhook on Meta

1. In your Meta App Dashboard, go to **WhatsApp > Configuration** in the left sidebar.
2. Under the Webhook section, click **Edit**.
3. Paste your Homey **Webhook URL** as the **Callback URL**.
4. Paste your **Verify Token** (the same string you chose in the Homey settings).
5. Click **Verify and Save**. Meta will contact your Homey to verify the endpoint.
6. Once saved, click **Manage** next to Webhook fields, find the **"messages"** row and click **Subscribe**.

---

## Part 5: First Bot Activation

The bot's test number is not registered in your WhatsApp contacts by default. You need to initiate the first chat from the Meta portal:

1. In the Meta App Dashboard, go to **WhatsApp > API Setup**.
2. Generate a **temporary access token** by clicking the button in the top-right area and following the wizard. *(This token expires in 24 hours and is only needed for this initial step.)*
3. In the **"To"** dropdown (Step 1), select your personal phone number. If not present, add it and verify it with the SMS code.
4. Click **Send message** (Step 2) to send a test message to your phone.
5. Open WhatsApp on your phone and **reply to the message** you received from the bot number. The bot is now active and saved in your contacts.

Congratulations! Your Bot is now fully operational!

---

## Usage in Flows

You can now use this app in your Homey Flows.

### Triggers (When)
* **Message Received**: Triggers when a text message is received. Provides tokens for:
  * `Message Text`: The content of the message.
  * `Sender Number`: The WhatsApp phone number of the person who sent it.
  
  *Note: When a message is received by the bot, it is automatically marked as read (double blue ticks) on the sender's device.*

### Actions (Then)
* **Send Message**: Send a text message to a specific WhatsApp number. You need to provide the recipient's phone number including the country code (e.g., `393331234567` without the `+` sign).
