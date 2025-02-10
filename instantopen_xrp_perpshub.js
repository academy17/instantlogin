// --------------------------------------------------------------------
//This exampl escript logs into the instant trade endpoint and instant opens a small XRP LONG position on Arbitrum using PerpsHub as a partyB using SYMMIO.
// --------------------------------------------------------------------


require("dotenv").config();
const { ethers } = require("ethers");
const axios = require("axios");
const BigNumber = require("bignumber.js");
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const activeAccount = process.env.activeAccount; // Your sub-account address
const wallet = new ethers.Wallet(PRIVATE_KEY);
//Constants for login
const SOLVER_BASE_URL =
  "https://www.perps-streaming.com/v1/42161a/0x141269E29a770644C34e05B127AB621511f20109";
const DOMAIN = "localhost";
const ORIGIN = "http://localhost:3000";
const CHAIN_ID = 42161;
const LOGIN_URI = `${SOLVER_BASE_URL}/login`;
const ISSUED_AT = new Date().toISOString();
const EXPIRATION_DATE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

// --------------------------------------------------------------------
// Trade Configuration
// --------------------------------------------------------------------

//Modify the Muon URL params to your own partyA address
const MUON_URL =
  "https://muon-oracle1.rasa.capital/v1/?app=symmio&method=uPnl_A_withSymbolPrice&params%5BpartyA%5D=0x33D689034225A67454980c9D91E35C03a4765B30&params%5BchainId%5D=42161&params%5Bsymmio%5D=0x8F06459f184553e5d04F07F868720BDaCAB39395&params%5BsymbolId%5D=340";
const LOCKED_PARAMS_URL =
  "https://www.perps-streaming.com/v1/42161a/0x141269E29a770644C34e05B127AB621511f20109/get_locked_params/XRPUSDT";

// For XRP, the marketId is "340"
const symbolId = 340;
// Position type: 0 for long, 1 for short
const positionType = 0;
// Order type: 0 = limit, 1 = market (instant trading only uses market orders)
const orderType = 1;
// Trade quantity (6.1 XRP tokens), make sure this value exceeds the minimum notional value for a position. A notional size of aroud $15 should be suitable.
const quantity = "6.1";
// Maximum funding rate (as a string). You can fetch this from contract-symbols endpoint of hedger
const maxFundingRate = "200";
// Deadline: current timestamp + 1 hour (in seconds)
const deadline = Math.floor(Date.now() / 1000) + 3600;

// --------------------------------------------------------------------
// Helper Functions
// --------------------------------------------------------------------

// SIWE message builder (EIP-4361)
function buildSiweMessage({
  domain,
  address,
  statement,
  uri,
  version,
  chainId,
  nonce,
  issuedAt,
  expirationTime
}) {
  return `${domain} wants you to sign in with your Ethereum account:
${address}

${statement}

URI: ${uri}
Version: ${version}
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`;
}

// Fetch nonce for SIWE login
async function getNonce(address) {
  const url = `${SOLVER_BASE_URL}/nonce/${address}`;
  const { data } = await axios.get(url);
  return data.nonce;
}

