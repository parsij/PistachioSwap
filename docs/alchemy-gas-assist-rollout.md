# Rollout guard

Do not enable Alchemy Gas Assist in production until both Gas-Assist and PistachioSwap Alchemy branches are merged and deployed, the database migration is applied, both Alchemy policy IDs exist, the sponsorship webhook is configured fail-closed, and the required server-side secrets are present.

Leaving `ALCHEMY_GAS_ASSIST_ENABLED` unset or false keeps Gas Assist disabled even if retired MegaFuel variables remain in the server environment.
