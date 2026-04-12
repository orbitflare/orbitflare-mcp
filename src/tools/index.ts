import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGetBalance } from './rpc/getBalance.js';
import { registerGetAccountInfo } from './rpc/getAccountInfo.js';
import { registerGetTransaction } from './rpc/getTransaction.js';
import { registerGetSignaturesForAddress } from './rpc/getSignaturesForAddress.js';
import { registerGetBlock } from './rpc/getBlock.js';
import { registerGetTokenAccountsByOwner } from './rpc/getTokenAccountsByOwner.js';
import { registerSendTransaction } from './rpc/sendTransaction.js';
import { registerGetRecentPrioritizationFees } from './rpc/getRecentPrioritizationFees.js';
import { registerGetSlot } from './rpc/getSlot.js';
import { registerGetEpochInfo } from './rpc/getEpochInfo.js';
import { registerGetNetworkStatus } from './rpc/getNetworkStatus.js';
import { registerGetLatestBlockhash } from './rpc/getLatestBlockhash.js';
import { registerGetFeeForMessage } from './rpc/getFeeForMessage.js';
import { registerGetMinimumBalanceForRentExemption } from './rpc/getMinimumBalanceForRentExemption.js';
import { registerGetTokenSupply } from './rpc/getTokenSupply.js';
import { registerGetTokenAccountBalance } from './rpc/getTokenAccountBalance.js';
import { registerGetMultipleAccounts } from './rpc/getMultipleAccounts.js';
import { registerGetProgramAccounts } from './rpc/getProgramAccounts.js';
import { registerSimulateTransaction } from './rpc/simulateTransaction.js';
import { registerGetStakeActivation } from './rpc/getStakeActivation.js';

import { registerSetApiKey } from './account/setApiKey.js';
import { registerGetProfile } from './account/getProfile.js';
import { registerListLicenses } from './account/listLicenses.js';
import { registerListRpcPlans } from './account/listRpcPlans.js';
import { registerUpdateProfile } from './account/updateProfile.js';

import { registerRequestDeviceCode } from './auth/requestDeviceCode.js';
import { registerPollDeviceToken } from './auth/pollDeviceToken.js';
import { registerRevokeToken } from './auth/revokeToken.js';
import { registerRequestWalletChallenge } from './auth/requestWalletChallenge.js';
import { registerVerifyWalletSignature } from './auth/verifyWalletSignature.js';
import { registerRegisterWithWallet } from './auth/registerWithWallet.js';

import { registerListApiKeys } from './keys/listApiKeys.js';
import { registerCreateApiKey } from './keys/createApiKey.js';
import { registerRegenerateApiKey } from './keys/regenerateApiKey.js';
import { registerDeleteApiKey } from './keys/deleteApiKey.js';

import { registerAddLicenseIp } from './licenses/addLicenseIp.js';
import { registerRemoveLicenseIp } from './licenses/removeLicenseIp.js';
import { registerRegenerateLicenseKey } from './licenses/regenerateLicenseKey.js';

import { registerPrepareTopUp } from './billing/prepareTopUp.js';
import { registerConfirmTopUp } from './billing/confirmTopUp.js';
import { registerListInvoices } from './billing/listInvoices.js';
import { registerPurchaseRpcPlan } from './billing/purchaseRpcPlan.js';

import { registerSubscribeTransactions } from './streaming/subscribeTransactions.js';
import { registerGetStakeInfo } from './staking/getStakeInfo.js';
import { registerGetSwapQuote } from './swap/getSwapQuote.js';

import { registerGenerateKeypair } from './wallet/generateKeypair.js';
import { registerGetWalletAddress } from './wallet/getWalletAddress.js';
import { registerLoadKeypair } from './wallet/loadKeypair.js';
import { registerClearKeypair } from './wallet/clearKeypair.js';
import { registerSignMessage } from './wallet/signMessage.js';
import { registerBuildSolTransfer } from './wallet/buildSolTransfer.js';
import { registerBuildStakeDelegation } from './wallet/buildStakeDelegation.js';
import { registerSignAndSendTransaction } from './wallet/signAndSendTransaction.js';

export function registerTools(server: McpServer): void {
  registerSetApiKey(server);

  registerGetBalance(server);
  registerGetAccountInfo(server);
  registerGetTransaction(server);
  registerGetSignaturesForAddress(server);
  registerGetBlock(server);
  registerGetTokenAccountsByOwner(server);
  registerSendTransaction(server);
  registerGetRecentPrioritizationFees(server);
  registerGetSlot(server);
  registerGetEpochInfo(server);
  registerGetNetworkStatus(server);
  registerGetLatestBlockhash(server);
  registerGetFeeForMessage(server);
  registerGetMinimumBalanceForRentExemption(server);
  registerGetTokenSupply(server);
  registerGetTokenAccountBalance(server);
  registerGetMultipleAccounts(server);
  registerGetProgramAccounts(server);
  registerSimulateTransaction(server);
  registerGetStakeActivation(server);

  registerGetProfile(server);
  registerListLicenses(server);
  registerListRpcPlans(server);
  registerUpdateProfile(server);

  registerRequestDeviceCode(server);
  registerPollDeviceToken(server);
  registerRevokeToken(server);
  registerRequestWalletChallenge(server);
  registerVerifyWalletSignature(server);
  registerRegisterWithWallet(server);

  registerListApiKeys(server);
  registerCreateApiKey(server);
  registerRegenerateApiKey(server);
  registerDeleteApiKey(server);

  registerAddLicenseIp(server);
  registerRemoveLicenseIp(server);
  registerRegenerateLicenseKey(server);

  registerPrepareTopUp(server);
  registerConfirmTopUp(server);
  registerListInvoices(server);
  registerPurchaseRpcPlan(server);

  registerSubscribeTransactions(server);
  registerGetStakeInfo(server);
  registerGetSwapQuote(server);

  registerGenerateKeypair(server);
  registerGetWalletAddress(server);
  registerLoadKeypair(server);
  registerClearKeypair(server);
  registerSignMessage(server);
  registerBuildSolTransfer(server);
  registerBuildStakeDelegation(server);
  registerSignAndSendTransaction(server);
}
