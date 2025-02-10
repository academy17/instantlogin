//Requires Checksummed Address
require("dotenv").config();
const { ethers } = require("ethers");
const axios = require("axios");
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const activeAccount = ethers.getAddress(process.env.activeAccount); 
const wallet = new ethers.Wallet(PRIVATE_KEY);
const SOLVER_BASE_URL = "https://base-hedger82.rasa.capital";
const DOMAIN = "localhost"; 
const ORIGIN = "http://localhost:3000";
const CHAIN_ID = 8453;
const LOGIN_URI = `${SOLVER_BASE_URL}/login`; 
const ISSUED_AT = new Date().toISOString(); 
const EXPIRATION_DATE = new Date(Date.now() + (24 * 60 * 60 * 1000 * 10)).toISOString(); 

async function getNonce(address) {
  const url = `${SOLVER_BASE_URL}/nonce/${address}`;
  const { data } = await axios.get(url);
  return data.nonce; 
}

(async function main() {
  try {
    console.log(`\n[1/4] Wallet Address: ${wallet.address}`); 
    console.log(`[1.5/4] Active Account (Checksum): ${activeAccount}`);
    
    const nonce = await getNonce(activeAccount);
    console.log(`[2/4] Got nonce: ${nonce}`);
    
    const siweMessage = buildSiweMessage({
      domain: DOMAIN,
      address: wallet.address,        
      statement: `msg: ${activeAccount}`, 
      uri: LOGIN_URI,
      version: "1",
      chainId: CHAIN_ID,
      nonce,
      issuedAt: ISSUED_AT,
      expirationTime: EXPIRATION_DATE,
    });

    console.log("\n[3/4] SIWE message to sign:\n", siweMessage);

    const signature = await wallet.signMessage(siweMessage);
    console.log("\nSignature:", signature);

    const body = {
      account_address: activeAccount, 
      expiration_time: EXPIRATION_DATE,
      issued_at: ISSUED_AT,
      signature,
      nonce
    };

    const headers = {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Referer: ORIGIN, 
    };
    
    console.log("\n[4/4] Sending login request...");
    const response = await axios.post(
      `${SOLVER_BASE_URL}/login`,
      body,
      { headers }
    );
    console.log("Login response:", response.data);

  } catch (err) {
    console.error("Error in SIWE login flow:", err.response?.data || err.message);
  }
})();


// ----------------- UTILS -----------------

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
  // This is the standard EIP-4361 (SIWE) message format
  // (https://eips.ethereum.org/EIPS/eip-4361)

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

/*app.intentx.io wants you to sign in with your Ethereum account:
0x3B5aC601c7bB74999AB3135fa43cbDBc6aB74570

msg: 0x33D689034225A67454980c9D91E35C03a4765B30

URI: https://base-hedger82.rasa.capital/login
Version: 1
Chain ID: 42161
Nonce: 8e48d3029055c9a7
Issued At: 2025-01-24T17:48:48.319Z
Expiration Time: 2025-01-25T17:48:48.319Z*/