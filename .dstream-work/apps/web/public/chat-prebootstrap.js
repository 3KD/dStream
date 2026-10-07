(function () {
  "use strict";

  var GLOBAL_KEY = "__dstreamPreHydrationChatBootstrap";
  var RELAY_STORAGE_KEY = "dstream_nostr_relays_override_v1";
  var BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

  function validRelay(value) {
    try {
      var url = new URL(String(value || "").trim());
      return url.protocol === "ws:" || url.protocol === "wss:";
    } catch {
      return false;
    }
  }

  function uniqueRelays(values) {
    var seen = Object.create(null);
    var relays = [];
    for (var index = 0; index < values.length; index += 1) {
      var relay = String(values[index] || "").trim();
      if (!validRelay(relay) || seen[relay]) continue;
      seen[relay] = true;
      relays.push(relay);
      if (relays.length >= 6) break;
    }
    return relays;
  }

  function parseRelays(raw) {
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return uniqueRelays(parsed);
    } catch {
      // Fall back to a comma or newline separated list.
    }
    return uniqueRelays(String(raw).split(/[\n,]+/));
  }

  function bech32Polymod(values) {
    var generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    var checksum = 1;
    for (var index = 0; index < values.length; index += 1) {
      var top = checksum >>> 25;
      checksum = ((checksum & 0x1ffffff) << 5) ^ values[index];
      for (var bit = 0; bit < 5; bit += 1) {
        if ((top >>> bit) & 1) checksum ^= generators[bit];
      }
    }
    return checksum >>> 0;
  }

  function decodeNpub(value) {
    var input = String(value || "");
    if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null;
    input = input.toLowerCase();
    var separator = input.lastIndexOf("1");
    if (separator <= 0 || input.slice(0, separator) !== "npub") return null;

    var words = [];
    for (var index = separator + 1; index < input.length; index += 1) {
      var word = BECH32_ALPHABET.indexOf(input[index]);
      if (word < 0) return null;
      words.push(word);
    }
    if (words.length < 7) return null;

    var checksumInput = [3, 3, 3, 3, 0, 14, 16, 21, 2].concat(words);
    if (bech32Polymod(checksumInput) !== 1) return null;

    var payload = words.slice(0, -6);
    var accumulator = 0;
    var bits = 0;
    var bytes = [];
    for (var payloadIndex = 0; payloadIndex < payload.length; payloadIndex += 1) {
      accumulator = (accumulator << 5) | payload[payloadIndex];
      bits += 5;
      while (bits >= 8) {
        bits -= 8;
        bytes.push((accumulator >>> bits) & 255);
      }
    }
    if (bits >= 5 || ((accumulator << (8 - bits)) & 255) !== 0 || bytes.length !== 32) return null;
    return bytes.map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
  }

  function readScope() {
    var match = window.location.pathname.match(/^\/watch\/([^/]+)\/(.+)$/);
    if (!match) return null;
    try {
      var pubkeyParam = decodeURIComponent(match[1]);
      var streamId = match[2].split("/").map(decodeURIComponent).join("/");
      var pubkey = /^[0-9a-f]{64}$/i.test(pubkeyParam) ? pubkeyParam.toLowerCase() : decodeNpub(pubkeyParam);
      return pubkey && streamId ? { streamPubkey: pubkey, streamId: streamId } : null;
    } catch {
      return null;
    }
  }

  function configuredRelays() {
    var script = document.currentScript || document.querySelector("script[data-dstream-chat-prebootstrap]");
    var defaults = parseRelays(script && script.getAttribute("data-relays"));
    try {
      var override = parseRelays(window.localStorage.getItem(RELAY_STORAGE_KEY));
      return override.length ? override : defaults;
    } catch {
      return defaults;
    }
  }

  var scope = readScope();
  var relays = configuredRelays();
  if (!scope || relays.length === 0 || window[GLOBAL_KEY]) return;

  var listeners = [];
  var bufferedEvents = [];
  var seenEventIds = Object.create(null);
  var sockets = [];
  var settledRelays = Object.create(null);
  var settled = false;
  var closed = false;
  var subscriptionId = "dstream-chat-early-" + Math.random().toString(36).slice(2);
  var filter = {
    kinds: [1311, 1],
    "#a": ["30311:" + scope.streamPubkey + ":" + scope.streamId],
    since: Math.floor(Date.now() / 1000) - 86400,
    limit: 100
  };

  function emitEvent(event) {
    for (var index = 0; index < listeners.length; index += 1) listeners[index].onevent(event);
  }

  function emitEose() {
    for (var index = 0; index < listeners.length; index += 1) listeners[index].oneose();
  }

  function settleRelay(relay) {
    if (settledRelays[relay]) return;
    settledRelays[relay] = true;
    if (Object.keys(settledRelays).length < relays.length) return;
    settle();
  }

  function settle() {
    if (closed || settled) return;
    settled = true;
    emitEose();
  }

  var state = {
    version: 1,
    streamPubkey: scope.streamPubkey,
    streamId: scope.streamId,
    relays: relays.slice(),
    attach: function (listener) {
      if (closed) return function () {};
      listeners.push(listener);
      for (var index = 0; index < bufferedEvents.length; index += 1) listener.onevent(bufferedEvents[index]);
      if (settled) listener.oneose();
      return function () {
        listeners = listeners.filter(function (candidate) { return candidate !== listener; });
      };
    },
    close: function () {
      if (closed) return;
      closed = true;
      listeners = [];
      for (var index = 0; index < sockets.length; index += 1) {
        try { sockets[index].close(); } catch {}
      }
      if (window[GLOBAL_KEY] === state) window[GLOBAL_KEY] = null;
    }
  };
  window[GLOBAL_KEY] = state;

  for (var relayIndex = 0; relayIndex < relays.length; relayIndex += 1) {
    (function (relay) {
      try {
        var socket = new WebSocket(relay);
        sockets.push(socket);
        socket.addEventListener("open", function () {
          if (!closed) socket.send(JSON.stringify(["REQ", subscriptionId, filter]));
        });
        socket.addEventListener("message", function (message) {
          if (closed) return;
          var payload;
          var rawMessage = String(message.data);
          if (rawMessage.length > 262144) return;
          try { payload = JSON.parse(rawMessage); } catch { return; }
          if (payload[0] === "EVENT" && payload[1] === subscriptionId && payload[2]) {
            var event = payload[2];
            var eventId = typeof event.id === "string" ? event.id : "";
            if (eventId && seenEventIds[eventId]) return;
            if (eventId) seenEventIds[eventId] = true;
            bufferedEvents.push(event);
            if (bufferedEvents.length > 100) bufferedEvents.shift();
            emitEvent(event);
          } else if (payload[0] === "EOSE" && payload[1] === subscriptionId) {
            settleRelay(relay);
          }
        });
        socket.addEventListener("error", function () { settleRelay(relay); });
        socket.addEventListener("close", function () { settleRelay(relay); });
      } catch {
        settleRelay(relay);
      }
    })(relays[relayIndex]);
  }

  window.setTimeout(settle, 3000);
})();
