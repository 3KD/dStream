import type { StreamPaymentMethod } from "@dstream/protocol";
import type { NostrProfile } from "../profile";
import { comparePaymentAssetOrder } from "./catalog";

function normalizeValue(input: string | null | undefined): string | undefined {
  const value = (input ?? "").trim();
  return value ? value : undefined;
}

function paymentMethodKey(method: StreamPaymentMethod): string {
  return `${method.asset}|${(method.network ?? "").trim().toLowerCase()}|${method.address.trim().toLowerCase()}`;
}

function pushMethod(store: Map<string, StreamPaymentMethod>, method: StreamPaymentMethod) {
  const address = method.address.trim();
  if (!address) return;
  const normalized: StreamPaymentMethod = {
    ...method,
    address,
    network: normalizeValue(method.network),
    label: normalizeValue(method.label)
  };
  store.set(paymentMethodKey(normalized), normalized);
}

export function paymentMethodsFromProfile(profile: NostrProfile | null | undefined): StreamPaymentMethod[] {
  if (!profile) return [];

  const methods = new Map<string, StreamPaymentMethod>();

  const lightningAddress = normalizeValue(profile.lud16) ?? normalizeValue(profile.lud06);
  if (lightningAddress) {
    pushMethod(methods, {
      asset: "btc",
      address: lightningAddress,
      network: "lightning",
      label: "Lightning (NIP-57)"
    });
  }

  const directMethods: StreamPaymentMethod[] = [
    { asset: "xmr", address: profile.xmr ?? "" },
    { asset: "btc", address: profile.btc ?? "" },
    { asset: "eth", address: profile.eth ?? "" },
    { asset: "xrp", address: profile.xrp ?? "" },
    { asset: "sol", address: profile.sol ?? "" },
    { asset: "trx", address: profile.trx ?? "" },
    { asset: "doge", address: profile.doge ?? "" },
    { asset: "ada", address: profile.ada ?? "" }
  ];

  for (const method of directMethods) {
    pushMethod(methods, method);
  }

  return Array.from(methods.values()).sort((left, right) => {
    const byAsset = comparePaymentAssetOrder(left.asset, right.asset);
    if (byAsset !== 0) return byAsset;
    const byNetwork = (left.network ?? "").localeCompare(right.network ?? "");
    if (byNetwork !== 0) return byNetwork;
    return left.address.localeCompare(right.address);
  });
}