// Fetch the asset price from Muon (price returned in wei)
async function fetchMuonPrice() {
  try {
    const response = await axios.get(MUON_URL);
    const fetchedPriceWei = response.data.result.data.result.price;
    if (!fetchedPriceWei) {
      throw new Error("Muon price not found in response.");
    }
    return fetchedPriceWei; // as a string (in wei)
  } catch (error) {
    console.error(
      "Error fetching Muon price:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Fetch locked parameters for XRPUSDT from the hedger
async function fetchLockedParams() {
  try {
    const response = await axios.get(LOCKED_PARAMS_URL);
    if (response.data && response.data.message === "Success") {
      return response.data; // Contains: cva, lf, leverage, partyAmm, partyBmm
    } else {
      throw new Error("Failed to fetch locked parameters.");
    }
  } catch (error) {
    console.error(
      "Error fetching locked parameters:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// For normalized (human-readable) locked values, we compute:
// normalizedLockedValue = (price × quantity) × (lockedParam / 100)
function calculateNormalizedLockedValue(notional, lockedParam) {
  return notional.multipliedBy(new BigNumber(lockedParam)).dividedBy(100);
}

// --------------------------------------------------------------------
// openInstantTrade: Performs the following:
// 1. Fetch Muon price and apply +5% slippage. (The hedger's spread is included in the open price. When we do a LONG, we send an openPrice a little higher than the price Muon returns, to account for this. The inverse is true of shorts (we send a slightly lower requestPrice))
// 2. Fetch locked parameters from the hedger.
// 3. Compute the notional value in human-readable units (price × quantity).
// 4. Compute normalized locked values (CVA, LF, PartyAmm, PartyBmm).
// 5. Build and send the trade payload to /instant_open using the access token.
// --------------------------------------------------------------------
async function openInstantTrade(token) {
  try {
    // 1. Fetch the raw price (in wei) from Muon.
    const fetchedPriceWei = await fetchMuonPrice();
    console.log("Fetched price (wei):", fetchedPriceWei);

    // 2. Apply fixed +5 %slippage.
    const fetchedPriceBN = new BigNumber(fetchedPriceWei);
    const adjustedPriceBN = fetchedPriceBN.multipliedBy(1.05);
    // Convert adjusted price from wei to human-readable string (assumes 18 decimals)
    const adjustedPrice = ethers.formatUnits(adjustedPriceBN.toFixed(), 18);
    console.log("Adjusted price (+5%):", adjustedPrice); //Since we're longing XRP here
    // 3. Fetch locked parameters.
    const lockedParams = await fetchLockedParams();
    console.log("Locked parameters:", lockedParams);

    // 4. Compute notional value in human-readable units (price * quantity)
    const notional = new BigNumber(adjustedPrice).multipliedBy(new BigNumber(quantity));
    console.log("Notional:", notional.toString());

    // 5. Compute normalized locked values:
    const normalizedCVA = calculateNormalizedLockedValue(notional, lockedParams.cva).toFixed();
    const normalizedLF = calculateNormalizedLockedValue(notional, lockedParams.lf).toFixed();
    const normalizedPartyAmm = calculateNormalizedLockedValue(notional, lockedParams.partyAmm).toFixed();
    const normalizedPartyBmm = calculateNormalizedLockedValue(notional, lockedParams.partyBmm).toFixed();

    console.log("Normalized CVA:", normalizedCVA);
    console.log("Normalized LF:", normalizedLF);
    console.log("Normalized PartyAmm:", normalizedPartyAmm);
    console.log("Normalized PartyBmm:", normalizedPartyBmm);

    // 6. Build the trade payload with normalized values.
    const tradeParams = {
      symbolId: symbolId,           // Always "340" for XRP
      positionType: positionType,   // 1 for long (or 0 for short)
      orderType: orderType,         // 1 for market order
      price: adjustedPrice,         // e.g. "2.54373"
      quantity: quantity,           // e.g. "6.0"
      cva: normalizedCVA,           // e.g. "0.08925276"
      lf: normalizedLF,             // e.g. "0.05950184"
      partyAmm: normalizedPartyAmm, // e.g. "14.7267054"
      partyBmm: normalizedPartyBmm, // e.g. "0"
      maxFundingRate: maxFundingRate,
      deadline: deadline            // Unix timestamp
    };

    console.log("Trade Payload:", tradeParams);

    // 7. Send the instant open request using the access token.
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    };

    const response = await axios.post(`${SOLVER_BASE_URL}/instant_open`, tradeParams, { headers });
    console.log("Instant open response:", response.data);
  } catch (error) {
    console.error("Error in openInstantTrade:", error.response?.data || error.message);
  }
}

// --------------------------------------------------------------------
// MAIN FLOW: SIWE Login then Instant Open Trade
// --------------------------------------------------------------------
(async function main() {
  try {
    console.log(`\n[1/4] Wallet Address: ${wallet.address}`);
    const nonce = await getNonce(activeAccount);
    console.log(`[2/4] Got nonce: ${nonce}`);

    // Build the SIWE message.
    const siweMessage = buildSiweMessage({
      domain: DOMAIN,
      address: wallet.address,
      statement: `msg: ${activeAccount}`,
      uri: LOGIN_URI,
      version: "1",
      chainId: CHAIN_ID,
      nonce,
      issuedAt: ISSUED_AT,
      expirationTime: EXPIRATION_DATE
    });
    console.log("\n[3/4] SIWE message to sign:\n", siweMessage);

    // Sign the SIWE message.
    const signature = await wallet.signMessage(siweMessage);
    console.log("\nSignature:", signature);

    // Build the login request body.
    const loginBody = {
      account_address: activeAccount,
      expiration_time: EXPIRATION_DATE,
      issued_at: ISSUED_AT,
      signature,
      nonce
    };

    const loginHeaders = {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Referer: ORIGIN
    };

    console.log("\n[4/4] Sending login request...");
    const loginResponse = await axios.post(`${SOLVER_BASE_URL}/login`, loginBody, { headers: loginHeaders });
    console.log("Login response:", loginResponse.data);

    // Extract the access token.
    const token = loginResponse.data.access_token;
    if (!token) {
      throw new Error("No access token received from login.");
    }

    // With the access token, send the instant open trade.
    await openInstantTrade(token);
  } catch (err) {
    console.error("Error in SIWE login flow:", err.response?.data || err.message);
  }
})();
