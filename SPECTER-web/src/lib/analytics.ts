// Production-grade GA4 analytics for SPECTER
// All calls are no-ops if gtag isn't available (ad-blockers, dev without GA, SSR).

import posthog from "posthog-js";

const GA_ID = "G-5KHLBQDNHJ";
const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;
let posthogInitialized = false;

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

function gtag(...args: unknown[]) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag(...args);
  }
}

function isPostHogEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(POSTHOG_KEY && POSTHOG_HOST);
}

function sanitizePostHogParams(params?: EventParams): EventParams | undefined {
  if (!params) return undefined;

  const blockedKeys = new Set([
    "ens_name",
    "suins_name",
    "recipient_name",
    "destination",
    "label",
    "ref",
    "error_message",
  ]);

  const next = Object.fromEntries(
    Object.entries(params).filter(([key]) => !blockedKeys.has(key))
  );

  return Object.keys(next).length > 0 ? next : undefined;
}

// ── PostHog bootstrap ───────────────────────────────────────────────────────

export function initPostHog() {
  if (!isPostHogEnabled() || posthogInitialized) {
    return;
  }

  posthog.init(POSTHOG_KEY!, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    persistence: "localStorage+cookie",
  });
  posthogInitialized = true;
}

export function identifyWalletUser(distinctId: string, properties?: EventParams) {
  if (!isPostHogEnabled()) return;

  posthog.identify(distinctId, sanitizePostHogParams(properties));
}

export function resetPostHogUser() {
  if (!isPostHogEnabled()) return;
  posthog.reset();
}

export function captureClientException(error: unknown, extra?: EventParams) {
  if (!isPostHogEnabled()) return;

  posthog.captureException(error, sanitizePostHogParams(extra));
}

// ── Page views ───────────────────────────────────────────────────────────────

export function trackPageView(pagePath: string, pageTitle: string) {
  gtag("event", "page_view", {
    page_path: pagePath,
    page_title: pageTitle,
    send_to: GA_ID,
  });
}

// ── Generic escape hatch ─────────────────────────────────────────────────────

type EventParams = Record<string, string | number | boolean | undefined>;
export type AnalyticsChain = "ethereum" | "arbitrum" | "monad" | "sui" | "unknown";

export function trackEvent(eventName: string, params?: EventParams) {
  gtag("event", eventName, { send_to: GA_ID, ...params });

  if (!isPostHogEnabled()) return;

  posthog.capture(eventName, sanitizePostHogParams(params));
}

// ── Setup / Key Generation ───────────────────────────────────────────────────

