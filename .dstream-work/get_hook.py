with open("apps/web/src/components/Player.tsx", "r") as f:
    code = f.read()

import re
match = re.search(r"playbackStateKey", code)
print("done")
