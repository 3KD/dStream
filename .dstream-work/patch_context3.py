with open("apps/web/src/context/GlobalPlayerContext.tsx", "r") as f:
    code = f.read()

target = """export function GlobalPlayerProvider({ children }: { children: ReactNode }) {
  const [portals, setPortals] = useState<Record<string, HTMLElement>>({});
  const [activeRequest, setActiveRequest] = useState<{ id: string; props: any } | null>(null);
  const fallbackContainerRef = useRef<HTMLDivElement | null>(null);

  const registerPortal = useCallback((id: string, el: HTMLElement) => {
    setPortals((prev) => ({ ...prev, [id]: el }));
  }, []);

  const unregisterPortal = useCallback((id: string) => {
    setPortals((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);"""

replacement = """export function GlobalPlayerProvider({ children }: { children: ReactNode }) {
  const [forceTick, setForceTick] = useState(0);
  const portalsRef = useRef<Record<string, HTMLElement>>({});
  const [activeRequest, setActiveRequest] = useState<{ id: string; props: any } | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const fallbackContainerRef = useRef<HTMLDivElement | null>(null);

  const registerPortal = useCallback((id: string, el: HTMLElement) => {
    portalsRef.current[id] = el;
    // We only force a render if this newly registered portal is CURRENTLY the active request
    // This allows activeRequest's targetEl to instantly update from fallback -> portal.
    if (activeRequestIdRef.current === id) setForceTick((t) => t + 1);
  }, []);

  const unregisterPortal = useCallback((id: string) => {
    delete portalsRef.current[id];
    // If we literally just destroyed the portal that is currently housing the active player,
    // we MUST force a re-render so it safely moves to fallbackContainerRef immediately.
    if (activeRequestIdRef.current === id) setForceTick((t) => t + 1);
  }, []);"""

target2 = """  const requestPortal = useCallback((id: string, props: any) => {
    setActiveRequest((prev) => {"""

replacement2 = """  const requestPortal = useCallback((id: string, props: any) => {
    activeRequestIdRef.current = id;
    setActiveRequest((prev) => {"""

target3 = """  // If the active request's portal exists, render it there.
  // Otherwise, render into the fallback persistent container so it NEVER unmounts and wipes the buffer!
  let targetEl = null;
  if (activeRequest && portals[activeRequest.id]) {
    targetEl = portals[activeRequest.id];
  } else if (activeRequest && fallbackContainerRef.current) {
    targetEl = fallbackContainerRef.current;
  }"""

replacement3 = """  // If the active request's portal exists, render it there.
  // Otherwise, render into the fallback persistent container so it NEVER unmounts and wipes the buffer!
  let targetEl = null;
  if (activeRequest && portalsRef.current[activeRequest.id]) {
    targetEl = portalsRef.current[activeRequest.id];
  } else if (activeRequest && fallbackContainerRef.current) {
    targetEl = fallbackContainerRef.current;
  }"""

target4 = """export function GlobalPlayerSlot({ id, playerProps }: { id: string; playerProps: any }) {
  const { registerPortal, unregisterPortal, requestPortal } = useGlobalPlayer();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (container) {
      registerPortal(id, container);
      return () => unregisterPortal(id);
    }
  }, [container, id, registerPortal, unregisterPortal]);

  useEffect(() => {
    requestPortal(id, playerProps);
  }, [id, playerProps, requestPortal]);

  return <div ref={setContainer} className="w-full h-full relative z-0" data-player-slot={id} />;
}"""

replacement4 = """export function GlobalPlayerSlot({ id, playerProps }: { id: string; playerProps: any }) {
  const { registerPortal, unregisterPortal, requestPortal } = useGlobalPlayer();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (containerRef.current) {
      registerPortal(id, containerRef.current);
    }
    return () => unregisterPortal(id);
  }, [id, registerPortal, unregisterPortal]);

  useEffect(() => {
    requestPortal(id, playerProps);
  }, [id, playerProps, requestPortal]);

  return <div ref={containerRef} className="w-full h-full relative z-0" data-player-slot={id} />;
}"""

if target in code:
    code = code.replace(target, replacement)
    code = code.replace(target2, replacement2)
    code = code.replace(target3, replacement3)
    code = code.replace(target4, replacement4)
    with open("apps/web/src/context/GlobalPlayerContext.tsx", "w") as f:
        f.write(code)
    print("PATCHED CONTEXT SAFELY")
else:
    print("NOT FOUND")
