with open("apps/web/src/context/SocialContext.tsx", "r") as f:
    code = f.read()

import re
match = re.search(r"const value = useMemo\(\(\) => \(\{.+?\}\), \[.+?\]\);", code, re.DOTALL)
if match:
    print(match.group(0))
