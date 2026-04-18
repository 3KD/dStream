with open("apps/web/src/components/Player.tsx", "r") as f:
    lines = f.readlines()
    for i in range(710, 750):
        print(lines[i].rstrip())
