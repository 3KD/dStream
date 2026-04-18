with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    code = f.read()

import re

match = re.search(r"const globalPlayerProps = useMemo.+?playbackStateKey.+?\]\);", code, re.DOTALL)
if match:
    print("FOUND")
else:
    print("NOT FOUND")
