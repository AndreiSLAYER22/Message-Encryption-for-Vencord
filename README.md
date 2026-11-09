# Message-Encryption-for-Vencord
Its a plug-in that encrypts an message and decrypts if only other person has the plug-in
MessageCrypt 🔐

A lightweight, client-side encryption plugin for Vencord. Secure your Discord messages end-to-end using AES-256-GCM encryption with a shared passphrase.

🌟 Features

AES-256-GCM Encryption: Uses Web Crypto API with PBKDF2 key derivation (150k iterations) for solid client-side message protection.

Auto-Decrypt: Automatically renders decrypted text directly under encrypted messages for users sharing the same passphrase.

Chat Bar Toggle: Convenient lock icon in your Discord text input bar to toggle auto-encryption on or off quickly.

Trigger Prefix: Send quick encrypted messages without toggling full encryption on (e.g., !enc secret message).

Adaptive UI: Seamlessly blends with Discord's themes (Light, Dark, and Midnight/OLED).

⚠️ Important Security Note

Passphrase Management:

Never share your encryption passphrase inside Discord itself.

Share it via a secure out-of-band channel (e.g., in person, Signal, or encrypted matrix chat).

Anyone with the passphrase can decrypt your messages.

🚀 Installation Guide

Step 1: Clone Vencord

If you haven't set up the Vencord development repository yet, clone it first:

git clone https://github.com/Vendicated/Vencord.git
cd Vencord
pnpm install


Step 2: Add MessageCrypt

Create a directory for messageCrypt inside src/userplugins/:

mkdir -p src/userplugins/messageCrypt


Copy index.tsx into src/userplugins/messageCrypt/index.tsx.

Step 3: Build & Inject

Build Vencord and inject it into your Discord client:

pnpm build
pnpm inject


Restart your Discord client completely.

⚙️ Configuration & Usage

Open Discord Settings > Vencord > Plugins.

Locate MessageCrypt and enable it.

Click the ⚙️ Settings icon next to MessageCrypt (or right-click the lock icon in the chat bar) to configure:

Passphrase: Set your shared secret key.

Trigger Prefix: Default is !enc  (used when auto-encryption is off).

Auto Encrypt: Toggle to encrypt every sent message automatically.

Controls:

Left-Click on the Chat Bar Lock Icon: Toggle automatic encryption ON / OFF.

Right-Click on the Chat Bar Lock Icon: Open MessageCrypt Quick Settings.

📜 License

Distributed under the MIT License. See LICENSE for details.
