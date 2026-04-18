with open("apps/web/src/lib/p2p/hlsFragmentLoader.ts", "r") as f:
    code = f.read()

target = """  private readonly httpLoader: Loader<FragmentLoaderContext>;
  private readonly swarm: P2PSwarm | null;
  private readonly integrity: IntegritySession | null;
  private readonly httpRewrite: { from: string; to: string } | null;
  private aborted = false;

  context: FragmentLoaderContext | null = null;
  stats: LoaderStats = makeStats(0);

  constructor(config: any) {
    this.config = config;
    const HttpLoader = config.loader;
    this.httpLoader = new HttpLoader(config);
    this.swarm = (config as any)?.dstreamP2PSwarm ?? null;
    this.integrity = (config as any)?.dstreamIntegritySession ?? null;
    this.httpRewrite = (config as any)?.dstreamIntegrityHttpRewrite ?? null;
  }"""

replacement = """  private readonly httpLoader: Loader<FragmentLoaderContext>;
  private aborted = false;

  context: FragmentLoaderContext | null = null;
  stats: LoaderStats = makeStats(0);

  get swarm(): P2PSwarm | null {
    return (this.config as any)?.dstreamP2PSwarm ?? null;
  }

  get integrity(): IntegritySession | null {
    return (this.config as any)?.dstreamIntegritySession ?? null;
  }

  get httpRewrite(): { from: string; to: string } | null {
    return (this.config as any)?.dstreamIntegrityHttpRewrite ?? null;
  }

  constructor(config: any) {
    this.config = config;
    const HttpLoader = config.loader;
    this.httpLoader = new HttpLoader(config);
  }"""

code = code.replace(target, replacement)

with open("apps/web/src/lib/p2p/hlsFragmentLoader.ts", "w") as f:
    f.write(code)

print("PATCHED FLOADER")
