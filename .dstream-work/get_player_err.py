with open("apps/web/src/components/Player.tsx", "r") as f:
    lines = f.readlines()
    for i in range(650, 680):
        print(lines[i].rstrip())