export const analytics = {
  // Key generation
  setupGenerateClicked() {
    trackEvent("setup_generate_keys_clicked");
  },
  setupKeysGenerated() {
    trackEvent("setup_keys_generated");
  },
  setupKeysDownloaded() {
    trackEvent("setup_keys_downloaded");
  },
  setupKeysSavedToDevice() {
    trackEvent("setup_keys_saved_to_device");
  },

  // ENS setup
  setupEnsAttachClicked() {
    trackEvent("setup_ens_attach_clicked");
  },
  setupEnsAttached(ensName: string) {
    trackEvent("setup_ens_attached", { ens_name: ensName });
  },
  setupEnsRecordKept(ensName: string) {
    trackEvent("setup_ens_record_kept", { ens_name: ensName });
  },
  setupEnsRecordOverwritten(ensName: string) {
    trackEvent("setup_ens_record_overwritten", { ens_name: ensName });
  },

  // SuiNS setup
  setupSuinsAttachClicked() {
    trackEvent("setup_suins_attach_clicked");
  },
  setupSuinsAttached(suinsName: string) {
    trackEvent("setup_suins_attached", { suins_name: suinsName });
  },

  // Funnel
  setupStepNavigated(toStep: number, fromStep: number) {
    trackEvent("setup_step_navigated", { to_step: toStep, from_step: fromStep });
  },
  setupCompleted(options: { ensAttached: boolean; suinsAttached: boolean }) {
    trackEvent("setup_completed", {
      ens_attached: options.ensAttached,
      suins_attached: options.suinsAttached,
    });
  },
  setupSkippedWithoutBackup() {
    trackEvent("setup_skipped_without_backup");
  },

  // ── Send Payment ────────────────────────────────────────────────────────────

  sendResolveInitiated(nameType: "ens" | "sui" | "meta_address") {
    trackEvent("send_resolve_initiated", { name_type: nameType });
  },
  sendResolveSuccess(nameType: "ens" | "sui" | "meta_address", name: string) {
    trackEvent("send_resolve_success", { name_type: nameType, recipient_name: name });
  },
  sendResolveError(errorCode: string, nameType: "ens" | "sui" | "meta_address") {
    trackEvent("send_resolve_error", { error_code: errorCode, name_type: nameType });
  },
  sendStealthGenerated(chain: AnalyticsChain) {
    trackEvent("send_stealth_generated", { chain });
  },
  sendTabSwitched(tab: "wallet" | "manual") {
    trackEvent("send_tab_switched", { tab });
  },
  sendChainSelected(chain: AnalyticsChain) {
    trackEvent("send_chain_selected", { chain });
  },
  sendWalletSendClicked(chain: AnalyticsChain) {
    trackEvent("send_wallet_send_clicked", { chain });
  },
  sendTxSubmitted(chain: AnalyticsChain) {
    trackEvent("send_tx_submitted", { chain });
  },
  sendPaymentPublished(chain: AnalyticsChain, amount: string, method: "wallet" | "manual") {
    trackEvent("send_payment_published", { chain, amount, method });
  },
  sendManualPublishClicked() {
    trackEvent("send_manual_publish_clicked");
  },
  sendCompleted(chain: AnalyticsChain, amount: string, method: "wallet" | "manual") {
    trackEvent("send_completed", { chain, amount, method });
  },
  sendRecentRecipientClicked() {
    trackEvent("send_recent_recipient_clicked");
  },
  sendAnotherClicked() {
    trackEvent("send_another_clicked");
  },

  // ── Scan Payments ───────────────────────────────────────────────────────────

  scanKeysLoadedFromFile() {
    trackEvent("scan_keys_loaded_from_file");
  },
  scanKeysLoadedFromVault() {
    trackEvent("scan_keys_loaded_from_vault");
  },
  scanKeysLoadedFromPaste() {
    trackEvent("scan_keys_loaded_from_paste");
  },
  scanInitiated(keyLoadMethod: "file" | "vault" | "paste") {
    trackEvent("scan_initiated", { key_load_method: keyLoadMethod });
  },
  scanCompleted(discoveriesCount: number) {
    trackEvent("scan_completed", { discoveries_count: discoveriesCount });
  },
  scanError(message: string) {
    trackEvent("scan_error", { error_message: message.slice(0, 100) });
  },
  scanPaymentSelected(chain: AnalyticsChain) {
    trackEvent("scan_payment_selected", { chain });
  },
  scanPrivateKeyRevealed() {
    trackEvent("scan_private_key_revealed");
  },

  // ── Claim flow ──────────────────────────────────────────────────────────────

  claimOpened(fundedChains: number) {
    trackEvent("claim_opened", { funded_chains: fundedChains });
  },
  claimChainSelected(chain: AnalyticsChain) {
    trackEvent("claim_chain_selected", { chain });
  },
  claimStarted(chain: AnalyticsChain, addressCount: number) {
    trackEvent("claim_started", { chain, address_count: addressCount });
  },
  claimCompleted(chain: AnalyticsChain, confirmed: number, failed: number, skipped: number) {
    trackEvent("claim_completed", { chain, confirmed, failed, skipped });
  },
  claimError(message: string) {
    trackEvent("claim_error", { error_message: message.slice(0, 100) });
  },
  claimReceiptDownloaded(format: "json" | "pdf") {
    trackEvent("claim_receipt_downloaded", { format });
  },

  // ── Wallet ──────────────────────────────────────────────────────────────────

  walletConnectClicked(chain: AnalyticsChain) {
    trackEvent("wallet_connect_clicked", { chain });
  },
  walletDisconnectClicked(chain: AnalyticsChain) {
    trackEvent("wallet_disconnect_clicked", { chain });
  },

  // ── General / CTA ───────────────────────────────────────────────────────────

  heroCTAClicked(label: string) {
    trackEvent("hero_cta_clicked", { cta_label: label });
  },
  externalLinkClicked(destination: string, label: string) {
    trackEvent("external_link_clicked", { destination, label });
  },
  copyButtonClicked(context: string) {
    trackEvent("copy_button_clicked", { context });
  },
  downloadReceiptClicked() {
    trackEvent("download_receipt_clicked");
  },

  // ── Pay Links (receiver) ──────────────────────────────────────────────────────

  payLinkCardViewed(source: "scan" | "setup") {
    trackEvent("pay_link_card_viewed", { source });
  },
  payLinkCopied(context: "card" | "drawer" | "pay_page") {
    trackEvent("pay_link_copied", { context });
  },
  payLinkQrDownloaded(context: "card" | "drawer") {
    trackEvent("pay_link_qr_downloaded", { context });
  },
  payLinkShared(context: "card" | "drawer") {
    trackEvent("pay_link_shared", { context });
  },
  payLinkNameVerified(nameType: "ens" | "sui") {
    trackEvent("pay_link_name_verified", { name_type: nameType });
  },
  payLinkNameUnregistered(nameType: "ens" | "sui") {
    trackEvent("pay_link_name_unregistered", { name_type: nameType });
  },
  payLinkSetupCtaClicked() {
    trackEvent("pay_link_setup_cta_clicked");
  },
  payLinkFabOpened() {
    trackEvent("pay_link_fab_opened");
  },

  // ── Request Builder ───────────────────────────────────────────────────────────

  requestBuilderOpened() {
    trackEvent("request_builder_opened");
  },
  requestCreated(params: { has_amount: boolean; chain: AnalyticsChain }) {
    trackEvent("request_created", { has_amount: params.has_amount, chain: params.chain });
  },
  requestSaved() {
    trackEvent("request_saved");
  },

  // ── Pay Page (payer) ──────────────────────────────────────────────────────────

  payPageViewed(params: { name_type: "ens" | "sui"; has_amount: boolean; chain: string; ref: string }) {
    trackEvent("pay_page_viewed", {
      name_type: params.name_type,
      has_amount: params.has_amount,
      chain: params.chain,
      ref: params.ref,
    });
  },
  payPageInvalidName() {
    trackEvent("pay_page_invalid_name");
  },
};
