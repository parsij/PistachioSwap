# Alchemy signing boundary

Pistachio Wallet signs Alchemy Wallet API signature requests for Gas Assist. The browser never receives the Alchemy API key or policy credentials.

For an undelegated EOA the Wallet API may request an EIP-7702 authorization plus the operation signature. Pistachio Wallet accepts only Alchemy's documented Modular Account V2 EIP-7702 delegate addresses on BNB Chain and verifies the authorization payload hash before signing.

If ERC-20 pre-operation gas payment requires a permit, the permit signature is returned to the private Gas-Assist backend, which requests the final prepared Alchemy operation. The browser then signs the final signature requests and sends only those signatures to the backend. The backend submits its stored prepared operation through `wallet_sendPreparedCalls`.
