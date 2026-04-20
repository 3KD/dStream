"use client";

import { useSocial } from "@/context/SocialContext";

export function PreferencesEditor() {
  const social = useSocial();
  const settings = social.settings;

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
      <h2 className="text-sm font-semibold text-neutral-200">Playback &amp; P2P</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.presenceEnabled}
            onChange={(e) => social.updateSettings({ presenceEnabled: e.target.checked })}
            className="accent-blue-500"
          />
          Share presence by default
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.p2pAssistEnabled}
            onChange={(e) => social.updateSettings({ p2pAssistEnabled: e.target.checked })}
            className="accent-blue-500"
          />
          Enable P2P assist by default (when allowed)
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.playbackAutoplayMuted}
            onChange={(e) => social.updateSettings({ playbackAutoplayMuted: e.target.checked })}
            className="accent-blue-500"
          />
          Autoplay muted
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.showMatureContent}
            onChange={(e) => social.updateSettings({ showMatureContent: e.target.checked })}
            className="accent-blue-500"
          />
          Show mature streams
        </label>

        <label className="flex items-center gap-2 select-none">
          <span className="text-neutral-400">P2P peers</span>
          <select
            value={settings.p2pPeerMode}
            onChange={(e) => social.setP2PPeerMode(e.target.value === "trusted_only" ? "trusted_only" : "any")}
            className="ml-2 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-sm text-neutral-200"
          >
            <option value="any">Any (default)</option>
            <option value="trusted_only">Trusted only</option>
          </select>
        </label>

        <label className="flex items-center gap-2 select-none">
          <span className="text-neutral-400">Default host mode</span>
          <select
            value={settings.broadcastHostMode}
            onChange={(e) =>
              social.updateSettings({
                broadcastHostMode: e.target.value === "host_only" ? "host_only" : "p2p_economy"
              })
            }
            className="ml-2 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-sm text-neutral-200"
          >
            <option value="p2p_economy">P2P Economy</option>
            <option value="host_only">Host-Only</option>
          </select>
        </label>

        <label className="flex items-center gap-2 select-none">
          <span className="text-neutral-400">Default threshold (T)</span>
          <input
            type="number"
            min={1}
            max={64}
            value={settings.broadcastRebroadcastThreshold}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              if (!Number.isInteger(parsed) || parsed <= 0) return;
              social.updateSettings({
                broadcastRebroadcastThreshold: Math.max(1, Math.min(Math.trunc(parsed), 64))
              });
            }}
            className="ml-2 w-24 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-sm font-mono text-neutral-200"
            disabled={settings.broadcastHostMode === "host_only"}
          />
        </label>
      </div>
    </section>
  );
}
