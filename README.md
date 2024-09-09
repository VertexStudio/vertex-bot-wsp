This is a project that uses the BuilderBot SDK to create a chatbot with Baileys. Below is explained how to install and configure it.

## Requirements

- Node.js version 21.1.0 or higher
- MongoDB version 6.6.1 or higher
- Imgur API key
- OpenAI API key

## Installation

1. Clone this repository
2. Configure the .env file:

- ASSISTANT_ID=
- OPENAI_API_KEY=
- MONGODB_URI=
- IMGUR_CLIENT_ID=
- MODEL= (Optional, default is "llama3.1").

3. Run "pnpm i"
4. Run "pnpm dev"
5. Scan the QR code from the bot.qr.png file with WhatsApp

## Group validations

1. Copy the groupsValidationFeature/index.cjs
2. Paste and replace on node_modules/@builderbot/provider-baileys/dist/index.cjs

## Requirements

1. vv_vision running.
2. ComfyUI running.
3. vv_db running.
4. Ollama running.
5. Reranker service running.
6. Embeddings service running.
