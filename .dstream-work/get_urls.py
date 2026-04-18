with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    code = f.read()

import re

# find playbackStreamUrl
match = re.search(r"const playbackStreamUrl = useMemo\(\(\) => \{.+?return [^}]+\}, \[.+?\]\);", code, re.DOTALL)
if match:
    print("WATCHPAGE HLS:")
    print(match.group(0))

import re

# find streamUrl
match = re.search(r"const streamUrl = useMemo\(\(\) => \{.+?return [^}]+\}, \[.+?\]\);", code, re.DOTALL)
if match:
    print("STREAM URL:")
    print(match.group(0))

# find whepUrl
match2 = re.search(r"const whepUrl = useMemo\(\(\) => \{.+?return [^}]+\}, \[.+?\]\);", code, re.DOTALL)
if match2:
    print("WHEP URL:")
    print(match2.group(0))

