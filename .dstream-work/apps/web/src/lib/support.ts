const DEFAULT_SUPPORT_REPO_URL = "https://github.com/3KD/dStream";

function normalizeRepoUrl(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return DEFAULT_SUPPORT_REPO_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_SUPPORT_REPO_URL;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SUPPORT_REPO_URL;
  }
}

function buildIssueUrl(repoUrl: string, defaults: { title: string; body: string; labels?: string[] }) {
  const url = new URL(`${repoUrl}/issues/new`);
  url.searchParams.set("title", defaults.title);
  url.searchParams.set("body", defaults.body);
  if (defaults.labels && defaults.labels.length > 0) {
    url.searchParams.set("labels", defaults.labels.join(","));
  }
  return url.toString();
}

export function getSupportRepoUrl(): string {
  return normalizeRepoUrl(process.env.NEXT_PUBLIC_SUPPORT_REPO_URL);
}

export function getSupportLinks() {
  const repoUrl = getSupportRepoUrl();
  return {
    repoUrl,
    issueChooser: `${repoUrl}/issues/new/choose`,
    bugIssue: buildIssueUrl(repoUrl, {
      title: "[Bug] ",
      labels: ["bug"],
      body: [
        "## Summary",
        "",
        "What happened?",
        "",
        "## Steps to Reproduce",
        "1.",
        "2.",
        "3.",
        "",
        "## Expected Result",
        "",
        "## Actual Result",
        "",
        "## Environment",
        "- Browser:",
        "- OS:",
        "- Device:",
        "- Stream URL / Stream ID:"
      ].join("\n")
    }),
    featureIssue: buildIssueUrl(repoUrl, {
      title: "[Feature] ",
      labels: ["enhancement"],
      body: [
        "## Problem",
        "",
        "What user pain are you solving?",
        "",
        "## Proposed Solution",
        "",
        "## Alternatives Considered",
        "",
        "## Additional Context"
      ].join("\n")
    }),
    discussion: `${repoUrl}/discussions`,
    securityAdvisory: `${repoUrl}/security/advisories/new`
  };
}
