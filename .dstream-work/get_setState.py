with open("apps/web/app/watch/[pubkey]/[...streamId]/page.tsx", "r") as f:
    lines = f.readlines()
    for i, line in enumerate(lines):
        if "set" in line and "UseState" not in line and "useState" not in line and "useEffect" not in line and "useCallback" not in line and "onClick" not in line and "onChange" not in line:
            print(f"{i+1}: {line.rstrip()}")
