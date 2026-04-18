with open("apps/web/src/components/Player.tsx", "r") as f:
    lines = f.readlines()
    for i in range(670, 710):
        print(lines[i].rstrip())
