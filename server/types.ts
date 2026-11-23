export type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type ApiResponse = {
  setHeader(name: string, value: string | number): void;
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
  send(body: Buffer): ApiResponse;
};
