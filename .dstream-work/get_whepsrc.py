with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    code = f.read()

import re

match = re.search(r"const whepSrc = (.+);", code)
if match:
    print("WHEPSRC IS:")
    print(match.group(0))
else:
    print("NOT FOUND")
