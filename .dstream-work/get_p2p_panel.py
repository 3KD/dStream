with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    code = f.read()

import re
match = re.search(r"function P2PStatsPanel.+?return \(.+?\);.+?\}", code, re.DOTALL)
if match:
    print(match.group(0))

