export type Migration = {
  readonly id: number;
  readonly name: string;
  readonly up: string;
};

export type Clock = () => Date;
