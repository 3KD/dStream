"use client";

import { useEffect, useState, useRef } from "react";
import { Mic, MicOff, Type, AlertCircle } from "lucide-react";
import { useIdentity } from "@/context/IdentityContext";
import { pool, RELAYS } from "@/lib/nostr";

// Web Speech API types
interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
}

interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
    [index: number]: SpeechRecognitionResult;
    length: number;
}

interface SpeechRecognitionResult {
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
    length: number;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
}

interface CaptionOverlayProps {
    streamId: string; // The stream these captions belong to
    isBroadcaster: boolean; // If true, generates captions. If false, consumes them.
}

const KIND_CAPTION = 21000; // Ephemeral event kind for captions

export function CaptionOverlay({ streamId, isBroadcaster }: CaptionOverlayProps) {
    const { identity } = useIdentity();
    const [captions, setCaptions] = useState<{ id: string, text: string, final: boolean }[]>([]);
    const [enabled, setEnabled] = useState(false); // For viewers to toggle visibility
    const [generating, setGenerating] = useState(false); // For broadcaster to toggle generation
    const [error, setError] = useState<string | null>(null);

    // Broadcaster: Speech Recognition
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if (!isBroadcaster || typeof window === "undefined") return;

        // Check browser support
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError("Browser does not support Speech Recognition.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US"; // Could be made configurable

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = "";
            let finalTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            // Update local display
            const newCaptions: { id: string, text: string, final: boolean }[] = [];
            if (finalTranscript) newCaptions.push({ id: `final-${Date.now()}`, text: finalTranscript, final: true });
            if (interimTranscript) newCaptions.push({ id: `interim`, text: interimTranscript, final: false });

            // Only show last few lines locally to avoid clutter
            setCaptions(prev => {
                const combined = [...prev.filter(c => c.final), ...newCaptions];
                return combined.slice(-3); // Keep last 3 lines
            });

            // Publish to Nostr (Only final results to save bandwidth/relays)
            if (finalTranscript && identity?.nostrPrivateKey) {
                publishCaption(finalTranscript);
            }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.warn("Speech recognition error", event.error);
            if (event.error === 'not-allowed') {
                setError("Microphone permission denied.");
                setGenerating(false);
            }
        };

        recognition.onend = () => {
            // Auto-restart if we didn't manually stop
            if (generating) {
                try {
                    recognition.start();
                } catch (e) {
                    setGenerating(false);
                }
            }
        };

        recognitionRef.current = recognition;

        return () => {
            if (recognitionRef.current) recognitionRef.current.stop();
        };
    }, [isBroadcaster, identity]);

    // Handle Start/Stop
    useEffect(() => {
        if (!recognitionRef.current) return;
        if (generating) {
            try {
                recognitionRef.current.start();
                setError(null);
            } catch (e) {
                // Already started
            }
        } else {
            recognitionRef.current.stop();
        }
    }, [generating]);


    // Viewer: Subscribe to Captions
    useEffect(() => {
        if (isBroadcaster || !enabled) return;

        const sub = pool.subscribeMany(RELAYS, [
            {
                kinds: [KIND_CAPTION],
                '#d': [streamId], // Tagged with stream ID
                limit: 1 // Only new ones
            }
        ] as any, {
            onevent(event) {
                setCaptions(prev => [...prev, { id: event.id, text: event.content, final: true }].slice(-3));
            }
        });

        return () => sub.close();
    }, [isBroadcaster, enabled, streamId]);


    // Helper to publish
    const publishCaption = async (text: string) => {
        if (!identity?.nostrPublicKey) return;

        try {
            const event = {
                kind: KIND_CAPTION,
                pubkey: identity.nostrPublicKey,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['d', streamId]],
                content: text
            };

            // @ts-ignore
            const signed = await window.nostr?.signEvent(event) || await identity.signNostrEvent(event);
            if (signed) {
                await Promise.any(pool.publish(RELAYS, signed));
            }
        } catch (e) {
            console.error("Failed to publish caption", e);
        }
    };

    if (error && isBroadcaster) {
        return (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-900/90 text-white px-3 py-1 rounded-full text-xs flex items-center gap-2 z-50">
                <AlertCircle className="w-3 h-3" /> {error}
                <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
            </div>
        );
    }

    if (isBroadcaster) {
        return (
            <div className="absolute bottom-4 left-4 z-50">
                <button
                    onClick={() => setGenerating(!generating)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-md transition-colors ${generating
                        ? 'bg-red-500/80 text-white hover:bg-red-600/80 animate-pulse'
                        : 'bg-black/50 text-white hover:bg-black/70'
                        }`}
                >
                    {generating ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                    <span className="text-xs font-bold uppercase">{generating ? 'CC ON' : 'CC OFF'}</span>
                </button>

                {generating && captions.length > 0 && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 md:w-96 flex flex-col items-start gap-1 p-0 pointer-events-none">
                        {captions.map((c, i) => (
                            <span key={c.id || i} className={`px-2 py-1 rounded bg-black/60 text-white text-sm md:text-base backdrop-blur-sm ${!c.final ? 'opacity-80 italic' : ''}`}>
                                {c.text}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Viewer UI
    return (
        <>
            <div className="absolute top-4 right-16 z-40">
                <button
                    onClick={() => setEnabled(!enabled)}
                    className={`p-2 rounded-full transition-colors ${enabled ? 'bg-white text-black' : 'bg-black/50 text-white hover:bg-black/70'}`}
                    title={enabled ? "Hide Captions" : "Show Captions"}
                >
                    <Type className="w-4 h-4" />
                </button>
            </div>

            {enabled && captions.length > 0 && (
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[80%] max-w-2xl flex flex-col items-center gap-2 pointer-events-none z-40">
                    {captions.map((c, i) => (
                        <span key={c.id || i} className="px-3 py-1.5 rounded-lg bg-black/70 text-white font-medium text-center shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
                            {c.text}
                        </span>
                    ))}
                </div>
            )}
        </>
    );
}

// Missing icon import hack for compilation (X is used in error)
import { X } from "lucide-react";
