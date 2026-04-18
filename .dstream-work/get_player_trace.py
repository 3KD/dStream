with open("apps/web/src/components/Player.tsx", "r") as f:
    lines = f.readlines()
    for i in range(160, 200):
        print(f"{i+1}: {lines[i].rstrip()}")
