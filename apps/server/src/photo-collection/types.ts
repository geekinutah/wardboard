/** Structural copy of the collector's directory config. Server sources must not import that package. */
export type DirectoryConfig = {
  layoutVersion: string;
  startUrl: string;
  selectors: {
    householdList: string;
    householdLink: string;
    householdName: string;
    householdImage: string;
    memberEntry: string;
    memberName: string;
    memberPortrait: string;
    signedOut: string;
  };
  timeouts: { navigationMs: number; elementMs: number };
  retries: { image: number };
};

/** Structural copy of the collector's `collect` options. */
export type CollectOptions = {
  stagingDir: string;
  config: DirectoryConfig;
  mode: 'new' | 'resume';
  browser: { headless: boolean };
  waitForSignIn: (message: string) => Promise<void>;
  log: (line: string) => void;
  signal?: AbortSignal;
  now?: () => Date;
};

/** Structural copy of the collector's `collect` result. */
export type CollectResult = {
  status: 'done' | 'cancelled' | 'unsupported_layout' | 'refused' | 'failed';
  exitCode: 0 | 1 | 2;
  message: string;
};

export type PhotoCollector = {
  collect: (options: CollectOptions) => Promise<CollectResult>;
  config: DirectoryConfig;
};
