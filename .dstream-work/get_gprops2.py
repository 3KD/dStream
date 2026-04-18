with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    lines = f.readlines()
    for i in range(1580, 1620):
        print(f"{i+1}: {lines[i].rstrip()}")
