export { ConfigError, parseConfig, type Config } from './config.ts';
export { startServer, isLoopbackHost, type RunningServer, type StartServerOptions } from './server.ts';
export {
  authenticate,
  authenticatedIdentities,
  fixtureIdentityProvider,
  getAuthenticatedIdentity,
  tailscaleIdentityProvider,
  type Identity,
  type IdentityProvider,
  type IdentityResult,
} from './identity/index.ts';
