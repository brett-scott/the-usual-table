import { GameError } from '@casual/engine';
import { walletSummarySchema, type AccountSession } from '@casual/protocol';
import type { WalletGateway } from './roomWallet';

/** Read only, for the verified caller. Never create accounts/grants or derive saved funds from table stacks. */
export async function readAccountWallet(account: AccountSession, gateway: WalletGateway | undefined, timeoutMs = 3000) {
  if (!gateway?.getWallet) throw new GameError('WALLET_NOT_CONNECTED', 'Saved wallets are not connected yet.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      gateway.getWallet(account.accountId),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Wallet timed out')), timeoutMs); }),
    ]);
    const wallet = walletSummarySchema.parse(result);
    if (wallet.accountId !== account.accountId) throw new Error('Wallet account mismatch');
    return wallet;
  } catch {
    throw new GameError('WALLET_UNAVAILABLE', 'Your wallet balance could not be loaded. Please try again.');
  } finally { clearTimeout(timer); }
}
