"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Legacy redirect: /broadcast -> /dashboard?tab=broadcast
export default function BroadcastRedirectPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/dashboard?tab=broadcast");
    }, [router]);

    return (
        <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
            <div className="text-center">
                <p className="text-neutral-400 animate-pulse">Redirecting to Dashboard...</p>
            </div>
        </div>
    );
}
