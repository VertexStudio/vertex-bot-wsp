# BuilderBot SDK Chatbot with Baileys

This project uses the BuilderBot SDK to create a chatbot with Baileys. Follow the instructions below to install and configure it.

## Prerequisites

- Node.js version 22.8.0 or higher
- MongoDB version 6.6.1 or higher
- Imgur API key
- OpenAI API key
- Rust and Cargo installed
- Updated OpenSSL version (OpenSSL 3.0.12 24 Oct 2023 (Library: OpenSSL 3.0.12 24 Oct 2023))

## Setup Instructions

It is advisable to check first the [veoveo](https://github.com/VertexStudio/veoveo) repository to ensure all the requirements are met.

1. Clone and set up the veoveo repository:

   ```bash
   mkdir -p ~/vertex && cd ~/vertex
   git clone https://github.com/VertexStudio/veoveo
   cd veoveo
   ```

2. Start SurrealDB:

   ```bash
   cargo run -p vv_db -- --user root --pass root --dummy
   surreal start --user root --pass root surrealkv:assets/vv_db
   ```

3. Run the required services (each in a separate terminal):

   ```bash
   docker compose up -d (for minio service)
   cargo run -p rerank
   cargo run -p embeddings
   cargo run -p facts
   cargo run -p chat
   cargo run -p vv_vision
   ./run.sh cargo run --release -p asset_pipeline -- --comfy
   ```

4. Clone and set up the bioma repository:

   ```bash
   cd ~/vertex
   git clone https://github.com/VertexStudio/bioma
   cd bioma
   docker compose up reranker
   ```

5. Clone this repository:

   ```bash
   cd ~/vertex
   git clone https://github.com/VertexStudio/vertex-bot-wsp
   cd vertex-bot-wsp
   ```

6. Configure the .env file:

   Copy the `.env.example` file to `.env` and fill in the required values:

   ```bash
   cp .env.example .env
   ```

7. Install dependencies and start the bot:

   ```bash
   pnpm i
   pnpm dev
   ```

8. Scan the QR code from the bot.qr.png file with WhatsApp

## Group Validations

1. Copy the groupsValidationFeature/index.cjs into node_modules/@builderbot/provider-baileys/dist/index.cjs
2. Paste and replace on
   ```bash
   cp groupsValidationFeature/index.cjs node_modules/@builderbot/provider-baileys/dist/index.cjs
   ```

## Additional Requirements

Ensure the following services are running:

1. vv_vision
2. ComfyUI
3. vv_db
4. Ollama
5. Reranker service
6. Embeddings service

## Architecture

```mermaid
sequenceDiagram
    participant U as User
    participant W as WhatsApp
    participant VB as Vertex Bot
    participant DB as VV DB (SurrealDB)
    participant EA as Embeddings Actor
    participant CA as Chat Actor
    participant RA as Rerank Actor

    U->>W: Send message
    W->>VB: Forward message
    VB->>DB: Fetch conversation
    alt Conversation exists
        DB->>VB: Return conversation
    else Conversation doesn't exist
        VB->>DB: Create new conversation
        DB->>VB: Return new conversation
    end

    VB->>EA: Query Embeddings Actor to get top facts and top messages
    EA->>VB: Return top facts and top messages

    VB->>RA: Rerank facts and messages
    RA->>VB: Return reranked facts and messages

    VB->>CA: Send reranked messages to Chat Actor
    CA->>VB: Return assistant response

    VB->>EA: Create embeddings for new messages

    VB->>DB: Save messages and relationships
    VB->>W: Send assistant response
    W->>U: Deliver response
```
