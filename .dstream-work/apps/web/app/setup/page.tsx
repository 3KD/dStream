"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Server, Zap, ArrowRight, Download, CheckCircle2, AlertCircle } from "lucide-react";

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [domain, setDomain] = useState("");
  const [xmrAddress, setXmrAddress] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Response state
  const [setupComplete, setSetupComplete] = useState(false);
  const [autoApplied, setAutoApplied] = useState(false);
  const [generatedEnv, setGeneratedEnv] = useState("");
  const [projectPath, setProjectPath] = useState("path/to/dstream");

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, xmrAddress })
      });
      const data = await res.json();
      
      if (data.success) {
        setGeneratedEnv(data.envContent);
        setAutoApplied(data.autoApplied);
        if (data.projectPath) setProjectPath(data.projectPath);
        setSetupComplete(true);
        setStep(3);
      } else {
        alert("Setup failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error during setup generation.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([generatedEnv], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.env.production';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-white font-sans selection:bg-purple-500/30">
      
      {/* Abstract Background Decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
      </div>

      <div className="max-w-xl w-full z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 shadow-xl mb-6 shadow-purple-500/10">
            <Shield className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-4xl font-black tracking-tight mb-3">Initialize Node</h1>
          <p className="text-neutral-400 text-lg">
            Secure your dStream node with cryptographic infrastructure keys.
          </p>
        </div>

        <div className="bg-neutral-900/50 backdrop-blur-xl border border-neutral-800/50 rounded-3xl overflow-hidden shadow-2xl">
          
          {/* Progress Bar */}
          <div className="flex h-1 bg-neutral-800">
            <div className={`h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 w-${step === 1 ? '1/3' : step === 2 ? '2/3' : 'full'}`} />
          </div>

          <div className="p-8 md:p-10">
            
            {/* STEP 1: Basic Node Config */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-3 text-neutral-300 font-medium mb-2">
                  <Server className="w-5 h-5 text-blue-400" />
                  Step 1: Network Identity
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-neutral-400 mb-2 font-medium">Node Domain (Required)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. dstream.stream"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
                    />
                    <p className="text-xs text-neutral-500 mt-2">
                      The public domain where this node will be accessible. Used to configure embedded WebRTC TURN servers.
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button 
                    onClick={() => setStep(2)}
                    disabled={!domain}
                    className="flex items-center gap-2 px-6 py-3 bg-white text-black font-bold rounded-xl hover:bg-neutral-200 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Monetization/Wallet */}
            {step === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                <div className="flex items-center gap-3 text-neutral-300 font-medium mb-2">
                  <Zap className="w-5 h-5 text-purple-400" />
                  Step 2: Operator Monetization
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-neutral-400 mb-2 font-medium">Monero (XMR) Payout Address <span className="text-neutral-600 font-normal">(Optional)</span></label>
                    <textarea 
                      placeholder="49zL3oidgJ..."
                      value={xmrAddress}
                      onChange={(e) => setXmrAddress(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all outline-none font-mono text-sm h-32 resize-none break-all"
                    />
                    <p className="text-xs text-neutral-500 mt-2">
                      Leave blank if you do not want to configure De-Fi escrow and tipping features right now.
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex justify-between items-center">
                  <button 
                    onClick={() => setStep(1)}
                    className="text-neutral-400 hover:text-white transition-colors text-sm font-medium"
                  >
                    Back
                  </button>
                  <button 
                    onClick={handleGenerate}
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl hover:opacity-90 hover:shadow-lg hover:shadow-purple-500/20 active:scale-95 transition-all"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating...</span>
                    ) : (
                      "Generate Secure Secrets"
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Complete & Apply */}
            {step === 3 && (
              <div className="space-y-6 animate-in zoom-in-95 duration-500 text-center">
                <div className="flex justify-center mb-4">
                  <CheckCircle2 className="w-16 h-16 text-green-500" />
                </div>
                <h2 className="text-2xl font-bold">Node Secured</h2>
                
                {autoApplied ? (
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm">
                    High-entropy cryptographic secrets were successfully injected into your host's <b>.env.production</b> file!
                  </div>
                ) : (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 text-sm flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 font-bold"><AlertCircle className="w-5 h-5"/> Manual Action Required</div>
                    <p>Docker filesystem isolation prevented automatic writing. You must download the config file and place it in your dStream root directory.</p>
                    <button 
                      onClick={handleDownload}
                      className="mt-3 flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition active:scale-95"
                    >
                      <Download className="w-4 h-4" /> Download .env.production
                    </button>
                  </div>
                )}

                <div className="mt-8 pt-8 border-t border-neutral-800/50">
                  <p className="text-neutral-400 mb-4 font-medium">To apply these changes and launch your node:</p>
                  <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl relative group">
                    <code className="text-sm text-blue-400 font-mono block overflow-x-auto whitespace-pre">
                      {`cd ${projectPath}\ndocker compose --env-file .env.production up -d`}
                    </code>
                  </div>
                  <button 
                    onClick={() => router.push('/')}
                    className="mt-6 text-sm text-neutral-500 hover:text-white transition underline"
                  >
                    I have restarted the node (Go to Homepage)
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
