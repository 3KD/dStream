with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    code = f.read()

import_target = """import { ChevronDown, ChevronUp, Copy, Flag, Star, X, Network, Share2, ArrowDownToLine, ArrowUpFromLine, Database } from "lucide-react";"""
import_replacement = """import { ChevronDown, ChevronUp, Copy, Flag, Star, X, Network, Share2, ArrowDownToLine, ArrowUpFromLine, Database, Download, Upload } from "lucide-react";"""

if import_target in code:
    code = code.replace(import_target, import_replacement)
    with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "w") as f:
        f.write(code)
    print("PATCHED LUCIDE")
else:
    print("NOT FOUND")
