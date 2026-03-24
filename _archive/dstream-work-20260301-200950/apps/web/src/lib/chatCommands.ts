import { pubkeyParamToHex } from "./nostr-ids";

export type ChatCommand =
  | { type: "help" }
  | { type: "set_alias"; targetPubkey: string; alias: string }
  | { type: "mute"; targetPubkey: string }
  | { type: "unmute"; targetPubkey: string }
  | { type: "ban"; targetPubkey: string }
  | { type: "unban"; targetPubkey: string }
  | { type: "whisper"; recipients: string[]; message: string };

export type ChatCommandParseResult = { ok: true; command: ChatCommand } | { ok: false; error: string };

function normalizePubkey(input: string): string | null {
  return pubkeyParamToHex((input ?? "").trim());
}

function parseRecipientList(inputRaw: string): string[] {
  const values = (inputRaw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const value of values) {
    const pk = normalizePubkey(value);
    if (pk && !out.includes(pk)) out.push(pk);
  }
  return out;
}

export function parseChatCommand(inputRaw: string): ChatCommandParseResult | null {
  const input = (inputRaw ?? "").trim();
  if (!input.startsWith("/")) return null;

  if (/^\/help$/i.test(input)) return { ok: true, command: { type: "help" } };

  const whisperParen = input.match(/^\/wh\(([^)]+)\)\s+([\s\S]+)$/i);
  if (whisperParen) {
    const recipients = parseRecipientList(whisperParen[1] ?? "");
    const message = (whisperParen[2] ?? "").trim();
    if (recipients.length === 0) return { ok: false, error: "Whisper recipients must be valid npub… or 64-hex pubkeys." };
    if (!message) return { ok: false, error: "Whisper message is required." };
    return { ok: true, command: { type: "whisper", recipients, message } };
  }

  const whisperSimple = input.match(/^\/(?:w|wh)\s+([^\s]+)\s+([\s\S]+)$/i);
  if (whisperSimple) {
    const recipients = parseRecipientList(whisperSimple[1] ?? "");
    const message = (whisperSimple[2] ?? "").trim();
    if (recipients.length === 0) return { ok: false, error: "Whisper recipient must be a valid npub… or 64-hex pubkey." };
    if (!message) return { ok: false, error: "Whisper message is required." };
    return { ok: true, command: { type: "whisper", recipients, message } };
  }

  const alias = input.match(/^\/name\s+([^\s]+)\s+([\s\S]+)$/i);
  if (alias) {
    const targetPubkey = normalizePubkey(alias[1] ?? "");
    const aliasValue = (alias[2] ?? "").trim();
    if (!targetPubkey) return { ok: false, error: "Alias target must be a valid npub… or 64-hex pubkey." };
    if (!aliasValue) return { ok: false, error: "Alias value is required." };
    return {
      ok: true,
      command: {
        type: "set_alias",
        targetPubkey,
        alias: aliasValue.replace(/\s+/g, " ").slice(0, 48)
      }
    };
  }

  const singleTarget = input.match(/^\/(mute|unmute|ban|unban)\s+([^\s]+)$/i);
  if (singleTarget) {
    const op = (singleTarget[1] ?? "").toLowerCase();
    const targetPubkey = normalizePubkey(singleTarget[2] ?? "");
    if (!targetPubkey) return { ok: false, error: "Command target must be a valid npub… or 64-hex pubkey." };
    if (op === "mute") return { ok: true, command: { type: "mute", targetPubkey } };
    if (op === "unmute") return { ok: true, command: { type: "unmute", targetPubkey } };
    if (op === "ban") return { ok: true, command: { type: "ban", targetPubkey } };
    return { ok: true, command: { type: "unban", targetPubkey } };
  }

  return {
    ok: false,
    error: "Unknown command. Try /help, /name, /mute, /unmute, /ban, /unban, /w, or /wh(user1,user2)."
  };
}
