with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    lines = f.readlines()
    for i in range(370, 395):
        print(lines[i].rstrip())
