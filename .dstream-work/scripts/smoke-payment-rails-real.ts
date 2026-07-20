import assert from "node:assert/strict";
import { verifyPayment } from "../apps/web/src/lib/payments/server/index";
import type { PaymentVerificationInput } from "../apps/web/src/lib/payments/server/types";

interface RealRailSample {
  label: string;
  input: PaymentVerificationInput;
  expectedAtomic: string;
}

const requiredEnv = [
  "DSTREAM_DOGE_RPC_ORIGIN",
  "DSTREAM_BCH_RPC_ORIGIN",
  "DSTREAM_ETH_RPC_ORIGIN",
  "DSTREAM_TRON_RPC_ORIGIN",
  "DSTREAM_SOLANA_RPC_ORIGIN",
  "DSTREAM_XRPL_RPC_ORIGIN",
  "DSTREAM_CARDANO_API_ORIGIN"
] as const;

for (const name of requiredEnv) {
  if (!(process.env[name] ?? "").trim()) throw new Error(`${name} is required for the real payment rail smoke.`);
}

const samples: RealRailSample[] = [
  {
    label: "Dogecoin",
    input: {
      asset: "doge",
      paymentRailId: "utxo",
      network: "main",
      address: "DMr31kgb3rWbgT9h7d7iPaqFjVPxheWM38",
      amount: "10014.03638265",
      txId: "1280a1d4db744e93d24b1831e7969dd707b6982f8f6c184d27ce3893d549bdd1"
    },
    expectedAtomic: "1001403638265"
  },
  {
    label: "Bitcoin Cash",
    input: {
      asset: "bch",
      paymentRailId: "utxo",
      network: "main",
      address: "bitcoincash:qqf2sakdcjvh37wx9cdqrx05vjnm30ecr5v9rere8h",
      amount: "3.125",
      txId: "a8be8e1b9ad48ed21b66e1eae0a6e800b1a826c773de9523875741ea15ed3d77"
    },
    expectedAtomic: "312500000"
  },
  {
    label: "Ethereum",
    input: {
      asset: "eth",
      paymentRailId: "evm",
      network: "ethereum",
      address: "0xbdb3ba9ffe392549e1f8658dd2630c141fdf47b6",
      amount: "0.000000000025571332",
      txId: "0xacf731f6a056c5f5064d791bafafb06b57d3d548cb9d0066b19bc42c87295e1d"
    },
    expectedAtomic: "25571332"
  },
  {
    label: "Ethereum USDT",
    input: {
      asset: "usdt",
      paymentRailId: "evm",
      network: "ethereum",
      address: "0x8c431f9e301660aa3dd87c0fc38f86b57fab9c2f",
      amount: "2001.601281",
      txId: "0x68223885437a44d257ab42e8a45dadac6ee13b7868f4bf0aaf959324aaa3ac11"
    },
    expectedAtomic: "2001601281"
  },
  {
    label: "Ethereum USDC",
    input: {
      asset: "usdc",
      paymentRailId: "evm",
      network: "ethereum",
      address: "0x6c63eba2417d695e6d7583d8bdf5b1511513c9fd",
      amount: "1.1028",
      txId: "0x70c6f3d4a1ceecbf3c3e4329f45915a988647edac38291701ccedb3dcd72100b"
    },
    expectedAtomic: "1102800"
  },
  {
    label: "PEPE",
    input: {
      asset: "pepe",
      paymentRailId: "evm",
      network: "ethereum",
      address: "0x06fd4ba7973a0d39a91734bbc35bc2bcaa99e3b0",
      amount: "2814210501",
      txId: "0x0ee4e70633c0ae8c0da5603a114fc756f2bda4242319dc76303b716775430ded"
    },
    expectedAtomic: "2814210501000000000000000000"
  },
  {
    label: "TRON",
    input: {
      asset: "trx",
      paymentRailId: "tron",
      network: "tron",
      address: "TJ7hA7Z2CUGb3LraRp4LvBXJMq8gprwzU8",
      amount: "0.000002",
      txId: "c0c3971a0f68a577580bfc6d6ed7a3f0f2e0c003eb0c63778e3788e2c28fb84d"
    },
    expectedAtomic: "2"
  },
  {
    label: "TRON USDT",
    input: {
      asset: "usdt",
      paymentRailId: "tron",
      network: "tron",
      address: "TC9iKVAK23ddozrr8fowcVdXc395H7arD8",
      amount: "50000",
      txId: "99f3f2cfa0c7980e4e943b61e4e8c075855341c516b7f501ae45330c5a5ab566"
    },
    expectedAtomic: "50000000000"
  },
  {
    label: "Solana",
    input: {
      asset: "sol",
      paymentRailId: "solana",
      network: "solana",
      address: "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
      amount: "0.01",
      txId: "4k72PQ7zQA65wAfc7tvC2yVekmZykKsFn5Zd18BxPm2q7GmxigW89WhHUkYwKiCoWapBchHgT4fk1dju5LE13RoC"
    },
    expectedAtomic: "10000000"
  },
  {
    label: "Solana USDC",
    input: {
      asset: "usdc",
      paymentRailId: "solana",
      network: "solana",
      address: "F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe",
      amount: "7.826172",
      txId: "3dK1oHQ3FcqZ1ys2dqGDLd7QWbhYVMWQbZP8FcQbNm2TopJZnHLvU2nuns7g8uqaQfg9m8wJDqpn9x1wbtCdwtxP"
    },
    expectedAtomic: "7826172"
  },
  {
    label: "Solana USDT",
    input: {
      asset: "usdt",
      paymentRailId: "solana",
      network: "solana",
      address: "ALiuapi6bJxcrKjWifcN2XsuU1kENtZdjzJ4ayKvd84N",
      amount: "0.00028",
      txId: "3eXsrTggoTgGXmr7d6nRT3Suqh6TBJmowNLSyGCd4uhvf1mXrychBEEZQcvdGX6WPj44PXUmYg2hKL1NKq5nA7a5"
    },
    expectedAtomic: "280"
  },
  {
    label: "XRP",
    input: {
      asset: "xrp",
      paymentRailId: "xrpl",
      network: "xrpl",
      address: "r4FaiziXJCbh2asirLkRpkGjLB47uHWNpE",
      amount: "0.000001",
      txId: "09B7A47124FB1A85674B1C70AF68245EC672AF29FE098A2330D8D9312CF4DF33",
      proof: { destinationTag: 1377885376 }
    },
    expectedAtomic: "1"
  },
  {
    label: "Cardano",
    input: {
      asset: "ada",
      paymentRailId: "cardano",
      network: "cardano",
      address:
        "addr1q952yhskgdw5pgtgupzc47n0ms35g40y0t2huu5gfqw7e9r5zksvsw82e2e9crxxvg4wk7wgpqzek57gsff7f0ewc7kswvfkey",
      amount: "148.496591",
      txId: "21a0d3ecd80d8333eea9fd21914cef6cde1e0e37a0d5713040a4b5f63f11dba0"
    },
    expectedAtomic: "148496591"
  }
];

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  const results: Array<Record<string, unknown>> = [];
  for (const sample of samples) {
    if (sample.label === "TRON USDT") await sleep(2500);
    const verified = await verifyPayment(sample.input);
    assert.equal(verified.asset, sample.input.asset, `${sample.label} returned the wrong asset`);
    assert.equal(verified.amountAtomic, sample.expectedAtomic, `${sample.label} returned the wrong amount`);
    assert.ok(verified.confirmations >= 1, `${sample.label} is not confirmed`);
    results.push({
      label: sample.label,
      rail: verified.railId,
      network: verified.network,
      txId: verified.txId,
      amountAtomic: verified.amountAtomic,
      confirmations: verified.confirmations
    });
  }
  console.log(JSON.stringify({ ok: true, verified: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
