import { NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  try {
    const { domain, xmrAddress, email } = await req.json();

    // Generate highly secure entropy for the node
    const sessionSecret = crypto.randomBytes(32).toString('hex');
    const turnPassword = crypto.randomBytes(16).toString('hex');
    const walletRpcPass = crypto.randomBytes(16).toString('hex');

    // Attempt to locate .env.production.example (could be in various places depending on run mode)
    const possiblePaths = [
      path.join(process.cwd(), '../../.env.production.example'), // Turborepo root
      path.join(process.cwd(), '../.env.production.example'),    // Standalone
      path.join(process.cwd(), '.env.production.example'),       // Fallback
    ];

    let exampleContent = '';
    let foundPath = '';

    for (const p of possiblePaths) {
      try {
        exampleContent = await fs.readFile(p, 'utf-8');
        foundPath = p;
        break;
      } catch (err) {
        // Continue to next path
      }
    }

    if (!exampleContent) {
      // Fallback template if we can't find the file on disk (e.g. strict docker deploy)
      exampleContent = `
# Generated Node Configuration
NEXT_PUBLIC_WEBRTC_ICE_SERVERS=[{"urls":"stun:stun.cloudflare.com:3478"},{"urls":["turn:turn.__DOMAIN__:3478?transport=udp","turn:turn.__DOMAIN__:3478?transport=tcp"],"username":"dstream-turn","credential":"__TURN_PASSWORD__"}]
NEXT_PUBLIC_HLS_ORIGIN=https://__DOMAIN__
NEXT_PUBLIC_SUPPORT_XMR_ADDRESS=__XMR_ADDRESS__

TURN_REALM=__DOMAIN__
TURN_PASSWORD=__TURN_PASSWORD__
DSTREAM_XMR_WALLET_RPC_PASS=__WALLET_RPC_PASS__
DSTREAM_XMR_SESSION_SECRET=__SESSION_SECRET__
`;
    }

    // Replace the placeholders with our generated secrets and user inputs
    let newEnvContent = exampleContent
      .replace(/replace-with-a-long-random-secret-before-production-deploy-0123456789/g, sessionSecret)
      .replace(/dev-session-secret-0123456789abcdef/g, sessionSecret)
      .replace(/replace-turn-password/g, turnPassword)
      .replace(/replace-wallet-rpc-password/g, walletRpcPass);

    if (domain) {
      newEnvContent = newEnvContent
        .replace(/turn\.example\.com/g, `turn.${domain}`)
        .replace(/https:\/\/stream\.example\.com/g, `https://${domain}`)
        .replace(/origin\.example\.com/g, domain)
        .replace(/__DOMAIN__/g, domain);
    }

    if (xmrAddress) {
       // Only replace if they provided something
       newEnvContent = newEnvContent.replace(/NEXT_PUBLIC_SUPPORT_XMR_ADDRESS=.*/, `NEXT_PUBLIC_SUPPORT_XMR_ADDRESS=${xmrAddress}`);
       newEnvContent = newEnvContent.replace(/__XMR_ADDRESS__/g, xmrAddress);
    }

    // Try to automatically write the file back to the host filesystem
    let autoApplied = false;
    if (foundPath) {
      try {
        const outPath = foundPath.replace('.example', '');
        await fs.writeFile(outPath, newEnvContent, 'utf-8');
        autoApplied = true;
      } catch (err) {
        console.warn("Could not auto-write .env.production (Docker filesystem isolation). Failsafe enabled.");
      }
    }

    return NextResponse.json({
      success: true,
      autoApplied,
      envContent: newEnvContent,
      projectPath: foundPath ? path.dirname(foundPath) : process.cwd(),
      message: autoApplied 
        ? "Secrets securely generated and automatically applied to your server." 
        : "Secrets generated. Please download them to complete setup."
    });

  } catch (error: any) {
    console.error("Setup generation failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
