// Production-grade GA4 analytics for SPECTER
// All calls are no-ops if gtag isn't available (ad-blockers, dev without GA, SSR).

const GA_ID = "G-5KHLBQDNHJ";

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
type AnalyticsChain = "ethereum" | "arbitrum" | "monad" | "sui";

export function trackEvent(eventName: string, params?: EventParams) {
  gtag("event", eventName, { send_to: GA_ID, ...params });
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
};
