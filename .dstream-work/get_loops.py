with open("apps/web/src/components/Player.tsx", "r") as f:
    code = f.read()

import re
match = re.search(r"const onVolumeChange = \(\) => \{(.+?)\};", code, re.DOTALL)
if match:
    print(match.group(0))

