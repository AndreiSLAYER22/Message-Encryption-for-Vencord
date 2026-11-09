/*
 * MessageCrypt - a Vencord userplugin (v4)
 * Author: Devs.andrei_slayer22
 *
 * - Encrypts outgoing messages with AES-256-GCM using a shared passphrase
 * - Decrypts matching incoming messages right under the original
 * - Adds a lock button to the text bar:
 *     left-click  -> turn encryption on / off
 *     right-click -> open quick settings (passphrase, trigger prefix)
 * - The settings window follows Discord's theme: light, dark, and OLED/onyx.
 *
 * Install: src/userplugins/messageCrypt/index.tsx, then `pnpm build` and restart Discord.
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

const MARKER = "[vc-enc]";
const PBKDF2_ITERATIONS = 150_000;

const settings = definePluginSettings({
    passphrase: {
        type: OptionType.STRING,
        description: "Passphrase used to encrypt and decrypt messages. Everyone who should be able to read your messages needs the exact same one. Share it outside of Discord (in person, Signal, etc.), never in a chat.",
        default: "",
    },
    autoEncrypt: {
        type: OptionType.BOOLEAN,
        description: "Encrypt every message you send automatically. You can also switch this on and off with the lock button in the text bar.",
        default: false,
    },
    trigger: {
        type: OptionType.STRING,
        description: "Text you type at the start of a message to encrypt just that one message while auto-encrypt is off (for example \"!enc hello\"). The prefix itself is removed before encrypting.",
        default: "!enc ",
    },
});

// ---------- crypto helpers ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array) {
    let s = "";
    bytes.forEach(b => (s += String.fromCharCode(b)));
    return btoa(s);
}

function fromB64(str: string) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
    const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptText(plain: string, passphrase: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));

    const packed = new Uint8Array(salt.length + iv.length + ct.length);
    packed.set(salt, 0);
    packed.set(iv, salt.length);
    packed.set(ct, salt.length + iv.length);
    return MARKER + toB64(packed);
}

const decryptCache = new Map<string, string | null>();

async function decryptText(payload: string, passphrase: string): Promise<string | null> {
    const cacheKey = passphrase + "|" + payload;
    if (decryptCache.has(cacheKey)) return decryptCache.get(cacheKey)!;

    try {
        const packed = fromB64(payload.slice(MARKER.length).trim());
        const salt = packed.slice(0, 16);
        const iv = packed.slice(16, 28);
        const ct = packed.slice(28);
        const key = await deriveKey(passphrase, salt);
        const plain = dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
        decryptCache.set(cacheKey, plain);
        return plain;
    } catch {
        // wrong passphrase or corrupted message
        decryptCache.set(cacheKey, null);
        return null;
    }
}

// ---------- theme handling ----------

interface Palette {
    panel: string;
    text: string;
    muted: string;
    field: string;
    border: string;
}

const PALETTES: Record<"light" | "dark" | "oled", Palette> = {
    light: { panel: "#ffffff", text: "#060607", muted: "#4e5058", field: "#e3e5e8", border: "#c4c9ce" },
    dark: { panel: "#2b2d31", text: "#f2f3f5", muted: "#b5bac1", field: "#1e1f22", border: "#4e5058" },
    oled: { panel: "#000000", text: "#f2f3f5", muted: "#b5bac1", field: "#0b0b0c", border: "#2e3035" },
};

function detectTheme(): keyof typeof PALETTES {
    const cl = document.documentElement.classList;
    if (cl.contains("theme-midnight")) return "oled";
    if (cl.contains("theme-light")) return "light";
    if (cl.contains("theme-dark") || cl.contains("theme-darker")) return "dark";

    // Fallback for custom themes: if the page's text colour is dark, the theme is light.
    const m = getComputedStyle(document.body).color.match(/\d+/g);
    if (m && m.length >= 3) {
        const [r, g, b] = m.map(Number);
        return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? "light" : "dark";
    }
    return "dark";
}

function usePalette(): Palette {
    const [theme, setTheme] = React.useState(detectTheme);

    React.useEffect(() => {
        const obs = new MutationObserver(() => setTheme(detectTheme()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
        return () => obs.disconnect();
    }, []);

    return PALETTES[theme];
}

// ---------- message accessory (decrypted text under the message) ----------

function DecryptedAccessory({ content }: { content: string; }) {
    const { passphrase } = settings.use(["passphrase"]);
    const [state, setState] = React.useState<"loading" | "ok" | "fail">("loading");
    const [text, setText] = React.useState("");

    React.useEffect(() => {
        let cancelled = false;
        if (!passphrase) {
            setState("fail");
            return;
        }
        setState("loading");
        decryptText(content, passphrase).then(result => {
            if (cancelled) return;
            if (result == null) setState("fail");
            else {
                setText(result);
                setState("ok");
            }
        });
        return () => { cancelled = true; };
    }, [content, passphrase]);

    // Neutral translucent background + inherited text colour works on every theme.
    const style: React.CSSProperties = {
        marginTop: 4,
        padding: "4px 8px",
        borderLeft: "3px solid #5865f2",
        borderRadius: 4,
        background: "rgba(127, 127, 127, 0.15)",
        color: "inherit",
        fontSize: "0.95em",
        whiteSpace: "pre-wrap",
    };

    if (state === "loading") return <div style={style}>🔓 Decrypting…</div>;
    if (state === "fail") {
        return (
            <div style={{ ...style, opacity: 0.7 }}>
                🔒 Encrypted message (set the correct passphrase to read it)
            </div>
        );
    }
    return <div style={style}>🔓 {text}</div>;
}

// ---------- chat bar button + settings window ----------

function LockIcon({ locked }: { locked: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {locked ? (
                <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
            ) : (
                <path d="M12 2a5 5 0 0 0-5 5h2a3 3 0 0 1 6 0v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Z" />
            )}
        </svg>
    );
}

function SettingsModal({ modalProps }: { modalProps: any; }) {
    const { passphrase, trigger, autoEncrypt } = settings.use(["passphrase", "trigger", "autoEncrypt"]);
    const [show, setShow] = React.useState(false);
    const p = usePalette();

    const field: React.CSSProperties = {
        width: "100%",
        boxSizing: "border-box",
        padding: "8px 10px",
        borderRadius: 4,
        border: `1px solid ${p.border}`,
        background: p.field,
        color: p.text,
        fontSize: 14,
    };

    const button: React.CSSProperties = { ...field, width: "auto", cursor: "pointer" };

    const label: React.CSSProperties = {
        display: "block",
        margin: "14px 0 6px",
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        color: p.muted,
    };

    const hint: React.CSSProperties = {
        marginTop: 6,
        fontSize: 12,
        lineHeight: 1.4,
        color: p.muted,
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <div style={{ background: p.panel, color: p.text, borderRadius: 8 }}>
                <ModalHeader>
                    <div style={{ flex: 1, fontSize: 18, fontWeight: 700, color: p.text }}>MessageCrypt</div>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </ModalHeader>

                <ModalContent>
                    <label style={label}>Passphrase</label>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            style={field}
                            type={show ? "text" : "password"}
                            value={passphrase}
                            placeholder="Shared secret"
                            onChange={e => (settings.store.passphrase = e.currentTarget.value)}
                        />
                        <button type="button" style={button} onClick={() => setShow(s => !s)}>
                            {show ? "Hide" : "Show"}
                        </button>
                    </div>
                    <div style={hint}>
                        The shared secret used to lock and unlock messages. Everyone who should read them needs the exact same
                        passphrase. Share it outside Discord, never in a chat. A wrong passphrase means messages stay unreadable.
                    </div>

                    <label style={label}>Trigger prefix (when encryption is off)</label>
                    <input
                        style={field}
                        type="text"
                        value={trigger}
                        onChange={e => (settings.store.trigger = e.currentTarget.value)}
                    />
                    <div style={hint}>
                        While encryption is off, start a message with this text to encrypt only that message, for example
                        "{trigger}hello". The prefix is removed before the message is encrypted.
                    </div>

                    <label style={{ ...label, display: "flex", alignItems: "center", gap: 8, textTransform: "none", fontSize: 14, color: p.text }}>
                        <input
                            type="checkbox"
                            checked={autoEncrypt}
                            onChange={e => (settings.store.autoEncrypt = e.currentTarget.checked)}
                        />
                        Encrypt every message I send
                    </label>
                    <div style={hint}>
                        Same as the lock button in the text bar: when on, all your messages are encrypted automatically
                        and you don't need the trigger prefix.
                    </div>
                </ModalContent>

                <ModalFooter>
                    <button type="button" style={button} onClick={modalProps.onClose}>
                        Done
                    </button>
                </ModalFooter>
            </div>
        </ModalRoot>
    );
}

function openSettingsModal() {
    openModal(modalProps => <SettingsModal modalProps={modalProps} />);
}

const CryptButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { autoEncrypt, passphrase } = settings.use(["autoEncrypt", "passphrase"]);
    if (!isMainChat) return null;

    const tooltip = !passphrase
        ? "MessageCrypt: no passphrase set. Click or right-click to set one"
        : autoEncrypt
            ? "MessageCrypt: encryption is ON. Click to turn off, right-click for settings"
            : "MessageCrypt: encryption is OFF. Click to turn on, right-click for settings";

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => {
                if (!settings.store.passphrase) return openSettingsModal();
                settings.store.autoEncrypt = !settings.store.autoEncrypt;
            }}
            onContextMenu={e => {
                e.preventDefault();
                openSettingsModal();
            }}
        >
            <span style={{ color: autoEncrypt ? "#23a55a" : undefined, display: "flex" }}>
                <LockIcon locked={autoEncrypt} />
            </span>
        </ChatBarButton>
    );
};

// ---------- plugin ----------

export default definePlugin({
    name: "MessageCrypt",
    description: "Encrypts your messages with AES-256-GCM using a shared passphrase and decrypts messages from friends who use the same one. Adds a lock button to the text bar: click to turn encryption on or off, right-click for quick settings.",
    authors: [{ name: "Andrei_SLAYER22", id: 0n }],
    dependencies: ["MessageEventsAPI", "MessageAccessoriesAPI", "ChatInputButtonAPI"],
    settings,

    chatBarButton: {
        icon: () => <LockIcon locked />,
        render: CryptButton,
    },

    renderMessageAccessory(props: any) {
        const content: string | undefined = props?.message?.content;
        if (!content || !content.startsWith(MARKER)) return null;
        return <DecryptedAccessory content={content} />;
    },

    start() {
        this.preSend = addMessagePreSendListener(async (_channelId, msg) => {
            const { passphrase, autoEncrypt, trigger } = settings.store;
            if (!passphrase || !msg.content) return;

            let plain = msg.content;
            if (!autoEncrypt) {
                if (!trigger || !plain.startsWith(trigger)) return;
                plain = plain.slice(trigger.length);
                if (!plain.trim()) return;
            }

            msg.content = await encryptText(plain, passphrase);
        });
    },

    stop() {
        removeMessagePreSendListener(this.preSend);
        decryptCache.clear();
    },

    preSend: undefined as any,
});
