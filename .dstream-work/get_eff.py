with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    lines = f.readlines()
    for i in range(1550, 1560):
        print(lines[i].rstrip())

