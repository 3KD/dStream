import { useState } from "react";
import { Wallet, X } from "lucide-react";
import { MoneroManager } from "../wallet/MoneroManager";

export function WalletBadge() {
    const [showModal, setShowModal] = useState(false);

    return (
        <>
            <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800/50 border border-neutral-600 rounded-full text-sm hover:bg-neutral-700 hover:border-orange-500/50 hover:text-orange-400 transition-all group"
                title="Manage Monero Wallet"
            >
                <div className="w-2 h-2 rounded-full bg-orange-500 group-hover:animate-pulse" />
                <span className="text-neutral-300 font-medium">Wallet</span>
            </button>

            {showModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
                    <div className="relative w-full max-w-2xl animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                        <button
                            onClick={() => setShowModal(false)}
                            className="absolute -top-12 right-0 text-neutral-400 hover:text-white flex items-center gap-2"
                        >
                            Close <X className="w-5 h-5" />
                        </button>
                        <MoneroManager />
                    </div>
                </div>
            )}
        </>
    );
}
