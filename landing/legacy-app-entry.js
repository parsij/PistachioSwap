import '@fontsource/ubuntu/latin-400.css'
import '@fontsource/ubuntu/latin-500.css'
import '@fontsource/ubuntu/latin-700.css'
import './designFramework.css'
import { publicRouteRedirect } from '../src/web3/publicRoutes.js'

// Fallback for static hosts/old nginx during rollout. The origin should send
// HTTP redirects; this tiny entry never imports or initializes the wallet.
const target = publicRouteRedirect(new URL(window.location.href))
if (target) window.location.replace(target)
