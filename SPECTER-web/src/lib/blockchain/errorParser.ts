/**
 * Parse blockchain/wallet errors into user-friendly messages.
 * Handles viem errors, wallet rejections, network issues, etc.
 */

export interface ParsedError {
  title: string;
  message: string;
  isUserAction: boolean; // true if user needs to do something (not a bug)
}

/**
 * Extract a clean, user-friendly error message from blockchain operations.
 */
export function parseBlockchainError(error: unknown): ParsedError {
  const err = error as any;

  // User rejected transaction
  if (
    err?.message?.includes('User rejected') ||
    err?.message?.includes('User denied') ||
    err?.message?.includes('user rejected') ||
    err?.code === 4001 ||
    err?.code === 'ACTION_REJECTED'
  ) {
    return {
      title: 'Transaction cancelled',
      message: 'You cancelled the transaction in your wallet.',
      isUserAction: true,
    };
  }

  // Chain mismatch
  if (
    err?.name === 'ChainMismatchError' ||
    err?.code === 'CHAIN_MISMATCH' ||
    err?.message?.includes('Chain mismatch')
  ) {
    return {
      title: 'Wrong network',
      message: 'Please switch your wallet to the correct network and try again.',
      isUserAction: true,
    };
  }

  // Insufficient funds
  if (
    err?.message?.includes('insufficient funds') ||
    err?.message?.includes('insufficient balance') ||
    err?.code === 'INSUFFICIENT_FUNDS'
  ) {
    return {
      title: 'Insufficient funds',
      message: 'You need more ETH to cover gas fees for this transaction.',
      isUserAction: true,
    };
  }

  // Contract/resolver not found
  if (
    err?.message?.includes('resolver not found') ||
    err?.message?.includes('Resolver not found') ||
    err?.message?.includes('No resolver set')
  ) {
    return {
      title: 'ENS resolver not configured',
      message: 'Set up a resolver for your ENS name in the ENS app first.',
      isUserAction: true,
    };
  }

  // RPC endpoint unauthorized (Alchemy/Infura API key expired, revoked, or domain-restricted)
  // MetaMask surfaces this as code -32006 with httpStatus 401.
  if (
    err?.code === -32006 ||
    err?.data?.httpStatus === 401 ||
    err?.message?.toLowerCase().includes('unauthorized')
  ) {
    return {
      title: 'RPC endpoint unauthorized',
      message: 'The RPC provider rejected the request (401 Unauthorized). The API key may be expired or domain-restricted. Try removing the network from MetaMask and reconnecting, or contact the app team.',
      isUserAction: true,
    };
  }

  // JSON-RPC protocol version error (Dynamic Labs / WalletConnect provider quirk)
  if (
    err?.message?.includes('Version of JSON-RPC protocol is not supported') ||
    err?.message?.includes('JSON-RPC protocol') ||
    (err?.code === -32600 && err?.message)
  ) {
    return {
      title: 'Wallet provider error',
      message: 'Your wallet returned a JSON-RPC compatibility error. Try switching networks manually in your wallet and retry, or reconnect your wallet.',
      isUserAction: true,
    };
  }

  // Gas fee cap error (stale estimate, common on Arbitrum Sepolia)
  if (
    err?.message?.includes('fee cap') ||
    err?.message?.includes('maxFeePerGas') ||
    err?.message?.includes('block base fee') ||
    err?.message?.includes('FeeTooLow') ||
    err?.message?.includes('gas price too low')
  ) {
    return {
      title: 'Gas fee too low',
      message: 'The gas fee estimate was lower than the current network base fee. Please retry — the wallet will re-estimate with current fees.',
      isUserAction: true,
    };
  }

  // RPC/Network errors
  if (
    err?.message?.includes('could not detect network') ||
    err?.message?.includes('network error') ||
    err?.message?.includes('fetch failed') ||
    err?.code === 'NETWORK_ERROR'
  ) {
    return {
      title: 'Network error',
      message: 'Could not connect to the blockchain. Check your internet connection.',
      isUserAction: true,
    };
  }

  // Timeout
  if (err?.message?.includes('timeout') || err?.code === 'TIMEOUT') {
    return {
      title: 'Request timed out',
      message: 'The request took too long. Please try again.',
      isUserAction: true,
    };
  }

  // Transaction reverted
  if (
    err?.message?.includes('transaction reverted') ||
    err?.message?.includes('execution reverted')
  ) {
    return {
      title: 'Transaction failed',
      message: 'The transaction was rejected by the contract. You may not have permission.',
      isUserAction: true,
    };
  }

  // Generic fallback - try to extract a clean message
  let message = 'Something went wrong. Please try again.';
  if (err?.message && typeof err.message === 'string') {
    // Extract first sentence before technical details
    const firstSentence = err.message.split(/[\n\r]|Request Arguments:|Contract Call:|Details:/)[0]?.trim();
    if (firstSentence && firstSentence.length < 150) {
      message = firstSentence;
    }
  }

  return {
    title: 'Error',
    message,
    isUserAction: false,
  };
}

/**
 * Format a parsed error for display in a toast or alert.
 */
export function formatErrorMessage(parsed: ParsedError): string {
  return parsed.title === 'Error' ? parsed.message : `${parsed.title}: ${parsed.message}`;
}
