with open("apps/web/app/page.tsx", "r") as f:
    lines = f.readlines()
    for i in range(240, 270):
        print(lines[i].rstrip())
