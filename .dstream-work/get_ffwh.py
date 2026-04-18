with open("apps/web/src/components/Player.tsx", "r") as f:
    lines = f.readlines()
    for i in range(605, 630):
        print(lines[i].rstrip())
