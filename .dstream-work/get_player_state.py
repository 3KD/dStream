with open("apps/web/src/components/Player.tsx", "r") as f:
    lines = f.readlines()
    for i in range(190, 210):
        print(f"{i+1}: {lines[i].rstrip()}")
