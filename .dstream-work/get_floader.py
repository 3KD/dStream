with open("apps/web/src/lib/p2p/hlsFragmentLoader.ts", "r") as f:
    lines = f.readlines()
    for i in range(70, 95):
        print(lines[i].rstrip())
