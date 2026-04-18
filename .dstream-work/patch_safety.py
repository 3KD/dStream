with open("apps/web/src/context/GlobalPlayerContext.tsx", "r") as f:
    code = f.read()

target = """         const k1 = Object.keys(prev.props);
         const k2 = Object.keys(props);"""

replacement = """         const k1 = Object.keys(prev.props || {});
         const k2 = Object.keys(props || {});"""

target2 = """      <div ref={fallbackContainerRef} style={{ display: "none" }} aria-hidden="true" />
      {targetEl && activeRequest && createPortal(<Player {...activeRequest.props} />, targetEl)}"""

replacement2 = """      <div ref={fallbackContainerRef} style={{ display: "none" }} aria-hidden="true" />
      {targetEl && activeRequest ? createPortal(<Player {...(activeRequest.props || {})} />, targetEl) : null}"""

if target in code:
    code = code.replace(target, replacement)
    code = code.replace(target2, replacement2)
    with open("apps/web/src/context/GlobalPlayerContext.tsx", "w") as f:
        f.write(code)
    print("SAFETY APPLIED")
else:
    print("NOT FOUND")
