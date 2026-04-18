with open("apps/web/src/hooks/useStreamPresence.ts", "r") as f:
    code = f.read()

import re
match = re.search(r"useEffect\(\(\) => \{.+?\}, \[.+?\]\);", code, re.DOTALL)
if match:
    print(match.group(0))

