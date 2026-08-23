import { INITIAL } from '../editor/initial';

// This adapter is intentionally its own lazy module. The editor imports
// `initial.ts` for templates and Agent context, while the dashboard only needs
// the demo document on a genuinely empty first run. Keeping the lazy boundary
// here avoids pulling the template catalogue into every dashboard startup.
export const FIRST_RUN_SEED = INITIAL;
