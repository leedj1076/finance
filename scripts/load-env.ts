// Load local script configuration before modules that read process.env. Values
// already supplied by the shell (for production maintenance commands) win.
import { config } from 'dotenv'

config({ path: '.env.local' })
