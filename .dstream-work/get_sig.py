with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    lines = f.readlines()
    for i in range(350, 368):
        print(lines[i].rstrip())
