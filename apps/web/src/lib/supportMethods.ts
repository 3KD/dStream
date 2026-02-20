
import { MoneroLogo } from "@/components/icons/MoneroLogo";
import { ReactNode } from "react";

export type SupportMethodType = "crypto" | "link";

export interface SupportMethod {
    id: string;
    name: string;
    value: string; // Address or Handle
    type: SupportMethodType;
    uriScheme: (value: string) => string; // Function to generate the URI
    color: string;
    icon?: React.FC<{ className?: string }>;
}

export const SUPPORT_METHODS: SupportMethod[] = [
    {
        id: "monero",
        name: "Monero (Private)",
        value: "49zL3oidgJbD6DeMheen873myfW1Jkp2tHiQJWXD7L64gjMjQ2pjFmjeksziP3CGKA1rfeLMCtgEqbUWBmhzL9YGP6X5w42",
        type: "crypto",
        uriScheme: (address) => `monero:${address}`,
        color: "bg-orange-600 hover:bg-orange-700",
        icon: MoneroLogo
    },
    {
        id: "venmo",
        name: "Venmo",
        value: "dstream", // Placeholder
        type: "link",
        uriScheme: (handle) => `https://venmo.com/${handle}`,
        color: "bg-[#008CFF] hover:bg-[#0070cc]"
    },
    {
        id: "cashapp",
        name: "CashApp",
        value: "dstream", // Placeholder
        type: "link",
        uriScheme: (handle) => `https://cash.app/$${handle}`,
        color: "bg-[#00D632] hover:bg-[#00b329]"
    },
    {
        id: "paypal",
        name: "PayPal",
        value: "dstream", // Placeholder
        type: "link",
        uriScheme: (handle) => `https://paypal.me/${handle}`,
        color: "bg-[#003087] hover:bg-[#00266d]"
    }
];
